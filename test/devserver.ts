// Local preview server (no Cloudflare needed): serves ./public and the Worker API over in-memory SQLite.
//   node test/devserver.ts [--seed] [--port 8787]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handle } from "../src/index.ts";
import { D1Shim } from "./d1shim.ts";
import { seedDemo } from "./seed.ts";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8787;
const env: any = {
  DB: new D1Shim(),
  ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  ADMIN_PASSWORD: "admin123",
  SESSION_SECRET: "dev-secret",
};
const publicDir = new URL("../public/", import.meta.url).pathname;
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

if (process.argv.includes("--seed")) await seedDemo(env);

createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await handle(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method!) ? undefined : Buffer.concat(chunks) }), env);
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => (out[k] = v));
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  try {
    const data = await readFile(join(publicDir, p));
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}  (admin password: admin123)`));
