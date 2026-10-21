// Create a tournament from an uploaded export (our JSON, or the same content read from our Excel file by the browser).

import { fail } from "./http.ts";
import { DEFAULT_SPEAKER_RANK, DEFAULT_TEAM_RANK, SPEAKER_CRITERIA, TEAM_CRITERIA, cleanRank } from "./engine/stats.ts";
import { DEFAULT_ROOMS, FEEDBACK_MAX, FEEDBACK_MIN, formatInfo } from "./engine/types.ts";

const asStr = (v: unknown, max = 200): string => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));
const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asBool = (v: unknown, dflt = false): boolean => {
  if (v === null || v === undefined || v === "") return dflt;
  if (typeof v === "string") return /^(y|yes|true|1)$/i.test(v.trim());
  return !!v;
};
const asList = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function slugify(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return s || "tournament";
}

function validDate(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(asStr(v));
  return m && !Number.isNaN(Date.parse(m[1] + "T12:00:00Z")) ? m[1] : null;
}

export interface ImportOptions {
  /** "archive": always file as a finished tournament. "keep": use the file's status when no tournament is active. */
  as: "archive" | "keep";
}

export async function importTournament(env: Env, raw: any, opts: ImportOptions) {
  if (!raw || typeof raw !== "object") fail(400, "That file doesn't look like a tournament export.");
  const src = raw.tournament && typeof raw.tournament === "object" ? raw.tournament : raw;
  const name = asStr(src.name, 100);
  if (!name) fail(400, "The file has no tournament name.");
  const format = src.format === "BP" ? "BP" : src.format === "3v3" ? "3v3" : fail(400, "The file's format must be 3v3 or BP.");
  const info = formatInfo(format);

  const roundsIn = asList(src.rounds);
  const draws: Record<string, any> = raw.draws && typeof raw.draws === "object" ? raw.draws : {};
  const results = asList(raw.results);
  const feedback = asList(raw.feedback);
  let maxRound = 0;
  for (const r of roundsIn) maxRound = Math.max(maxRound, asNum(r?.round) ?? 0);
  for (const k of Object.keys(draws)) maxRound = Math.max(maxRound, Number(k) || 0);
  for (const r of results) maxRound = Math.max(maxRound, asNum(r?.round) ?? 0);
  const totalRounds = Math.min(20, Math.max(1, Math.floor(asNum(src.totalRounds) ?? maxRound ?? 1), maxRound));
  if (maxRound > 20) fail(400, "Tournaments have at most 20 rounds.");

  const rooms = asList(src.rooms).map((x) => asStr(x, 40)).filter(Boolean);
  const weightK = Math.min(10, Math.max(0, asNum(src.weightK) ?? 0.1));
  const minDebates = Math.min(20, Math.max(1, Math.floor(asNum(src.minDebates) ?? 3)));
  const topCount = Math.min(50, Math.max(0, Math.floor(asNum(src.topCount) ?? 4)));
  const teamRank = cleanRank(src.teamRank, TEAM_CRITERIA, DEFAULT_TEAM_RANK);
  const speakerRank = cleanRank(src.speakerRank, SPEAKER_CRITERIA, DEFAULT_SPEAKER_RANK);
  const winners = asStr(src.winners, 300);

  const active = await env.DB.prepare("SELECT 1 AS x FROM tournaments WHERE status = 'active' LIMIT 1").first();
  const wantActive = opts.as === "keep" && src.status !== "archived" && !active;
  const date = validDate(src.archivedAt) ?? validDate(src.date) ?? validDate(src.createdAt) ?? new Date().toISOString().slice(0, 10);

  let slug = slugify(name);
  if (await env.DB.prepare("SELECT 1 AS x FROM tournaments WHERE slug = ?").bind(slug).first()) slug = `${slug}-${Date.now().toString(36)}`;

  // ---- normalise the parts
  const roundMeta = new Map<number, any>();
  for (const r of roundsIn) {
    const n = asNum(r?.round);
    if (n) roundMeta.set(n, r);
  }
  const posOk = new Set(info.positions);
  const drawRooms: { round: number; idx: number; room: string; adjudicators: string }[] = [];
  const drawEntries: any[] = [];
  const haveDraw = new Set<number>();
  const adjNames = new Map<string, { name: string; trainee: boolean; attending: boolean; confidence: number }>();
  const noteAdj = (name: string, trainee: boolean) => {
    if (!name) return;
    const k = name.toLowerCase();
    if (!adjNames.has(k)) adjNames.set(k, { name, trainee, attending: false, confidence: 50 });
  };
  for (const [k, v] of Object.entries(draws)) {
    const round = Number(k);
    if (!round || round < 1 || round > totalRounds) continue;
    let seq = 0;
    asList(v?.rooms).forEach((rm: any, idx: number) => {
      const room = asStr(rm?.room, 40);
      if (!room) return;
      const adjs = asList(rm.adjudicators)
        .map((a: any) => ({ role: a?.role === "P" || a?.role === "T" ? a.role : "C", name: asStr(a?.name, 80) }))
        .filter((a: any) => a.name);
      adjs.forEach((a: any) => noteAdj(a.name, a.role === "T"));
      drawRooms.push({ round, idx, room, adjudicators: JSON.stringify(adjs) });
      haveDraw.add(round);
      for (const tm of asList(rm.teams)) {
        const position = asStr(tm?.position, 10);
        if (!posOk.has(position)) continue;
        for (const sp of asList(tm.speakers)) {
          const speaker = asStr(sp?.name, 80);
          if (!speaker) continue;
          const team = Math.floor(asNum(tm.team) ?? 0);
          drawEntries.push({ round, room, position, team, speaker, original_team: Math.floor(asNum(sp.originalTeam) ?? team), merged: tm.merged ? 1 : 0, seq: seq++ });
        }
      }
    });
  }
  const resultRows: any[] = [];
  const haveResults = new Set<number>();
  results.forEach((x: any, seq: number) => {
    const round = Math.floor(asNum(x?.round) ?? 0);
    const position = asStr(x?.position, 10);
    const speaker = asStr(x?.speaker, 80);
    const room = asStr(x?.room, 40);
    if (round < 1 || round > totalRounds || !posOk.has(position) || !speaker || !room) return;
    const team = Math.floor(asNum(x.team) ?? 0);
    haveResults.add(round);
    resultRows.push({ round, room, position, team, speaker, original_team: Math.floor(asNum(x.originalTeam) ?? team), merged: asBool(x.merged) ? 1 : 0, score: asNum(x.score), placement: asNum(x.placement), team_total: asNum(x.teamTotal), seq });
  });

  const rollSeen = new Set<string>();
  const roll: any[] = [];
  asList(raw.roll).forEach((p: any, sort: number) => {
    const n = asStr(p?.name, 80);
    const team = Math.floor(asNum(p?.team) ?? 0);
    if (!n || team < 1 || rollSeen.has(n.toLowerCase())) return;
    rollSeen.add(n.toLowerCase());
    roll.push({ name: n, team, present: asBool(p.present, true) ? 1 : 0, sort });
  });
  const decisions = asList(raw.decisions)
    .map((d: any) => ({ kind: d?.kind === "pair" ? "pair" : d?.kind === "solo" ? "solo" : "", key: asStr(d?.key, 80), value: /^y/i.test(asStr(d?.value)) ? "Y" : /^n/i.test(asStr(d?.value)) ? "N" : "" }))
    .filter((d) => d.kind && d.key && d.value);

  for (const a of asList(raw.adjudicators)) {
    const n = asStr(a?.name, 80);
    if (!n) continue;
    adjNames.set(n.toLowerCase(), { name: n, trainee: asBool(a.trainee), attending: asBool(a.attending), confidence: Math.min(100, Math.max(0, asNum(a.confidence) ?? 50)) });
  }
  for (const f of feedback) noteAdj(asStr(f?.adjudicator, 80), false);

  const fbRows: any[] = [];
  const q = (v: unknown) => {
    const n = asNum(v);
    return n !== null && n >= FEEDBACK_MIN && n <= FEEDBACK_MAX ? n : null;
  };
  for (const f of feedback) {
    const score = asNum(f?.score);
    const round = Math.floor(asNum(f?.round) ?? 0);
    if (score === null || score < FEEDBACK_MIN || score > FEEDBACK_MAX || round < 1 || round > totalRounds) continue;
    const room = asStr(f.room, 40), adjudicator = asStr(f.adjudicator, 80), giver = asStr(f.giver, 80);
    if (!room || !adjudicator || !giver) continue;
    fbRows.push({
      round, room, adjudicator, giver, score,
      comment: asStr(f.comment, 1000) || null,
      source: f.source === "admin" ? "admin" : "public",
      q_decision: q(f.q_decision ?? f.decision), q_justification: q(f.q_justification ?? f.justification),
      q_chair: q(f.q_chair ?? f.chair), q_contribution: q(f.q_contribution ?? f.contribution),
      excluded: asBool(f.excluded) ? 1 : 0,
      created_at: asStr(f.created_at ?? f.createdAt, 40) || null,
    });
  }

  // ---- write
  const ins = await env.DB.prepare(
    `INSERT INTO tournaments (slug, name, format, total_rounds, weight_k, rooms_json, min_debates, top_count, team_rank, speaker_rank, winners, status, roll_complete, feedback_open, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      slug, name, format, totalRounds, weightK, JSON.stringify(rooms.length ? rooms : DEFAULT_ROOMS), minDebates, topCount,
      JSON.stringify(teamRank), JSON.stringify(speakerRank), winners || null,
      wantActive ? "active" : "archived", asBool(src.rollComplete, roll.length > 0) ? 1 : 0, wantActive && asBool(src.feedbackOpen, true) ? 1 : 0,
      wantActive ? null : date + " 12:00:00", date + " 12:00:00",
    )
    .run();
  const tid = (ins.meta as any).last_row_id as number;
  const J = (rows: unknown[]) => JSON.stringify(rows);
  const stmts: D1PreparedStatement[] = [];

  const roundRows: any[] = [];
  let current = 1;
  for (let n = 1; n <= totalRounds; n++) {
    const m = roundMeta.get(n) ?? {};
    let status = ["empty", "drawn", "scoring", "completed"].includes(m.status) ? m.status : haveResults.has(n) ? "completed" : haveDraw.has(n) ? "drawn" : "empty";
    if (!haveResults.has(n) && (status === "scoring" || status === "completed")) status = haveDraw.has(n) ? "drawn" : "empty";
    if (status === "empty" && haveDraw.has(n)) status = "drawn";
    const customName = m.customName === false ? "" : asStr(m.name, 60);
    roundRows.push({
      round: n, status, published: asBool(m.published, haveDraw.has(n)) ? 1 : 0,
      name: customName && customName !== `Round ${n}` ? customName : null, topic: asStr(m.topic, 300) || null,
      show_placement: asBool(m.showPlacement, true) ? 1 : 0, show_team_avg: asBool(m.showTeamAverage, true) ? 1 : 0, show_speaker_scores: asBool(m.showSpeakerScores, true) ? 1 : 0,
    });
    if (status === "completed") current = Math.min(totalRounds + 1, n + 1);
  }
  stmts.push(env.DB.prepare("UPDATE tournaments SET current_round = ? WHERE id = ?").bind(current, tid));
  stmts.push(
    env.DB.prepare(
      `INSERT INTO rounds (tournament_id, round, status, published, name, topic, show_placement, show_team_avg, show_speaker_scores)
       SELECT ?, json_extract(value,'$.round'), json_extract(value,'$.status'), json_extract(value,'$.published'), json_extract(value,'$.name'), json_extract(value,'$.topic'),
              json_extract(value,'$.show_placement'), json_extract(value,'$.show_team_avg'), json_extract(value,'$.show_speaker_scores') FROM json_each(?)`,
    ).bind(tid, J(roundRows)),
  );
  if (roll.length) {
    stmts.push(env.DB.prepare("INSERT INTO roll (tournament_id, name, team, present, sort) SELECT ?, json_extract(value,'$.name'), json_extract(value,'$.team'), json_extract(value,'$.present'), json_extract(value,'$.sort') FROM json_each(?)").bind(tid, J(roll)));
  }
  if (decisions.length) {
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO roll_decisions (tournament_id, kind, key, value) SELECT ?, json_extract(value,'$.kind'), json_extract(value,'$.key'), json_extract(value,'$.value') FROM json_each(?)").bind(tid, J(decisions)));
  }
  const adjList = Array.from(adjNames.values());
  if (adjList.length) {
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO adjudicators (name, trainee, confidence) SELECT json_extract(value,'$.name'), json_extract(value,'$.trainee'), json_extract(value,'$.confidence') FROM json_each(?)").bind(J(adjList.map((a) => ({ ...a, trainee: a.trainee ? 1 : 0 })))));
  }
  // every known adjudicator gets a row for this tournament; attendance comes from the file
  stmts.push(env.DB.prepare("INSERT INTO tournament_adjudicators (tournament_id, adjudicator_id, attending) SELECT ?, id, 0 FROM adjudicators").bind(tid));
  if (adjList.some((a) => a.attending)) {
    stmts.push(
      env.DB.prepare(
        "UPDATE tournament_adjudicators SET attending = 1 WHERE tournament_id = ? AND adjudicator_id IN (SELECT a.id FROM adjudicators a JOIN json_each(?) j ON a.name = j.value COLLATE NOCASE)",
      ).bind(tid, J(adjList.filter((a) => a.attending).map((a) => a.name))),
    );
  }
  if (drawRooms.length) {
    stmts.push(env.DB.prepare("INSERT INTO draw_rooms (tournament_id, round, idx, room, adjudicators_json) SELECT ?, json_extract(value,'$.round'), json_extract(value,'$.idx'), json_extract(value,'$.room'), json_extract(value,'$.adjudicators') FROM json_each(?)").bind(tid, J(drawRooms)));
  }
  if (drawEntries.length) {
    stmts.push(env.DB.prepare("INSERT INTO draw_entries (tournament_id, round, room, position, team, speaker, original_team, merged, seq) SELECT ?, json_extract(value,'$.round'), json_extract(value,'$.room'), json_extract(value,'$.position'), json_extract(value,'$.team'), json_extract(value,'$.speaker'), json_extract(value,'$.original_team'), json_extract(value,'$.merged'), json_extract(value,'$.seq') FROM json_each(?)").bind(tid, J(drawEntries)));
  }
  if (resultRows.length) {
    stmts.push(env.DB.prepare("INSERT INTO results (tournament_id, round, room, position, team, speaker, original_team, merged, score, placement, team_total, seq) SELECT ?, json_extract(value,'$.round'), json_extract(value,'$.room'), json_extract(value,'$.position'), json_extract(value,'$.team'), json_extract(value,'$.speaker'), json_extract(value,'$.original_team'), json_extract(value,'$.merged'), json_extract(value,'$.score'), json_extract(value,'$.placement'), json_extract(value,'$.team_total'), json_extract(value,'$.seq') FROM json_each(?)").bind(tid, J(resultRows)));
  }
  if (fbRows.length) {
    stmts.push(env.DB.prepare("INSERT INTO feedback (tournament_id, round, room, adjudicator, giver, score, comment, source, q_decision, q_justification, q_chair, q_contribution, excluded, created_at) SELECT ?, json_extract(value,'$.round'), json_extract(value,'$.room'), json_extract(value,'$.adjudicator'), json_extract(value,'$.giver'), json_extract(value,'$.score'), json_extract(value,'$.comment'), json_extract(value,'$.source'), json_extract(value,'$.q_decision'), json_extract(value,'$.q_justification'), json_extract(value,'$.q_chair'), json_extract(value,'$.q_contribution'), json_extract(value,'$.excluded'), COALESCE(json_extract(value,'$.created_at'), datetime('now')) FROM json_each(?)").bind(tid, J(fbRows)));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    await env.DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(tid).run();
    throw e;
  }
  return {
    slug, name, status: wantActive ? "active" : "archived",
    counts: { rounds: totalRounds, roll: roll.length, adjudicators: adjList.length, draws: haveDraw.size, results: resultRows.length, feedback: fbRows.length },
  };
}
