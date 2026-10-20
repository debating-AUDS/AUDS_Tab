import type { Env } from "./env.ts";

export interface Ctx {
  env: Env;
  req: Request;
  url: URL;
  params: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Response>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
  }
  get(p: string, h: Handler): void {
    this.add("GET", p, h);
  }
  post(p: string, h: Handler): void {
    this.add("POST", p, h);
  }
  put(p: string, h: Handler): void {
    this.add("PUT", p, h);
  }
  patch(p: string, h: Handler): void {
    this.add("PATCH", p, h);
  }
  delete(p: string, h: Handler): void {
    this.add("DELETE", p, h);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const segs = pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(":")) {
          try {
            params[p.slice(1)] = decodeURIComponent(segs[i]);
          } catch {
            ok = false;
            break;
          }
        } else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}
