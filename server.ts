/**
 * FACILIX Deno Server — LAN + WAN + SQLite Auth (superadmin/admin/technician/complainant)
 * ---------------------------------------------------------------------------------
 * Serves static files (dist/ in prod, ./ in dev) and provides /api/auth/* endpoints backed by SQLite.
 * Bind: 0.0.0.0 so any LAN device can reach it.
 *
 *  Usage:
 *    deno task serve          # dev: serves ./  on 8000
 *    deno task serve:prod     # prod: vite build → serves dist/ on 8000
 *    deno task dev:all        # Vite (5173) + Deno (8000) concurrently
 */

import { db, listUsersSafe, findUserById, toFrontendRequest } from "./db.ts";
import {
  ROLES,
  type Role,
  canManage,
  registerUser,
  loginUser,
  verifyToken,
  getTokenFromRequest,
  logoutToken,
  toSafeUser,
} from "./auth.ts";

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

function corsHeaders(req?: Request): HeadersInit {
  const origin = req?.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Token",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

function withTokenCookie(token: string, maxAge = 7 * 24 * 60 * 60): string {
  return `token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

// ---- API handler ----
async function handleApi(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  // Health & Status
  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "FACILIX", time: new Date().toISOString(), host: HOST, port: PORT }, 200, req);
  }

  if (url.pathname === "/api/status") {
    const counts = db.prepare("SELECT role, COUNT(*) as c FROM users GROUP BY role").all() as { role: string; c: number }[];
    const total = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    const sessions = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE revoked=0 AND expires_at > datetime('now')").get() as { c: number };
    return json({
      ok: true,
      staticRoot: STATIC_ROOT,
      users: total.c,
      byRole: Object.fromEntries(counts.map((r) => [r.role, r.c])),
      activeSessions: sessions.c,
      uptime: performance.now(),
    }, 200, req);
  }

  // ---- Auth: Register ----
  if ((url.pathname === "/api/auth/register" || url.pathname === "/api/register") && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      fullname?: string; username?: string; email?: string; phone?: string; password?: string; role?: string;
    } | null;
    if (!body) return json({ ok: false, error: "invalid json" }, 400, req);

    // Determine actor from token (if provided) to enforce role assignment rules
    const token = getTokenFromRequest(req);
    const actor = token ? verifyToken(token) : null;

    const res = await registerUser({
      fullname: body.fullname ?? "",
      username: body.username?.trim() || undefined,
      email: body.email ?? "",
      phone: body.phone,
      password: body.password ?? "",
      role: (body.role as Role) ?? "complainant",
    }, actor);

    if (!res.ok) return json({ ok: false, error: res.error }, res.status ?? 400, req);

    // Auto-create session for new user (so frontend can auto-login)
    const identifier = (body.username?.trim() || body.email?.trim() || "");
    const login = await loginUser(identifier, body.password ?? "");
    // login should succeed; if not, just return user
    if (login.ok) {
      const headers: HeadersInit = { ...corsHeaders(req), "Set-Cookie": withTokenCookie(login.token) };
      return new Response(JSON.stringify({ ok: true, user: login.user, token: login.token }, null, 2), {
        status: 201,
        headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
      });
    }
    return json({ ok: true, user: res.user }, 201, req);
  }

  // ---- Auth: Login ----
  if ((url.pathname === "/api/auth/login" || url.pathname === "/api/login") && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      email?: string; username?: string; identifier?: string; password?: string; adminCode?: string;
    } | null;
    const identifier = (body?.identifier ?? body?.username ?? body?.email ?? "").trim();
    if (!identifier || !body?.password) return json({ ok: false, error: "identifier (email or username) and password required" }, 400, req);

    // 2FA code check for admin tab (if provided, must be 123456 as per demo)
    if (body?.adminCode !== undefined && body.adminCode !== "" && body.adminCode !== "123456") {
      return json({ ok: false, error: "invalid 2FA code (demo: 123456)" }, 401, req);
    }

    const res = await loginUser(identifier, body.password);
    if (!res.ok) return json({ ok: false, error: res.error }, res.status ?? 401, req);

    // If 2FA code was provided, ensure user is admin/superadmin
    if (body.adminCode !== undefined && body.adminCode !== "") {
      if (res.user.role !== "admin" && res.user.role !== "superadmin") {
        // still allow but warn? For strict, require admin role
        return json({ ok: false, error: "admin login requires admin/superadmin role" }, 403, req);
      }
    }

    const headers: HeadersInit = { ...corsHeaders(req), "Set-Cookie": withTokenCookie(res.token) };
    return new Response(JSON.stringify({ ok: true, user: res.user, token: res.token }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    });
  }

  // ---- Auth: Logout ----
  if ((url.pathname === "/api/auth/logout" || url.pathname === "/api/logout") && req.method === "POST") {
    const token = getTokenFromRequest(req);
    if (token) logoutToken(token);
    const headers: HeadersInit = { ...corsHeaders(req), "Set-Cookie": `token=; Path=/; Max-Age=0; SameSite=Lax` };
    return new Response(JSON.stringify({ ok: true }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    });
  }

  // ---- Auth: Me ----
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    return json({ ok: true, user }, 200, req);
  }

  // ---- Auth: List users (admin/superadmin) ----
  if ((url.pathname === "/api/auth/users" || url.pathname === "/api/users") && req.method === "GET") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    if (user.role !== "admin" && user.role !== "superadmin") {
      return json({ ok: false, error: "forbidden: admin/superadmin only" }, 403, req);
    }
    const users = listUsersSafe();
    // admin can only see technician & complainant; superadmin sees all
    const filtered = user.role === "admin"
      ? users.filter((u) => u.role === "technician" || u.role === "complainant")
      : users;
    return json({ ok: true, users: filtered }, 200, req);
  }

  // ---- Auth: Update user role ----
  if (url.pathname.match(/^\/api\/auth\/users\/(\d+)\/role$/) && req.method === "PUT") {
    const token = getTokenFromRequest(req);
    const actor = token ? verifyToken(token) : null;
    if (!actor) return json({ ok: false, error: "not authenticated" }, 401, req);
    const id = Number(url.pathname.split("/")[4]);
    const target = findUserById(id);
    if (!target) return json({ ok: false, error: "user not found" }, 404, req);
    const body = await req.json().catch(() => null) as { role?: string } | null;
    const newRole = body?.role as Role;
    if (!newRole || !ROLES.includes(newRole)) return json({ ok: false, error: `invalid role, must be ${ROLES.join("|")}` }, 400, req);

    // Permission: actor must be able to manage target's current and new role
    if (!canManage(actor.role as Role, target.role as Role)) {
      return json({ ok: false, error: `cannot manage ${target.role}` }, 403, req);
    }
    if (!canManage(actor.role as Role, newRole)) {
      return json({ ok: false, error: `cannot assign role ${newRole}` }, 403, req);
    }
    // superadmin can do anything; admin can only assign tech/complainant
    if (actor.role === "admin" && !["technician", "complainant"].includes(newRole)) {
      return json({ ok: false, error: "admin can only assign technician/complainant" }, 403, req);
    }

    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(newRole, id);
    const updated = findUserById(id)!;
    return json({ ok: true, user: toSafeUser(updated) }, 200, req);
  }

  // ---- Auth: Update active status ----
  if (url.pathname.match(/^\/api\/auth\/users\/(\d+)\/status$/) && req.method === "PUT") {
    const token = getTokenFromRequest(req);
    const actor = token ? verifyToken(token) : null;
    if (!actor) return json({ ok: false, error: "not authenticated" }, 401, req);
    const id = Number(url.pathname.split("/")[4]);
    const target = findUserById(id);
    if (!target) return json({ ok: false, error: "user not found" }, 404, req);
    if (!canManage(actor.role as Role, target.role as Role)) return json({ ok: false, error: "forbidden" }, 403, req);
    const body = await req.json().catch(() => null) as { is_active?: boolean } | null;
    const active = body?.is_active;
    if (typeof active !== "boolean") return json({ ok: false, error: "is_active boolean required" }, 400, req);
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
    return json({ ok: true }, 200, req);
  }

  // ---- Auth: Delete user ----
  if (url.pathname.match(/^\/api\/auth\/users\/\d+$/) && req.method === "DELETE") {
    const token = getTokenFromRequest(req);
    const actor = token ? verifyToken(token) : null;
    if (!actor) return json({ ok: false, error: "not authenticated" }, 401, req);
    const id = Number(url.pathname.split("/")[4]);
    const target = findUserById(id);
    if (!target) return json({ ok: false, error: "user not found" }, 404, req);
    // cannot delete self
    if (actor.id === target.id) return json({ ok: false, error: "cannot delete self" }, 400, req);
    if (!canManage(actor.role as Role, target.role as Role)) return json({ ok: false, error: "forbidden" }, 403, req);
    // admin cannot delete admin/superadmin — already covered
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return json({ ok: true }, 200, req);
  }

  // ---- Legacy: GET /api/users (compat) ----
  // handled above as /api/auth/users

  // ===================== Requests API =====================
  // Helper: map DB row -> frontend shape
  function mapReq(r: Record<string, unknown>) {
    return toFrontendRequest(r as unknown as Parameters<typeof toFrontendRequest>[0]);
  }

  // GET /api/requests — admin/superadmin fetches ALL (or ?role=complainant for complainant-only), others fetch own
  if (url.pathname === "/api/requests" && req.method === "GET") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    const role = user.role as Role;
    const isAdmin = role === "admin" || role === "superadmin";
    const filterRole = url.searchParams.get("role"); // e.g. ?role=complainant
    const filterStatus = url.searchParams.get("status");

    let rows: Record<string, unknown>[];
    if (isAdmin) {
      if (filterRole) {
        // fetch only requests whose owner has that role (e.g. complainant)
        rows = db.prepare(`
          SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r
          LEFT JOIN users u ON u.id = r.owner_id
          WHERE (u.role = ? COLLATE NOCASE) OR (u.role IS NULL AND r.owner_email IN (SELECT email FROM users WHERE role = ? COLLATE NOCASE))
          ORDER BY r.id DESC
        `).all(filterRole, filterRole) as Record<string, unknown>[];
      } else {
        rows = db.prepare(`SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id ORDER BY r.id DESC`).all() as Record<string, unknown>[];
      }
      if (filterStatus) rows = rows.filter((r) => String(r["status"]) === filterStatus);
    } else if (role === "technician") {
      // technician: own requests + assigned jobs (assigned_to matches fullname or username)
      rows = db.prepare(`
        SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r
        LEFT JOIN users u ON u.id = r.owner_id
        WHERE r.owner_id = ? OR r.owner_email = ? COLLATE NOCASE
           OR r.assigned_to = ? COLLATE NOCASE OR r.assigned_to = ? COLLATE NOCASE
        ORDER BY r.id DESC
      `).all(user.id, user.email, user.fullname, (user as unknown as { username?: string }).username ?? "") as Record<string, unknown>[];
      // de-duplicate by public_id (assigned + owned overlap)
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const pid = String(r["public_id"]);
        if (seen.has(pid)) return false;
        seen.add(pid);
        return true;
      });
      if (filterStatus) rows = rows.filter((r) => String(r["status"]) === filterStatus);
    } else {
      // complainant: only own requests
      rows = db.prepare(`SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id WHERE r.owner_id = ? OR r.owner_email = ? COLLATE NOCASE ORDER BY r.id DESC`).all(user.id, user.email) as Record<string, unknown>[];
      if (filterRole && filterRole !== role) {
        // non-admin cannot fetch other roles
        rows = [];
      }
      if (filterStatus) rows = rows.filter((r) => String(r["status"]) === filterStatus);
    }
    return json({ ok: true, requests: rows.map(mapReq), count: rows.length }, 200, req);
  }

  // GET /api/requests/:publicId — single request
  if (url.pathname.match(/^\/api\/requests\/[^\/]+$/) && req.method === "GET") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    const publicId = decodeURIComponent(url.pathname.split("/").pop()!);
    const row = db.prepare(`SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id WHERE r.public_id = ?`).get(publicId) as Record<string, unknown> | undefined;
    if (!row) return json({ ok: false, error: "request not found" }, 404, req);
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = String(row["owner_email"]).toLowerCase() === String(user.email).toLowerCase() || Number(row["owner_id"]) === Number(user.id);
    const isTechnicianAssigned = user.role === "technician" && (
      String(row["assigned_to"]).toLowerCase() === String(user.fullname).toLowerCase() ||
      String(row["assigned_to"]).toLowerCase() === String((user as unknown as { username?: string }).username ?? "").toLowerCase()
    );
    if (!isAdmin && !isOwner && !isTechnicianAssigned) return json({ ok: false, error: "forbidden" }, 403, req);
    return json({ ok: true, request: mapReq(row) }, 200, req);
  }

  // POST /api/requests — create new request (any authenticated user)
  if (url.pathname === "/api/requests" && req.method === "POST") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    const body = await req.json().catch(() => null) as {
      title?: string; description?: string; category?: string; type?: string; otherServiceDesc?: string;
      location?: string; priority?: string; status?: string; dueDate?: string;
    } | null;
    if (!body) return json({ ok: false, error: "invalid json" }, 400, req);
    const title = body.title?.trim();
    const description = body.description?.trim();
    const category = body.category?.trim();
    if (!title || !description || !category) return json({ ok: false, error: "title, description, category required" }, 400, req);
    const type = body.type?.trim() ?? "";
    const otherDesc = body.otherServiceDesc?.trim() ?? "";
    const location = body.location?.trim() ?? "";
    let priority = (body.priority?.trim() ?? "Medium") as "Low"|"Medium"|"High"|"Urgent";
    if (!["Low","Medium","High","Urgent"].includes(priority)) priority = "Medium";
    const status = "pending" as const;
    const createdDate = new Date().toISOString().split("T")[0];
    const dueDate = body.dueDate?.trim() || new Date(Date.now() + 7*24*60*60*1000).toISOString().split("T")[0];

    // generate unique public_id
    let publicId = "REQ-" + String(Date.now()).slice(-5);
    // ensure unique
    let tries = 0;
    while (db.prepare("SELECT 1 FROM requests WHERE public_id = ?").get(publicId) && tries < 5) {
      publicId = "REQ-" + String(Date.now() + tries + 1).slice(-5) + String(Math.floor(Math.random()*9));
      tries++;
    }

    db.prepare(`
      INSERT INTO requests (public_id, title, description, status, type, category, other_service_desc, location, priority, created_date, due_date, assigned_to, owner_id, owner_email, owner_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(publicId, title, description, status, type, category, otherDesc, location, priority, createdDate, dueDate, "Pending Assignment", user.id, user.email, user.fullname);

    const row = db.prepare(`SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id WHERE r.public_id = ?`).get(publicId) as Record<string, unknown>;
    return json({ ok: true, request: mapReq(row) }, 201, req);
  }

  // PUT /api/requests/:publicId — admin can update priority/assignedTo/status; owner can update own pending fields
  if (url.pathname.match(/^\/api\/requests\/[^\/]+$/) && req.method === "PUT") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    const publicId = decodeURIComponent(url.pathname.split("/").pop()!);
    const existing = db.prepare("SELECT * FROM requests WHERE public_id = ?").get(publicId) as Record<string, unknown> | undefined;
    if (!existing) return json({ ok: false, error: "request not found" }, 404, req);
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = String(existing["owner_email"]).toLowerCase() === String(user.email).toLowerCase() || Number(existing["owner_id"]) === Number(user.id);
    const isTechnicianAssigned = user.role === "technician" && (
      String(existing["assigned_to"]).toLowerCase() === String(user.fullname).toLowerCase() ||
      String(existing["assigned_to"]).toLowerCase() === String((user as unknown as { username?: string }).username ?? "").toLowerCase()
    );
    if (!isAdmin && !isOwner && !isTechnicianAssigned) return json({ ok: false, error: "forbidden" }, 403, req);

    const body = await req.json().catch(() => null) as {
      priority?: string; assignedTo?: string; status?: string; title?: string; description?: string; location?: string; category?: string; type?: string;
      confirmed?: boolean; evidence?: unknown[]; materials?: unknown[];
    } | null;
    if (!body) return json({ ok: false, error: "invalid json" }, 400, req);

    // Determine allowed fields
    const updates: Record<string, unknown> = {};
    if (body.priority && ["Low","Medium","High","Urgent"].includes(body.priority)) updates["priority"] = body.priority;
    if (body.status && ["pending","in-progress","completed","rejected"].includes(body.status)) {
      if (!isAdmin) {
        // technician assigned can progress their own jobs: pending→in-progress→completed
        if (isTechnicianAssigned && ["in-progress","completed"].includes(body.status)) {
          // allowed
        } else if (body.status !== "pending") {
          return json({ ok: false, error: "only admin can change status" }, 403, req);
        }
      }
      updates["status"] = body.status;
    }
    if (body.assignedTo !== undefined) {
      if (!isAdmin) return json({ ok: false, error: "only admin can assign technician" }, 403, req);
      const newAssignee = String(body.assignedTo ?? "").trim();
      updates["assigned_to"] = body.assignedTo;
      // Stamp Job Order when admin assigns a real technician (not Pending Assignment)
      if (newAssignee && newAssignee.toLowerCase() !== "pending assignment") {
        const existingJO = String(existing["job_order_no"] ?? "");
        updates["job_order_no"] = existingJO || `JO-${publicId}`;
        updates["job_order_issued_by"] = user.email;
        updates["job_order_issued_at"] = new Date().toISOString();
      } else {
        // unassign: clear job order (keep history? clear for now)
        // keep job_order fields as-is if already issued? optional clear:
        // commented to preserve JO after unassign for audit
        // updates["job_order_no"] = null; updates["job_order_issued_by"] = null; updates["job_order_issued_at"] = null;
      }
    }
    // ADMIN confirmation of work — admin only, stamps confirmed_by/at
    if (body.confirmed !== undefined) {
      if (!isAdmin) return json({ ok: false, error: "only admin can confirm work" }, 403, req);
      if (body.confirmed) {
        updates["confirmed"] = 1;
        updates["confirmed_by"] = user.email;
        updates["confirmed_at"] = new Date().toISOString();
      } else {
        updates["confirmed"] = 0;
        updates["confirmed_by"] = null;
        updates["confirmed_at"] = null;
      }
    }
    // Technician evidence & required materials — allowed for assigned technician and admin
    const canEditTechFields = isAdmin || isTechnicianAssigned;
    if (body.evidence !== undefined) {
      if (!canEditTechFields) return json({ ok: false, error: "only assigned technician or admin can update evidence" }, 403, req);
      if (!Array.isArray(body.evidence)) return json({ ok: false, error: "evidence must be array" }, 400, req);
      // basic sanitization: limit 20 items, each max ~2MB base64
      const sanitized = (body.evidence as unknown[]).slice(0, 20).map((e) => {
        const o = e as Record<string, unknown>;
        return {
          id: String(o["id"] ?? `ev-${Date.now()}-${Math.random().toString(36).slice(2,6)}`),
          name: String(o["name"] ?? "evidence").slice(0, 120),
          dataUrl: o["dataUrl"] ? String(o["dataUrl"]).slice(0, 2_500_000) : null, // allow image preview
          size: Number(o["size"] ?? 0),
          uploadedAt: String(o["uploadedAt"] ?? new Date().toISOString()),
          uploadedBy: String(o["uploadedBy"] ?? user.email).slice(0, 120),
        };
      });
      updates["evidence_json"] = JSON.stringify(sanitized);
    }
    if (body.materials !== undefined) {
      if (!canEditTechFields) return json({ ok: false, error: "only assigned technician or admin can update materials" }, 403, req);
      if (!Array.isArray(body.materials)) return json({ ok: false, error: "materials must be array" }, 400, req);
      const sanitizedM = (body.materials as unknown[]).slice(0, 50).map((m) => {
        const o = m as Record<string, unknown>;
        return {
          id: String(o["id"] ?? `mt-${Date.now()}-${Math.random().toString(36).slice(2,6)}`),
          name: String(o["name"] ?? "").slice(0, 120),
          qty: Number(o["qty"] ?? 0),
          unit: String(o["unit"] ?? "pcs").slice(0, 20),
          note: String(o["note"] ?? "").slice(0, 300),
          addedAt: String(o["addedAt"] ?? new Date().toISOString()),
          addedBy: String(o["addedBy"] ?? user.email).slice(0, 120),
        };
      }).filter((x) => x.name);
      updates["materials_json"] = JSON.stringify(sanitizedM);
    }
    // owner-editable before assignment (admin can also edit)
    if (isOwner || isAdmin) {
      if (body.title) updates["title"] = body.title.trim();
      if (body.description) updates["description"] = body.description.trim();
      if (body.location !== undefined) updates["location"] = body.location.trim();
      if (body.category) updates["category"] = body.category.trim();
      if (body.type !== undefined) updates["type"] = body.type.trim();
    }

    if (Object.keys(updates).length === 0) return json({ ok: false, error: "no valid fields to update" }, 400, req);

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    const vals = [...Object.values(updates), publicId] as unknown as (string | number | null)[];
    (db.prepare(`UPDATE requests SET ${setClause} WHERE public_id = ?`) as unknown as { run: (...args: unknown[]) => void }).run(...(vals as unknown[]));

    const row = db.prepare(`SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id WHERE r.public_id = ?`).get(publicId) as Record<string, unknown>;
    return json({ ok: true, request: mapReq(row) }, 200, req);
  }

  // DELETE /api/requests/:publicId — admin only (or owner can delete own pending)
  if (url.pathname.match(/^\/api\/requests\/[^\/]+$/) && req.method === "DELETE") {
    const token = getTokenFromRequest(req);
    const user = token ? verifyToken(token) : null;
    if (!user) return json({ ok: false, error: "not authenticated" }, 401, req);
    const publicId = decodeURIComponent(url.pathname.split("/").pop()!);
    const existing = db.prepare("SELECT * FROM requests WHERE public_id = ?").get(publicId) as Record<string, unknown> | undefined;
    if (!existing) return json({ ok: false, error: "request not found" }, 404, req);
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = String(existing["owner_email"]).toLowerCase() === String(user.email).toLowerCase();
    if (!isAdmin && !(isOwner && String(existing["status"]) === "pending")) return json({ ok: false, error: "forbidden" }, 403, req);
    db.prepare("DELETE FROM requests WHERE public_id = ?").run(publicId);
    return json({ ok: true }, 200, req);
  }

  return null; // not an API route
}

// ---- Static file handler ----
async function serveStatic(pathname: string): Promise<Response | null> {
  let filePath = pathname;
  if (filePath === "/") filePath = "/index.html";
  filePath = filePath.split("?")[0].split("#")[0];
  if (filePath.includes("..")) return new Response("Bad Request", { status: 400 });

  const candidates = [
    `${STATIC_ROOT}${filePath}`,
    `.${filePath}`,
  ];

  for (const cand of candidates) {
    try {
      const stat = await Deno.stat(cand);
      if (stat.isDirectory) {
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

  if (url.pathname.startsWith("/api/")) {
    const apiRes = await handleApi(req, url);
    if (apiRes) return apiRes;
    return json({ ok: false, error: "not found" }, 404, req);
  }

  const fileRes = await serveStatic(url.pathname);
  if (fileRes) return fileRes;

  return new Response(`Not found: ${url.pathname}\nTry /index.html`, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(req) },
  });
}

// ---- LAN IP detection ----
async function getLanIps(): Promise<string[]> {
  const ips: string[] = [];
  try {
    const cmd = new Deno.Command("sh", { args: ["-c", "ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}'"], stdout: "piped" });
    const { stdout } = await cmd.output();
    const out = new TextDecoder().decode(stdout).trim();
    if (out) ips.push(...out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch { /* fallback */ }
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
console.log(`  DB          : ${Deno.env.get("DB_PATH") ?? "./data/facilix.db"} (${(db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c} users)`);
console.log(`  Binding     : http://${HOST}:${PORT}`);
console.log(`\n  Local       : http://localhost:${PORT}/`);
for (const ip of lanIps) {
  console.log(`  LAN         : http://${ip}:${PORT}/   ← open on phone/tablet on same Wi-Fi`);
}
console.log(`  Health      : http://localhost:${PORT}/api/health`);
console.log(`  Auth        : POST /api/auth/register  POST /api/auth/login  GET /api/auth/me`);
console.log(`  Roles       : superadmin > admin > technician > complainant`);
console.log(`  Seeds       : superadmin@facilix.com / SuperAdmin123!  |  admin@facilix.com / Admin123!  |  technician@facilix.com / Tech123!  |  complainant@facilix.com / User123!`);
console.log(`\n  WAN (pick one):`);
console.log(`    • Cloudflare:  cloudflared tunnel --url http://localhost:${PORT}`);
console.log(`    • ngrok:       ngrok http ${PORT}`);
console.log(`    • Tailscale:   tailscale funnel ${PORT}`);
console.log(`    • Or: deno task expose:wan   (see scripts/expose.sh)`);
console.log(`\n  Press Ctrl+C to stop.\n`);

Deno.serve({ hostname: HOST, port: PORT, handler });
