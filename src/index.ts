import type { Env } from "./env.ts";
import { HttpError, json } from "./http.ts";
import { Router } from "./router.ts";
import { registerPublic } from "./routes-public.ts";
import { registerAdmin } from "./routes-admin.ts";

const router = new Router();
registerPublic(router);
registerAdmin(router);

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) {
    // Static site (normally served straight from assets; this is only a fallback).
    return env.ASSETS.fetch(req);
  }
  try {
    const m = router.match(req.method, url.pathname);
    if (m === null) return json({ error: "Not found." }, 404);
    if (m === "method") return json({ error: "Method not allowed." }, 405);
    return await m.handler({ env, req, url, params: m.params });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error(JSON.stringify({ level: "error", message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack }));
    return json({ error: "Something went wrong on the server." }, 500);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
} satisfies ExportedHandler<Env>;
