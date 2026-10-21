import assert from "node:assert/strict";
import { generateDraw, rollCheck } from "../src/engine/draw.ts";
import { seededRng } from "../src/engine/rng.ts";
import { adjudicatorScore } from "../src/engine/adjudicators.ts";
import { validateAndPlace } from "../src/engine/results.ts";

const adjs = (n: number) => Array.from({ length: n }, (_, i) => ({ name: "Adj" + i, trainee: false, attending: true, avg: 5 + i / 10, count: 3, confidence: 50 }));
// BP: 6 two-person teams + 2 lone speakers (N) = 7 teams -> need a swing team to reach 8
const roll: any[] = [];
for (let t = 1; t <= 6; t++) { roll.push({ name: `A${t}`, team: t, present: true }, { name: `B${t}`, team: t, present: true }); }
roll.push({ name: "LoneX", team: 7, present: true }, { name: "LoneY", team: 8, present: true });
let chk = rollCheck("BP", roll, { LoneX: "N", LoneY: "N" }, {});
assert.equal(chk.expectedTeams, 7); assert.equal(chk.divisible, false);
roll.push({ name: "Swing1", team: 101, present: true }, { name: "Swing2", team: 101, present: true });
chk = rollCheck("BP", roll, { LoneX: "N", LoneY: "N" }, {});
assert.equal(chk.expectedTeams, 8);
const base = { format: "BP" as const, round: 1, roll, solo: { LoneX: "N", LoneY: "N" } as any, pair: {}, power: "none" as const, ranks: new Map(), posHistory: new Map(), adjudicators: adjs(5), roomNames: ["R1", "R2", "R3"], rng: seededRng(3) };
const out = generateDraw(base);
assert.ok(!out.error, out.error);
assert.equal(out.rooms!.length, 2);
const speakers = out.rooms!.flatMap((r) => r.teams.flatMap((t) => t.speakers.map((s) => s.name)));
assert.equal(new Set(speakers).size, 16); // everyone placed exactly once
const merged = out.rooms!.flatMap((r) => r.teams).find((t) => t.merged)!;
assert.deepEqual(merged.speakers.map((s) => s.name).sort(), ["LoneX", "LoneY"]);
assert.equal(merged.team, 7);
// swing team lands in the last room
assert.ok(out.rooms![1].teams.some((t) => t.team === 101));
// every room has a chair, panelists spread 3/2 with best going to top room
assert.equal(out.rooms!.every((r) => r.adjudicators.filter((a) => a.role === "C").length === 1), true);
// adjudicator error
assert.ok(generateDraw({ ...base, adjudicators: adjs(1) }).error);
// position avoidance: team that has been OG must not be OG again when avoidable
const hist = new Map([[1, new Set(["OG"])], [2, new Set(["OO"])], [3, new Set(["CG"])], [4, new Set(["CO"])]]);
const o2 = generateDraw({ ...base, round: 2, posHistory: hist, rng: seededRng(5) });
for (const room of o2.rooms!) for (const t of room.teams) if (hist.has(t.team)) assert.ok(!hist.get(t.team)!.has(t.position) || room.teams.filter(x=>hist.has(x.team)).length<4);
// wilson: no data + no confidence ranks at bottom
assert.ok(adjudicatorScore(null, 0, 0) < adjudicatorScore(7, 0, 100));
assert.ok(adjudicatorScore(7, 30, 0) > adjudicatorScore(7, 2, 0));
// 3v3 merge: lone + pair -> team of 3
const r3: any[] = [
  { name: "L", team: 9, present: true }, { name: "P1", team: 10, present: true }, { name: "P2", team: 10, present: true },
  ...["a","b","c"].map((n) => ({ name: n, team: 11, present: true })),
];
const o3 = generateDraw({ ...base, format: "3v3", roll: r3, solo: { L: "N" }, pair: { 10: "N" }, adjudicators: adjs(2), rng: seededRng(1) });
assert.ok(!o3.error, o3.error);
const mt = o3.rooms![0].teams.find((t) => t.merged)!;
assert.equal(mt.speakers.length, 3); assert.equal(mt.team, 9);
// tie in a room cannot complete
const rows = ["a","b","c"].map((s,i)=>({round:1,room:"R",position:"Aff",team:1,speaker:s,score:60,originalTeam:1,merged:false,placement:null,teamTotal:null}))
 .concat(["d","e","f"].map((s)=>({round:1,room:"R",position:"Neg",team:2,speaker:s,score:60,originalTeam:2,merged:false,placement:null,teamTotal:null})));
assert.match(validateAndPlace({ format: "3v3", roundNo: 1, rows, allowDuplicateSpeakers: false }).error!, /tie/);
rows[0].score = 61;
const v = validateAndPlace({ format: "3v3", roundNo: 1, rows, allowDuplicateSpeakers: false });
assert.equal(v.placements!.get(1), 1); assert.ok(Math.abs(v.totals!.get(1)! - 60.3333333) < 1e-5);
console.log("Engine tests passed");
