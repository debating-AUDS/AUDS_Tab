// Database access and the glue between D1 rows and the pure engine.

import type { Env } from "./env.ts";
import { fail } from "./http.ts";
import type {
  AdjudicatorInput,
  AssignedAdjudicator,
  DrawRoom,
  Format,
  ResultRow,
  RollPerson,
} from "./engine/types.ts";
import { formatInfo } from "./engine/types.ts";
import { poolFeedback, roomFeedbackLayout } from "./engine/adjudicators.ts";
import { adjudicatorScore } from "./engine/adjudicators.ts";
import {
  DEFAULT_SPEAKER_RANK,
  DEFAULT_TEAM_RANK,
  SPEAKER_CRITERIA,
  TEAM_CRITERIA,
  buildLeaderboard,
  cleanRank,
  computeStats,
  powerPairingRanks,
} from "./engine/stats.ts";
import type { Leaderboard, Stats } from "./engine/stats.ts";

export interface TournamentRow {
  id: number;
  slug: string;
  name: string;
  format: Format;
  total_rounds: number;
  current_round: number;
  weight_k: number;
  status: "active" | "archived";
  rooms_json: string;
  roll_complete: number;
  feedback_open: number;
  feedback_code: string | null;
  created_at: string;
  archived_at: string | null;
  top_count: number;
  winners: string | null;
  min_debates: number;
  team_rank: string;
  speaker_rank: string;
}

export interface RoundRow {
  round: number;
  status: "empty" | "drawn" | "scoring" | "completed";
  published: number;
  power: string | null;
  completed_at: string | null;
  name: string | null;
  topic: string | null;
  show_placement: number;
  show_team_avg: number;
  show_speaker_scores: number;
}

export async function getTournament(env: Env, slug: string): Promise<TournamentRow> {
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE slug = ?").bind(slug).first<TournamentRow>();
  if (!t) fail(404, "Tournament not found.");
  return t as TournamentRow;
}

export function assertActive(t: TournamentRow): void {
  if (t.status !== "active") fail(409, "This tournament is archived and can no longer be changed.", "archived");
}

export async function loadRounds(env: Env, tid: number): Promise<RoundRow[]> {
  const r = await env.DB.prepare("SELECT round, status, published, power, completed_at, name, topic, show_placement, show_team_avg, show_speaker_scores FROM rounds WHERE tournament_id = ? ORDER BY round")
    .bind(tid)
    .all<RoundRow>();
  return r.results;
}

export async function getRound(env: Env, t: TournamentRow, n: number): Promise<RoundRow> {
  if (!Number.isInteger(n) || n < 1 || n > t.total_rounds) fail(404, `Round ${n} does not exist.`);
  const r = await env.DB.prepare("SELECT round, status, published, power, completed_at, name, topic, show_placement, show_team_avg, show_speaker_scores FROM rounds WHERE tournament_id = ? AND round = ?")
    .bind(t.id, n)
    .first<RoundRow>();
  if (!r) fail(404, `Round ${n} does not exist.`);
  return r as RoundRow;
}

export function parseList(v: string | null | undefined): string[] {
  try {
    const x = JSON.parse(v || "[]");
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

export function roomsOf(t: TournamentRow): string[] {
  try {
    const v = JSON.parse(t.rooms_json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function tournamentJson(t: TournamentRow, rounds: RoundRow[], admin: boolean) {
  const info = formatInfo(t.format);
  const base: Record<string, unknown> = {
    id: t.id,
    slug: t.slug,
    name: t.name,
    format: t.format,
    totalRounds: t.total_rounds,
    currentRound: t.current_round,
    weightK: t.weight_k,
    status: t.status,
    rooms: roomsOf(t),
    rollComplete: !!t.roll_complete,
    feedbackOpen: !!t.feedback_open,
    feedbackCodeRequired: !!t.feedback_code,
    createdAt: t.created_at,
    archivedAt: t.archived_at,
    topCount: t.top_count,
    minDebates: t.min_debates,
    teamRank: cleanRank(parseList(t.team_rank), TEAM_CRITERIA, DEFAULT_TEAM_RANK),
    speakerRank: cleanRank(parseList(t.speaker_rank), SPEAKER_CRITERIA, DEFAULT_SPEAKER_RANK),
    winners: t.winners || "",
    teamsPerRoom: info.teamsPerRoom,
    targetTeamSize: info.targetTeamSize,
    positions: info.positions,
    rounds: rounds.map((r) => ({
      round: r.round,
      name: r.name || `Round ${r.round}`,
      customName: !!r.name,
      status: r.status,
      published: !!r.published,
      // The topic stays private until the draw is published.
      topic: admin || r.published ? r.topic || "" : "",
      showPlacement: !!r.show_placement,
      showTeamAverage: !!r.show_team_avg,
      showSpeakerScores: !!r.show_speaker_scores,
    })),
  };
  if (admin) base.feedbackCode = t.feedback_code;
  return base;
}

// ---------------------------------------------------------------------- roll

export interface RollRow extends RollPerson {
  id: number;
}

export async function loadRoll(env: Env, tid: number): Promise<RollRow[]> {
  const r = await env.DB.prepare("SELECT id, name, team, present FROM roll WHERE tournament_id = ? ORDER BY sort, id")
    .bind(tid)
    .all<{ id: number; name: string; team: number; present: number }>();
  return r.results.map((x) => ({ id: x.id, name: x.name, team: x.team, present: !!x.present }));
}

export async function loadDecisions(env: Env, tid: number) {
  const r = await env.DB.prepare("SELECT kind, key, value FROM roll_decisions WHERE tournament_id = ?")
    .bind(tid)
    .all<{ kind: string; key: string; value: "Y" | "N" }>();
  const solo: Record<string, "Y" | "N"> = {};
  const pair: Record<string, "Y" | "N"> = {};
  for (const d of r.results) (d.kind === "solo" ? solo : pair)[d.key] = d.value;
  return { solo, pair };
}

// ---------------------------------------------------------------------- draws

interface DrawRoomDb {
  round: number;
  idx: number;
  room: string;
  adjudicators_json: string;
}
interface DrawEntryDb {
  id: number;
  round: number;
  room: string;
  position: string;
  team: number;
  speaker: string;
  original_team: number;
  merged: number;
  seq: number;
}

export function assembleDraws(rooms: DrawRoomDb[], entries: DrawEntryDb[], format: Format): Map<number, DrawRoom[]> {
  const positions = formatInfo(format).positions;
  const out = new Map<number, DrawRoom[]>();
  const sortedRooms = rooms.slice().sort((a, b) => a.round - b.round || a.idx - b.idx);
  for (const r of sortedRooms) {
    if (!out.has(r.round)) out.set(r.round, []);
    let adj: AssignedAdjudicator[] = [];
    try {
      adj = JSON.parse(r.adjudicators_json);
    } catch {
      adj = [];
    }
    out.get(r.round)!.push({ room: r.room, teams: [], adjudicators: adj });
  }
  const sortedEntries = entries.slice().sort((a, b) => a.seq - b.seq || a.id - b.id);
  for (const e of sortedEntries) {
    const room = out.get(e.round)?.find((x) => x.room === e.room);
    if (!room) continue;
    let team = room.teams.find((t) => t.position === e.position);
    if (!team) {
      team = { position: e.position, team: e.team, merged: !!e.merged, speakers: [] };
      room.teams.push(team);
    }
    team.speakers.push({ name: e.speaker, originalTeam: e.original_team });
  }
  for (const rs of out.values()) {
    for (const room of rs) {
      room.teams.sort((a, b) => positions.indexOf(a.position) - positions.indexOf(b.position));
    }
  }
  return out;
}

export async function loadAllDraws(env: Env, t: TournamentRow, round?: number): Promise<Map<number, DrawRoom[]>> {
  const where = round === undefined ? "tournament_id = ?" : "tournament_id = ? AND round = ?";
  const args = round === undefined ? [t.id] : [t.id, round];
  const rooms = await env.DB.prepare(`SELECT round, idx, room, adjudicators_json FROM draw_rooms WHERE ${where}`)
    .bind(...args)
    .all<DrawRoomDb>();
  const entries = await env.DB.prepare(
    `SELECT id, round, room, position, team, speaker, original_team, merged, seq FROM draw_entries WHERE ${where}`,
  )
    .bind(...args)
    .all<DrawEntryDb>();
  return assembleDraws(rooms.results, entries.results, t.format);
}

export async function loadDraw(env: Env, t: TournamentRow, round: number): Promise<DrawRoom[] | null> {
  const m = await loadAllDraws(env, t, round);
  return m.get(round) ?? null;
}

export function drawStatements(env: Env, tid: number, round: number, rooms: DrawRoom[]): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM draw_rooms WHERE tournament_id = ? AND round = ?").bind(tid, round),
    env.DB.prepare("DELETE FROM draw_entries WHERE tournament_id = ? AND round = ?").bind(tid, round),
  ];
  let seq = 0;
  rooms.forEach((room, idx) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO draw_rooms (tournament_id, round, idx, room, adjudicators_json) VALUES (?, ?, ?, ?, ?)",
      ).bind(tid, round, idx, room.room, JSON.stringify(room.adjudicators)),
    );
    for (const team of room.teams) {
      for (const sp of team.speakers) {
        stmts.push(
          env.DB.prepare(
            "INSERT INTO draw_entries (tournament_id, round, room, position, team, speaker, original_team, merged, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(tid, round, room.room, team.position, team.team, sp.name, sp.originalTeam, team.merged ? 1 : 0, seq++),
        );
      }
    }
  });
  return stmts;
}

export async function posHistory(env: Env, tid: number, exceptRound: number): Promise<Map<number, Set<string>>> {
  const r = await env.DB.prepare("SELECT DISTINCT team, position FROM draw_entries WHERE tournament_id = ? AND round <> ?")
    .bind(tid, exceptRound)
    .all<{ team: number; position: string }>();
  const m = new Map<number, Set<string>>();
  for (const x of r.results) {
    if (!m.has(x.team)) m.set(x.team, new Set());
    m.get(x.team)!.add(x.position);
  }
  return m;
}

// -------------------------------------------------------------------- results

export interface ResultRowDb {
  id: number;
  round: number;
  room: string;
  position: string;
  team: number;
  speaker: string;
  original_team: number;
  merged: number;
  score: number | null;
  placement: number | null;
  team_total: number | null;
  seq: number;
}

export function toResultRow(x: ResultRowDb): ResultRow {
  return {
    id: x.id,
    round: x.round,
    room: x.room,
    position: x.position,
    team: x.team,
    speaker: x.speaker,
    score: x.score,
    originalTeam: x.original_team,
    merged: !!x.merged,
    placement: x.placement,
    teamTotal: x.team_total,
  };
}

export async function loadResultRows(env: Env, tid: number, round?: number): Promise<ResultRow[]> {
  const where = round === undefined ? "tournament_id = ?" : "tournament_id = ? AND round = ?";
  const args = round === undefined ? [tid] : [tid, round];
  const r = await env.DB.prepare(
    `SELECT id, round, room, position, team, speaker, original_team, merged, score, placement, team_total, seq FROM results WHERE ${where} ORDER BY round, seq, id`,
  )
    .bind(...args)
    .all<ResultRowDb>();
  return r.results.map(toResultRow);
}

export function resultInsert(env: Env, tid: number, r: ResultRow, seq: number): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO results (tournament_id, round, room, position, team, speaker, original_team, merged, score, placement, team_total, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(tid, r.round, r.room, r.position, r.team, r.speaker, r.originalTeam, r.merged ? 1 : 0, r.score, r.placement, r.teamTotal, seq);
}

/** Rows belonging to COMPLETED rounds only. */
export async function completedResultRows(env: Env, t: TournamentRow): Promise<{ rows: ResultRow[]; rounds: number[] }> {
  const rounds = (await loadRounds(env, t.id)).filter((r) => r.status === "completed").map((r) => r.round);
  if (rounds.length === 0) return { rows: [], rounds };
  const all = await loadResultRows(env, t.id);
  const set = new Set(rounds);
  return { rows: all.filter((r) => set.has(r.round)), rounds };
}

// ------------------------------------------------------------------- feedback

export interface FeedbackRow {
  id: number;
  round: number;
  room: string;
  adjudicator: string;
  giver: string;
  score: number;
  comment: string | null;
  source: "public" | "admin";
  created_at: string;
}

export async function loadFeedback(env: Env, tid: number, round?: number): Promise<FeedbackRow[]> {
  const where = round === undefined ? "tournament_id = ?" : "tournament_id = ? AND round = ?";
  const args = round === undefined ? [tid] : [tid, round];
  const r = await env.DB.prepare(
    `SELECT id, round, room, adjudicator, giver, score, comment, source, created_at FROM feedback WHERE ${where} ORDER BY id`,
  )
    .bind(...args)
    .all<FeedbackRow>();
  return r.results;
}

export interface Slot {
  round: number;
  room: string;
  adjudicator: string;
  giver: string;
  mean: number;
  count: number;
}

/** Collapse raw feedback rows into slot means, keeping only slots that exist in the (current) draw. */
export function collapseSlots(rows: FeedbackRow[], draws: Map<number, DrawRoom[]>): Slot[] {
  const valid = new Set<string>();
  for (const [round, rooms] of draws) {
    for (const room of rooms) {
      const layout = roomFeedbackLayout(room.teams, room.adjudicators);
      for (const s of layout.slots) valid.add(`${round}|${room.room}|${s.adjudicator.toLowerCase()}|${s.giver}`);
    }
  }
  const groups = new Map<string, { slot: Slot; sum: number }>();
  for (const f of rows) {
    const key = `${f.round}|${f.room}|${f.adjudicator.toLowerCase()}|${f.giver}`;
    if (!valid.has(key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { slot: { round: f.round, room: f.room, adjudicator: f.adjudicator, giver: f.giver, mean: 0, count: 0 }, sum: 0 };
      groups.set(key, g);
    }
    g.sum += f.score;
    g.slot.count++;
  }
  return Array.from(groups.values()).map((g) => ({ ...g.slot, mean: g.sum / g.slot.count }));
}

// -------------------------------------------------------------- adjudicators

export interface AdjudicatorRow {
  id: number;
  name: string;
  trainee: number;
  confidence: number;
  attending: number;
}

export async function loadAdjudicators(env: Env, tid: number): Promise<AdjudicatorRow[]> {
  const r = await env.DB.prepare(
    `SELECT a.id, a.name, a.trainee, a.confidence,
            COALESCE(ta.attending, 0) AS attending
       FROM adjudicators a
       LEFT JOIN tournament_adjudicators ta ON ta.adjudicator_id = a.id AND ta.tournament_id = ?
      ORDER BY a.name COLLATE NOCASE`,
  )
    .bind(tid)
    .all<AdjudicatorRow>();
  return r.results;
}

export interface AdjudicatorView {
  id: number;
  name: string;
  trainee: boolean;
  attending: boolean;
  confidence: number;
  thisTournament: { count: number; avg: number | null };
  avg: number | null;
  count: number;
  sd: number | null;
  rankingScore: number;
}

/** Adjudicator list with this tournament's completed-round feedback only (nothing carries over between tournaments). */
export async function adjudicatorViews(env: Env, t: TournamentRow): Promise<AdjudicatorView[]> {
  const adjs = await loadAdjudicators(env, t.id);
  const rounds = (await loadRounds(env, t.id)).filter((r) => r.status === "completed").map((r) => r.round);
  let slots: Slot[] = [];
  if (rounds.length > 0) {
    const draws = await loadAllDraws(env, t);
    for (const k of Array.from(draws.keys())) if (!rounds.includes(k)) draws.delete(k);
    slots = collapseSlots(await loadFeedback(env, t.id), draws);
  }
  const byName = new Map<string, number[]>();
  for (const s of slots) {
    const k = s.adjudicator.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(s.mean);
  }
  return adjs.map((a) => {
    const scores = byName.get(a.name.toLowerCase()) ?? [];
    const pooled = poolFeedback({ avg: null, count: 0, sd: null }, scores);
    const thisAvg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    return {
      id: a.id,
      name: a.name,
      trainee: !!a.trainee,
      attending: !!a.attending,
      confidence: a.confidence,
      thisTournament: { count: scores.length, avg: thisAvg },
      avg: pooled.avg,
      count: pooled.count,
      sd: pooled.sd,
      rankingScore: adjudicatorScore(pooled.avg, pooled.count, a.confidence),
    };
  });
}

export function toAdjudicatorInputs(views: AdjudicatorView[]): AdjudicatorInput[] {
  return views.map((v) => ({
    name: v.name,
    trainee: v.trainee,
    attending: v.attending,
    avg: v.avg,
    count: v.count,
    confidence: v.confidence,
  }));
}

// --------------------------------------------------------------- leaderboard

export async function computeTournamentStats(env: Env, t: TournamentRow): Promise<{ stats: Stats; rounds: number[] }> {
  const { rows, rounds } = await completedResultRows(env, t);
  const stats = computeStats({ format: t.format, totalRounds: t.total_rounds, weightK: t.weight_k, rows });
  return { stats, rounds };
}

/** `maskHidden` removes per-round placements / speaker scores for rounds the organisers chose not to publish. */
export async function leaderboard(env: Env, t: TournamentRow, maskHidden = false): Promise<Leaderboard> {
  const { stats, rounds } = await computeTournamentStats(env, t);
  // Feedback # = how many adjudicator ratings each team has submitted (used as a ranking tie-break).
  const given = new Map<string, number>();
  if (rounds.length > 0) {
    const draws = await loadAllDraws(env, t);
    for (const k of Array.from(draws.keys())) if (!rounds.includes(k)) draws.delete(k);
    const slots = collapseSlots(await loadFeedback(env, t.id), draws);
    for (const s of slots) {
      const m = /^Team (\d+) \(/.exec(s.giver);
      if (!m) continue;
      const key = `${s.round}|${Number(m[1])}`;
      given.set(key, (given.get(key) ?? 0) + 1);
    }
  }
  const lb = buildLeaderboard(stats, rounds, given, {
    minDebates: t.min_debates,
    teamRank: parseList(t.team_rank),
    speakerRank: parseList(t.speaker_rank),
  });
  lb.top = lb.teams.filter((x) => x.eligible).slice(0, Math.max(0, t.top_count));
  if (maskHidden) {
    const flags = await loadRounds(env, t.id);
    for (const rd of flags) {
      const i = rd.round - 1;
      if (!rd.show_placement) for (const tm of lb.teams) tm.results[i] = null;
      if (!rd.show_speaker_scores) for (const sp of lb.speakers) sp.rounds[i] = null;
    }
  }
  return lb;
}

export async function rankDictionary(env: Env, t: TournamentRow): Promise<Map<number, number>> {
  const { stats } = await computeTournamentStats(env, t);
  const roll = await loadRoll(env, t.id);
  return powerPairingRanks(stats, roll);
}
