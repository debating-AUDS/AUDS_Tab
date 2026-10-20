// Bindings available to the Worker. Matches wrangler.jsonc; secrets are set with
// `npx wrangler secret put ADMIN_PASSWORD` and `npx wrangler secret put SESSION_SECRET`.
// (Types such as D1Database come from @cloudflare/workers-types.)

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}
