// End-to-end API test: runs the real Worker handler against an in-memory SQLite database.
import assert from "node:assert/strict";
import { handle } from "../src/index.ts";
import { D1Shim } from "./d1shim.ts";

const env: any = {
  DB: new D1Shim(),
  ASSETS: { fetch: async () => new Response("asset") },
  ADMIN_PASSWORD: "correct horse",
  SESSION_SECRET: "test-secret",
};
let cookie = "";
async function api(method: string, path: string, body?: any, opts: { anon?: boolean } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": "1.2.3.4", "user-agent": "test" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie && !opts.anon) headers.cookie = cookie;
  const res = await handle(new Request("http://x" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const set = res.headers.get("set-cookie");
  if (set && set.includes("auds_admin=") && !set.includes("Max-Age=0")) cookie = set.split(";")[0];
  const data = await res.json();
  return { status: res.status, data: data as any };
}
const ok = async (m: string, p: string, b?: any) => {
  const r = await api(m, p, b);
  assert.equal(r.status < 300, true, `${m} ${p} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

// --- auth
assert.equal((await api("GET", "/api/admin/tournaments", undefined, { anon: true })).status, 401);
assert.equal((await api("POST", "/api/login", { password: "nope" })).status, 401);
await ok("POST", "/api/login", { password: "correct horse" });
assert.equal((await ok("GET", "/api/me")).admin, true);

// --- tournament, roll, adjudicators
const created = await ok("POST", "/api/admin/tournaments", { name: "Test Cup 2026", format: "3v3", totalRounds: 3 });
const slug = created.tournament.slug;
assert.equal(slug, "test-cup-2026");
assert.equal((await api("POST", "/api/admin/tournaments", { name: "Second", format: "BP", totalRounds: 2 })).status, 409);

const people: [string, number][] = [
  ["Alice", 1], ["Bob", 1], ["Cody", 2], ["Devi", 2], ["Edward", 2], ["Francis", 3], ["Georgia", 3],
  ["Heidi", 4], ["Isabella", 4], ["James", 4],
];
await ok("PUT", `/api/admin/t/${slug}/roll`, { rows: people.map(([name, team]) => ({ name, team, present: true })) });
let rc = await ok("GET", `/api/admin/t/${slug}/roll`);
assert.equal(rc.check.pairs.length, 2); // teams 1 and 3 are two-person teams
await ok("PUT", `/api/admin/t/${slug}/roll-decisions`, { pair: { 1: "Y", 3: "Y" } });
rc = await ok("GET", `/api/admin/t/${slug}/roll`);
assert.equal(rc.check.expectedTeams, 4);
assert.equal(rc.check.divisible, true);

for (const n of ["Abdul", "Beatrice", "Connor"]) {
  await ok("POST", `/api/admin/t/${slug}/adjudicators`, { name: n, baseAvg: 6, confidence: 50, attending: true });
}
await ok("POST", `/api/admin/t/${slug}/adjudicators`, { name: "Trent", trainee: true });

// draw requires roll complete
assert.equal((await api("POST", `/api/admin/t/${slug}/rounds/1/draw`, { power: "none" })).status, 409);
await ok("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true });
const d1 = await ok("POST", `/api/admin/t/${slug}/rounds/1/draw`, { power: "none", seed: 7 });
assert.equal(d1.draw.rooms.length, 2);
assert.equal(d1.draw.rooms.every((r: any) => r.adjudicators.some((a: any) => a.role === "C")), true);
// public cannot see an unpublished draw
assert.equal((await ok("GET", `/api/public/t/${slug}/rounds/1`)).draw, null);
await ok("PUT", `/api/admin/t/${slug}/rounds/1/publish`, { published: true });
assert.equal((await ok("GET", `/api/public/t/${slug}/rounds/1`)).draw.rooms.length, 2);

// --- results
let res = await ok("POST", `/api/admin/t/${slug}/rounds/1/results/build`, {});
let rows = res.results.rooms.flatMap((r: any) => r.teams.flatMap((t: any) => t.rows.map((x: any) => ({ ...x, team: t.team }))));
// teams of two need an iron-person: lone rows are CHOOSE IRON placeholders
assert.equal(rows.filter((x: any) => x.needsIron).length, 2);
let n = 0;
const fill = (rowsIn: any[], base: number) =>
  rowsIn.map((x: any, i: number) => ({ id: x.id, score: base + i }));
assert.equal((await api("POST", `/api/admin/t/${slug}/rounds/1/complete`, {})).status, 422); // missing scores / iron
// replace placeholders with the first real speaker of that team
const upd = rows.map((x: any) => {
  let speaker = x.speaker;
  if (x.needsIron) speaker = rows.find((y: any) => y.team === x.team && !y.needsIron).speaker;
  return { id: x.id, speaker, score: 60 + (n++) % 7 + (x.team === 2 ? 10 : 0) };
});
res = await ok("PUT", `/api/admin/t/${slug}/rounds/1/results`, { rows: upd });
let c = await api("POST", `/api/admin/t/${slug}/rounds/1/complete`, {});
if (c.status !== 200) console.log("complete ->", c.status, c.data);
assert.equal(c.status, 200);
assert.equal(c.data.status, "completed");

const lb = (await ok("GET", `/api/public/t/${slug}/leaderboard`)).leaderboard;
assert.equal(lb.teams.length, 4);
assert.equal(lb.speakers.length, 10);
assert.equal(lb.completedRounds[0], 1);
const t = (await ok("GET", `/api/public/t/${slug}`)).tournament;
assert.equal(t.currentRound, 2);

// round 2 draw with strict power pairing
await ok("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true });
const d2 = await ok("POST", `/api/admin/t/${slug}/rounds/2/draw`, { power: "strict", seed: 11 });
assert.equal(d2.draw.rooms.length, 2);
await ok("PUT", `/api/admin/t/${slug}/rounds/2/publish`, { published: true });

// --- public feedback
const form = await ok("GET", `/api/public/t/${slug}/feedback-form`);
assert.equal(form.rounds.length, 2);
const room = form.rounds[0].rooms[0];
const teamGiver = room.givers.find((g: any) => g.kind === "team");
const chair = room.adjudicators.find((a: any) => a.role === "C").name;
let fb = await api("POST", `/api/public/t/${slug}/feedback`, {
  round: 1, room: room.room, giverId: teamGiver.id, ratings: [{ adjudicator: chair, score: 8, comment: "great" }],
}, { anon: true });
assert.equal(fb.status, 200, JSON.stringify(fb.data));
fb = await api("POST", `/api/public/t/${slug}/feedback`, {
  round: 1, room: room.room, giverId: teamGiver.id, ratings: [{ adjudicator: "Nobody", score: 8 }],
}, { anon: true });
assert.equal(fb.status, 400);
fb = await api("POST", `/api/public/t/${slug}/feedback`, {
  round: 1, room: room.room, giverId: teamGiver.id, ratings: [{ adjudicator: chair, score: 11 }],
}, { anon: true });
assert.equal(fb.status, 400);
const grid = await ok("GET", `/api/admin/t/${slug}/rounds/1/feedback`);
const slot = grid.rooms.flatMap((r: any) => r.slots).find((s: any) => s.entries.length);
assert.equal(slot.avg, 8);

// adjudicator stats now include the feedback (round 1 is completed)
const adjs = (await ok("GET", `/api/admin/t/${slug}/adjudicators`)).adjudicators;
const chairView = adjs.find((a: any) => a.name === chair);
assert.equal(chairView.thisTournament.count, 1);
assert.equal(chairView.count, 1);

// --- archive carries feedback into the baseline and freezes the tournament
await ok("POST", `/api/admin/t/${slug}/archive`, {});
assert.equal((await api("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true })).status, 409);
const list = (await ok("GET", `/api/public/tournaments`)).tournaments;
assert.equal(list[0].status, "archived");
const next = await ok("POST", "/api/admin/tournaments", { name: "Next Cup", format: "BP", totalRounds: 2 });
const adjs2 = (await ok("GET", `/api/admin/t/${next.tournament.slug}/adjudicators`)).adjudicators;
assert.equal(adjs2.find((a: any) => a.name === chair).baseline.count, 1);
console.log("API tests passed");
