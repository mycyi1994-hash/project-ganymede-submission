// Local UI preview. Only two public GET endpoints are proxied; transactions are never forwarded.
import { createServer, request } from "node:http";
const port = Number(process.env.PRODUCT_PREVIEW_PORT || 3128);
const devPort = Number(process.env.PRODUCT_DEV_PORT || 3127);
const failMarket = process.argv.includes("--fail-market");
const cache = new Map();
createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end("Read-only preview"); return; }
  const path = new URL(req.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
    if (path === "/api/portfolio") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ investor: null, positions: [], subscriptions: [], redemptions: [] })); return; }
    if (!["/api/xstocks", "/api/market"].includes(path)) { res.writeHead(404); res.end(); return; }
    if (failMarket) { res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":"Local failure preview"}'); return; }
    try {
      let value = cache.get(path);
      if (!value || Date.now() - value.at > 10_000) {
        const response = await fetch(`https://ganymede-xlayer.gana003.workers.dev${path}`, { signal: AbortSignal.timeout(15_000) });
        value = { at: Date.now(), status: response.status, text: await response.text() }; cache.set(path, value);
      }
      res.writeHead(value.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(value.text);
    } catch { res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":"Public read unavailable"}'); }
    return;
  }
  const upstream = request({ hostname: "localhost", port: devPort, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${devPort}` } }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  upstream.on("error", () => { res.writeHead(502); res.end("Local preview is starting. Reload shortly."); });
  req.pipe(upstream);
}).listen(port, "localhost", () => console.log(`Read-only product preview: http://localhost:${port}${failMarket ? " (market failure)" : ""}`));
