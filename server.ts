/**
 * FACILIX Deno Server — LAN + WAN ready
 * --------------------------------------------------
 * Serves static files (dist/ in prod, ./ in dev) and provides /api endpoints.
 * Bind: 0.0.0.0 so any LAN device can reach it.
 * WAN:  run behind a tunnel (cloudflared/ngrok/tailscale funnel) — see README / scripts/expose.sh
 *
 *  Usage:
 *    deno task serve          # dev: serves ./  on 8000
 *    deno task serve:prod     # prod: vite build → serves dist/ on 8000
 *    deno task dev:all        # Vite (5173) + Deno (8000) concurrently
 */

const PORT = Number(Deno.env.get("PORT") ?? "8000");
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

// In prod `vite build` outputs to dist/, else serve project root
async function getStaticRoot(): Promise<string> {
  try {
    const st = await Deno.stat("./dist");
    if (st.isDirectory) return "./dist";
  } catch { /* no dist */ }
  return ".";
}

const STATIC_ROOT = await getStaticRoot();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// ---- In-memory demo store (replace with DB later) ----
type User = { id: string; fullname: string; email: string; password: string; createdAt: string };
const users: User[] = [];

// ---- API handler ----
async function handleApi(req: Request, url: URL): Promise<Response | null> {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "FACILIX", time: new Date().toISOString(), host: HOST, port: PORT });
  }

  if (url.pathname === "/api/status") {
    return json({
      ok: true,
      staticRoot: STATIC_ROOT,
      users: users.length,
      uptime: performance.now(),
    });
  }

  if (url.pathname === "/api/users" && req.method === "GET") {
    // don't leak passwords
    return json(users.map(({ password: _p, ...u }) => u));
  }

  if (url.pathname === "/api/register" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password || !body?.fullname) {
      return json({ ok: false, error: "fullname, email, password required" }, 400);
    }
    if (users.some((u) => u.email === body.email)) {
      return json({ ok: false, error: "email already exists" }, 409);
    }
    const user: User = {
      id: String(Date.now()),
      fullname: body.fullname,
      email: body.email,
      password: body.password,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    const { password: _p, ...safe } = user;
    return json({ ok: true, user: safe }, 201);
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return json({ ok: false, error: "email, password required" }, 400);
    }
    const user = users.find((u) => u.email === body.email && u.password === body.password);
    if (!user) return json({ ok: false, error: "invalid credentials" }, 401);
    const { password: _p, ...safe } = user;
    return json({ ok: true, user: safe, token: `demo_${user.id}` });
  }

  return null; // not an API route
}

// ---- Static file handler ----
async function serveStatic(pathname: string): Promise<Response | null> {
  // normalize: / → /index.html, no traversal
  let filePath = pathname;
  if (filePath === "/") filePath = "/index.html";
  // strip query, prevent ../
  filePath = filePath.split("?")[0].split("#")[0];
  if (filePath.includes("..")) return new Response("Bad Request", { status: 400 });

  const candidates = [
    `${STATIC_ROOT}${filePath}`,
    // allow /static/building.png to resolve also from ./static if dist layout differs
    `.${filePath}`,
  ];

  for (const cand of candidates) {
    try {
      const stat = await Deno.stat(cand);
      if (stat.isDirectory) {
        // try index.html inside directory
        const idx = `${cand}/index.html`;
        await Deno.stat(idx);
        const data = await Deno.readFile(idx);
        return new Response(data, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() } });
      }
      if (stat.isFile) {
        const data = await Deno.readFile(cand);
        return new Response(data, { headers: { "Content-Type": contentType(cand), ...corsHeaders() } });
      }
    } catch { /* try next */ }
  }
  return null;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // API first
  if (url.pathname.startsWith("/api/")) {
    const apiRes = await handleApi(req, url);
    if (apiRes) return apiRes;
    return json({ ok: false, error: "not found" }, 404);
  }

  // Static
  const fileRes = await serveStatic(url.pathname);
  if (fileRes) return fileRes;

  // SPA fallback: serve index.html for unknown routes (optional, keep for MPA navigation)
  // For FACILIX MPA we return 404 with hint instead
  return new Response(`Not found: ${url.pathname}\nTry /index.html`, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() },
  });
}

// ---- LAN IP detection for pretty logs ----
async function getLanIps(): Promise<string[]> {
  const ips: string[] = [];
  try {
    const cmd = new Deno.Command("sh", { args: ["-c", "ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}'"], stdout: "piped" });
    const { stdout } = await cmd.output();
    const out = new TextDecoder().decode(stdout).trim();
    if (out) ips.push(...out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch { /* fallback */ }
  // Also try hostname -I (linux)
  if (ips.length === 0) {
    try {
      const cmd = new Deno.Command("sh", { args: ["-c", "hostname -I 2>/dev/null | tr ' ' '\\n' | grep -v '^127\\.' | grep -v '^$'"], stdout: "piped" });
      const { stdout } = await cmd.output();
      const out = new TextDecoder().decode(stdout).trim();
      if (out) ips.push(...out.split("\n").map((s) => s.trim()).filter(Boolean));
    } catch { /* ignore */ }
  }
  return ips;
}

const lanIps = await getLanIps();

console.log(`\n  FACILIX Deno server starting...`);
console.log(`  Static root : ${STATIC_ROOT}/`);
console.log(`  Binding     : http://${HOST}:${PORT}`);
console.log(`\n  Local       : http://localhost:${PORT}/`);
for (const ip of lanIps) {
  console.log(`  LAN         : http://${ip}:${PORT}/   ← open on phone/tablet on same Wi-Fi`);
}
console.log(`  Health      : http://localhost:${PORT}/api/health`);
console.log(`\n  WAN (pick one):`);
console.log(`    • Cloudflare:  cloudflared tunnel --url http://localhost:${PORT}`);
console.log(`    • ngrok:       ngrok http ${PORT}`);
console.log(`    • Tailscale:   tailscale funnel ${PORT}`);
console.log(`    • Or: deno task expose:wan   (see scripts/expose.sh)`);
console.log(`\n  Press Ctrl+C to stop.\n`);

Deno.serve({ hostname: HOST, port: PORT, handler });
