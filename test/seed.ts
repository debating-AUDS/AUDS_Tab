// Builds a realistic demo tournament through the real API so the UI can be developed against it.
import { handle } from "../src/index.ts";

export async function seedDemo(env: any) {
  let cookie = "";
  const api = async (method: string, path: string, body?: any) => {
    const headers: Record<string, string> = { "cf-connecting-ip": "9.9.9.9", "user-agent": "seed" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    const res = await handle(new Request("http://x" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get("set-cookie");
    if (set && !set.includes("Max-Age=0")) cookie = set.split(";")[0];
    const data: any = await res.json();
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  await api("POST", "/api/login", { password: env.ADMIN_PASSWORD });

  // An older, archived tournament (BP) so the archive page has something in it.
  const old = await api("POST", "/api/admin/tournaments", { name: "AUDS Winter Open 2025", format: "BP", totalRounds: 1 });
  const bpPeople: [string, number][] = [];
  for (let t = 1; t <= 4; t++) bpPeople.push([`Old${t}a`, t], [`Old${t}b`, t]);
  await api("PUT", `/api/admin/t/${old.tournament.slug}/roll`, { rows: bpPeople.map(([name, team]) => ({ name, team, present: true })) });
  for (const n of ["Marcus Hale", "Priya Nair", "Tom Kearney"]) await api("POST", `/api/admin/t/${old.tournament.slug}/adjudicators`, { name: n, confidence: 60 });
  await api("PUT", `/api/admin/t/${old.tournament.slug}/roll-complete`, { complete: true });
  await api("POST", `/api/admin/t/${old.tournament.slug}/rounds/1/draw`, { power: "none", seed: 3 });
  await api("PUT", `/api/admin/t/${old.tournament.slug}/rounds/1/publish`, { published: true });
  let r = await api("POST", `/api/admin/t/${old.tournament.slug}/rounds/1/results/build`, {});
  let k = 70;
  const scores = r.results.rooms.flatMap((rm: any) => rm.teams.flatMap((t: any) => t.rows.map((x: any) => ({ id: x.id, score: (k += 2) }))));
  await api("PUT", `/api/admin/t/${old.tournament.slug}/rounds/1/results`, { rows: scores });
  await api("POST", `/api/admin/t/${old.tournament.slug}/rounds/1/complete`, {});
  await api("POST", `/api/admin/t/${old.tournament.slug}/archive`, {});

  // The live tournament (3v3, 5 rounds): 8 full teams, a pair and a lone speaker.
  const t = await api("POST", "/api/admin/tournaments", { name: "AUDS Spring Cup 2026", format: "3v3", totalRounds: 5, weightK: 0.1 });
  const slug = t.tournament.slug;
  const first = ["Alice","Bob","Cody","Devi","Edward","Francis","Georgia","Heidi","Isabella","James","Kavya","Liam","Maya","Noah","Olivia","Priya","Quinn","Ravi","Sofia","Theo","Uma","Victor","Wen","Xavier","Yasmin","Zane","Ada","Ben"];
  const rows: any[] = [];
  let idx = 0;
  for (let team = 1; team <= 8; team++) for (let m = 0; m < 3; m++) rows.push({ name: first[idx++], team, present: true });
  rows.push({ name: "Ada", team: 9, present: true }, { name: "Ben", team: 10, present: true }, { name: "Cleo", team: 10, present: true });
  for (const n of ["Swing A", "Swing B", "Swing C"]) rows.push({ name: n, team: 101, present: true });
  await api("PUT", `/api/admin/t/${slug}/roll`, { rows });
  await api("PUT", `/api/admin/t/${slug}/roll-decisions`, { solo: { Ada: "N" }, pair: { 10: "N" } });
  const adjNames = ["Hannah Lowe", "Samir Qadri", "Jess Whitford"];
  for (const [i, n] of adjNames.entries()) await api("POST", `/api/admin/t/${slug}/adjudicators`, { name: n, confidence: 40 + i * 20 });
  await api("POST", `/api/admin/t/${slug}/adjudicators`, { name: "Trainee Tess", trainee: true, attending: true });

  await api("POST", `/api/admin/t/${slug}/adjudicators/mark-all`, { attending: true });
  let seedNo = 20;
  for (const rd of [1, 2]) {
    await api("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true });
    await api("POST", `/api/admin/t/${slug}/rounds/${rd}/draw`, { power: rd === 1 ? "none" : "strict", seed: seedNo++ });
    await api("PUT", `/api/admin/t/${slug}/rounds/${rd}/publish`, { published: true });
    const b = await api("POST", `/api/admin/t/${slug}/rounds/${rd}/results/build`, {});
    let n = 0;
    const upd: any[] = [];
    for (const rm of b.results.rooms) for (const tm of rm.teams) {
      const real = tm.rows.find((x: any) => !x.needsIron)?.speaker;
      for (const x of tm.rows) upd.push({ id: x.id, speaker: x.needsIron ? real : x.speaker, score: 64 + ((n++ * 7 + rd * 3 + tm.team * 5) % 17) + (tm.team % 3) + ((n * 13 + tm.team * 7) % 10) / 10 });
    }
    await api("PUT", `/api/admin/t/${slug}/rounds/${rd}/results`, { rows: upd });
    for (let attempt = 0; ; attempt++) {
      try { await api("POST", `/api/admin/t/${slug}/rounds/${rd}/complete`, {}); break; }
      catch (e) { if (attempt > 20) throw e; upd[(attempt * 5) % upd.length].score += 0.3; await api("PUT", `/api/admin/t/${slug}/rounds/${rd}/results`, { rows: upd }); }
    }
    const form = await api("GET", `/api/public/t/${slug}/feedback-form`);
    const rf = form.rounds.find((x: any) => x.round === rd);
    for (const room of rf.rooms) for (const g of room.givers) for (const tg of g.targets.slice(0, 2)) {
      await handle(new Request(`http://x/api/public/t/${slug}/feedback`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "7.7.7." + (seedNo++ % 200), "user-agent": "seed" }, body: JSON.stringify({ round: rd, room: room.room, giverId: g.id, ratings: [Object.fromEntries([["adjudicator", tg.adjudicator], ["score", 5 + (seedNo % 5)], ...tg.questions.filter((q: string) => q !== "overall").map((q: string) => [q, 6])])] }) }), env);
    }
  }
  await api("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true });
  await api("POST", `/api/admin/t/${slug}/rounds/3/draw`, { power: "broad", seed: seedNo++ });
  await api("PATCH", `/api/admin/t/${slug}/rounds/3`, { topic: "This House believes that universities should abolish final exams in favour of continuous assessment" });
  await api("PATCH", `/api/admin/t/${slug}/rounds/5`, { name: "Grand Final" });
  await api("PUT", `/api/admin/t/${slug}/rounds/3/publish`, { published: true });
  await api("PUT", `/api/admin/t/${slug}/roll-complete`, { complete: true });
}
