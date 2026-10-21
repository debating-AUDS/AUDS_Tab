import { writeFileSync } from "node:fs";
import { handle } from "../src/index.ts";
import { D1Shim } from "./d1shim.ts";
import { seedDemo } from "./seed.ts";
const env: any = { DB: new D1Shim(), ASSETS: { fetch: async () => new Response("nf", { status: 404 }) }, ADMIN_PASSWORD: "admin123", SESSION_SECRET: "s" };
await seedDemo(env);
const login = await handle(new Request("http://x/api/login", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" }, body: JSON.stringify({ password: "admin123" }) }), env);
const cookie = login.headers.get("set-cookie")!.split(";")[0];
const list: any = await (await handle(new Request("http://x/api/admin/tournaments", { headers: { cookie } }), env)).json();
for (const t of list.tournaments) {
  const r = await handle(new Request(`http://x/api/admin/t/${t.slug}/export.xlsx`, { headers: { cookie } }), env);
  if (r.status !== 200) throw new Error("xlsx " + r.status + await r.text());
  writeFileSync(process.argv[2] + "/" + t.slug + ".xlsx", Buffer.from(await r.arrayBuffer()));
  const j = await handle(new Request(`http://x/api/admin/t/${t.slug}/export`, { headers: { cookie } }), env);
  writeFileSync(process.argv[2] + "/" + t.slug + ".json", Buffer.from(await j.arrayBuffer()));
}
console.log("written");
