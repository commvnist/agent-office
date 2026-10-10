import { defineConfig } from "vite";
// Dev: `npm run dev -w @agent-office/web` proxies the daemon so the page sees live state.
export default defineConfig({
  base: "./",
  build: { target: "esnext" }, // local-only tab: modern browsers, top-level await
  server: { proxy: { "/stream": "http://127.0.0.1:4747", "/state": "http://127.0.0.1:4747" } },
});
