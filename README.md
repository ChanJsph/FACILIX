# FACILIX — Intelligent Facility Management System

Static multi-page app (11 HTML pages) with Vite for HMR/bundling and Deno for serving + API. Dev servers bind to `0.0.0.0` for LAN/WAN access.

## Stack

- **Vite 6** — dev server + build (`vite.config.ts:5`)
- **Deno 2** — static + API server (`server.ts:38`)
- Frontend: `index.html`, `home.html`, `login.html`, `register.html`, `services*.html`, `requests.html`, `reports*.html`, `about*.html`
- Assets: `css/styles.css`, `scripts/script.js`, `static/building.png`
- Build output: `dist/` (`vite.config.ts:26`)

## Prerequisites

- Node 18+ (`node --version`), npm 9+
- Deno 2 (`deno --version`) — `brew install deno` on macOS

## Install

```bash
# from project root
deno install        # installs vite + concurrently via deno.lock (preferred on this network)
# or
npm install         # same deps via package.json
```

> `deno install` uses `deno.json:16` imports (`vite@^6.3.5`); `npm install` uses `package.json:20`.

## Dev — LAN

Both servers bind `host: "0.0.0.0"` so phones/tablets on same Wi-Fi can connect.

### 1) Vite only (frontend HMR)

```bash
deno task dev:vite      # deno.json:5  → http://localhost:5173 + http://<LAN_IP>:5173
# or
npm run dev             # package.json:8 — same
```

Vite config: `vite.config.ts:8` (`host: "0.0.0.0"`, `port: 5173`, `hmr.clientPort: 5173`, `proxy["/api"] → http://localhost:8000`).

Find LAN IP:

```bash
ipconfig getifaddr en0          # macOS
# or
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Open on another device: `http://<LAN_IP>:5173/` (e.g. `http://10.112.147.35:5173/`).

### 2) Deno only (static + API)

```bash
deno task serve         # deno.json:11 → deno run -A --watch server.ts
# or
npm run serve
```

Server: `server.ts:12` (`PORT=8000`, `HOST=0.0.0.0`, `Deno.serve`), static root `server.ts:16` (`./dist` if exists else `.`), MIME `server.ts:22`, CORS `server.ts:39`.

Endpoints:

- `GET /api/health` → `{ok, service, time}` (`server.ts:68`)
- `GET /api/status` → `{staticRoot, users, uptime}` (`server.ts:72`)
- `GET /api/users`, `POST /api/register`, `POST /api/login` (`server.ts:77`)

Open: `http://<LAN_IP>:8000/` and `http://<LAN_IP>:8000/api/health`.

### 3) Both together (recommended)

Vite proxies `/api` to Deno, so frontend can `fetch("/api/...")`.

```bash
deno task dev           # deno.json:4 → deno task dev:all (concurrently vite + deno)
deno task dev:all       # deno.json:7
# or
npm run dev:all         # package.json:11
```

Logs show both:

```
VITE v6.4.3  ready in 200 ms
  ➜  Network: http://10.112.147.35:5173/
FACILIX Deno server starting...
  LAN: http://10.112.147.35:8000/
```

Kill: `Ctrl+C` (concurrently forwards SIGINT to both).

### Firewall (macOS)

System Settings → Network → Firewall → Options → Allow `node` and `deno` incoming. Or:

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which deno)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblock $(which node)
```

If LAN still unreachable, try `PORT=8000 deno task serve` and check `lsof -i :5173 -i :8000`.

## Dev — WAN (public URL)

Pick one tunnel — no code change, binds remain `0.0.0.0`.

### Cloudflared (recommended, no signup)

```bash
brew install cloudflared
# Deno API + static
deno task expose:wan              # scripts/expose.sh:14 → cloudflared tunnel --url http://localhost:8000
# Vite HMR (if you need HMR over WAN)
deno task expose:wan:vite         # → cloudflared tunnel --url http://localhost:5173
# or manual
cloudflared tunnel --url http://localhost:8000
cloudflared tunnel --url http://localhost:5173
```

Share the `https://*.trycloudflare.com` URL.

### ngrok

```bash
brew install ngrok
ngrok http 8000                   # Deno
ngrok http 5173                   # Vite
# or
npm run expose:wan                # package.json:17 → sh scripts/expose.sh (auto-detects)
```

### Tailscale Funnel

```bash
tailscale funnel 8000             # https://tailscale.com/download
tailscale funnel 5173
```

### Router port-forward (advanced, persistent WAN)

1. Set static LAN IP for this machine.
2. Router admin → Port Forward `8000` + `5173` → `<LAN_IP>`.
3. Open `http://<PUBLIC_IP>:8000` (find via `curl ifconfig.me`).

> HMR over WAN needs `vite.config.ts:14` `hmr.clientPort` to match public port if using raw port-forward; tunnels handle it.

## Build & Preview (LAN)

```bash
deno task build         # deno.json:9 → vite build + copy scripts/static/css to dist/
# or npm run build
ls dist/                # 11 html + assets/building-*.png + assets/styles-*.css + scripts/script.js + static/building.png

deno task preview       # deno.json:10 → vite preview --host 0.0.0.0 --port 4173
# open http://<LAN_IP>:4173/

deno task serve:prod    # build + deno serve dist/ on :8000 (prod-like)
```

`vite.config.ts:26` `build.rollupOptions.input` lists all 11 entries; `publicDir: false` (`vite.config.ts:7`) keeps `/static/...` URLs stable.

## Env

Copy `.env.example:1`:

```bash
cp .env.example .env
# PORT=8000
# HOST=0.0.0.0
# VITE_PORT=5173
```

Overridden by `server.ts:12` (`Deno.env.get("PORT")`).

## Project Structure

```
FACILIX/
├── index.html, home.html, login.html, register.html, services*.html, requests.html, reports*.html, about*.html
├── css/styles.css
├── scripts/script.js        # global helpers: isUserLoggedIn() etc. (scripts/script.js:57)
├── scripts/expose.sh        # WAN helper (auto cloudflared/ngrok/tailscale)
├── static/building.png
├── vite.config.ts           # host 0.0.0.0, MPA, /api proxy
├── server.ts                # Deno.serve 0.0.0.0:8000, static + /api/*
├── deno.json                # tasks: dev, serve, build, expose:wan
├── package.json             # npm scripts mirror deno tasks
└── dist/                    # vite build output (after build)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `curl <LAN_IP>:5173` hangs | Check same Wi-Fi, `host: "0.0.0.0"` in `vite.config.ts:8`, allow firewall. |
| `vite` 404 for `scripts/script.js` in `dist/` | `deno task build` copies `scripts/script.js` to `dist/scripts/` (see `deno.json:9`). Deno serve falls back to `./scripts/script.js` (`server.ts:124`). |
| `npm install` hangs | Use `deno install` (this network prefers Deno fetch). |
| `deno task dev:all` missing `concurrently` | `deno install` pulls `concurrently@9` via `deno.json:16`. |
| HMR not updating on phone | Ensure `vite.config.ts:14` `hmr.clientPort: 5173` and phone uses `http://<LAN_IP>:5173` not `localhost`. |

## Scripts Reference

| Command | What it does |
|---|---|
| `deno task dev:vite` / `npm run dev` | Vite HMR on `0.0.0.0:5173` |
| `deno task dev:deno` / `npm run serve` | Deno watch server on `0.0.0.0:8000` |
| `deno task dev:all` / `npm run dev:all` | Both concurrently |
| `deno task build` / `npm run build` | Vite build to `dist/` |
| `deno task preview` | Preview `dist/` on `0.0.0.0:4173` |
| `deno task expose:wan` | WAN tunnel for `:8000` |
| `deno task expose:wan:vite` | WAN tunnel for `:5173` |
