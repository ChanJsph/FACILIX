import { defineConfig } from "vite";
import { resolve } from "path";

// Multi-page app: every .html at root is an entry
export default defineConfig({
  root: ".",
  // keep static/ as normal folder (served at /static/... in dev)
  // do NOT set publicDir to "static" — that would copy contents to dist root and break /static/... URLs
  publicDir: false,
  server: {
    host: "0.0.0.0", // LAN accessible — binds to all interfaces
    port: 5173,
    strictPort: false,
    cors: true,
    open: false,
    hmr: {
      // HMR must know the host when accessed from LAN devices
      // clientPort defaults to 5173, which works for LAN
      clientPort: 5173,
    },
    // forward /api to Deno if it's running (vite + deno together)
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0", // LAN accessible preview of production build
    port: 4173,
    strictPort: false,
    cors: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        home: resolve(__dirname, "home.html"),
        login: resolve(__dirname, "login.html"),
        register: resolve(__dirname, "register.html"),
        services: resolve(__dirname, "services.html"),
        "services-dashboard": resolve(__dirname, "services-dashboard.html"),
        requests: resolve(__dirname, "requests.html"),
        reports: resolve(__dirname, "reports.html"),
        "reports-dashboard": resolve(__dirname, "reports-dashboard.html"),
        about: resolve(__dirname, "about.html"),
        "about-dashboard": resolve(__dirname, "about-dashboard.html"),
        technicians: resolve(__dirname, "technicians.html"),
        "technician-dashboard": resolve(__dirname, "technician-dashboard.html"),
      },
    },
  },
  // Proxy /api to Deno during dev so Vite + Deno work together
  // Run Deno on :8000 and Vite will forward requests
  // deno run -A server.ts  (in another terminal) or `deno task dev:all`
});
