// Adjudicator scoring, allocation and feedback pooling - ports of
// CalculateAdjudicatorScore, ComputeRoomPriorityOrder, AssignAdjudicators and
// Feedback_UpdateAdjudicatorSheet.

import type { AdjudicatorInput, AdjRole, AssignedAdjudicator } from "./types.ts";
import { ADJ_CONFIDENCE_Z, ADJ_ZERO_FEEDBACK_PSEUDO_SAMPLES } from "./types.ts";
import type { Rng } from "./rng.ts";
import { shuffleRange } from "./rng.ts";

function safe(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Lower bound of an 80% Wilson interval on the 0-10 scale. With real feedback the
 * sample size is the feedback count; otherwise the "average" is a subjective prior
 * and confidence (0-100) becomes a pseudo sample size.
 */
export function adjudicatorScore(avg: number | null, count: number, confidence: number): number {
  let p = safe(avg) / 10;
  if (p < 0) p = 0;
  if (p > 1) p = 1;
  let n = safe(count) > 0 ? safe(count) : (safe(confidence) / 100) * ADJ_ZERO_FEEDBACK_PSEUDO_SAMPLES;
  if (n <= 0) n = 0.0001;
  const z = ADJ_CONFIDENCE_Z;
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  let lower = center - margin;
  if (lower < 0) lower = 0;
  if (lower > 1) lower = 1;
  return lower * 10;
}

export interface PooledStats {
  avg: number | null;
  count: number;
  sd: number | null;
}

export interface Baseline {
  avg: number | null;
  count: number;
  sd: number | null;
}

/** Pool prior-tournament figures with this tournament's feedback scores. */
export function poolFeedback(baseline: Baseline, scores: number[]): PooledStats {
  const n0 = baseline.count > 0 && baseline.avg !== null ? baseline.count : 0;
  const m0 = n0 > 0 ? (baseline.avg as number) : 0;
  const hasSd0 = n0 >= 2 && baseline.sd !== null && Number.isFinite(baseline.sd);
  const sd0 = hasSd0 ? (baseline.sd as number) : 0;
  const nNew = scores.length;
  if (nNew === 0) {
    return { avg: baseline.avg, count: baseline.count > 0 ? baseline.count : 0, sd: baseline.sd };
  }
  const sumNew = scores.reduce((a, b) => a + b, 0);
  const ssqNew = scores.reduce((a, b) => a + b * b, 0);
  const nAll = n0 + nNew;
  const meanAll = (n0 * m0 + sumNew) / nAll;
  let ssAll = ssqNew + n0 * m0 * m0;
  if (hasSd0) ssAll += (n0 - 1) * sd0 * sd0;
  let sd: number | null = null;
  if (nAll >= 2) {
    let v = (ssAll - nAll * meanAll * meanAll) / (nAll - 1);
    if (v < 0) v = 0;
    sd = Math.sqrt(v);
  }
  return { avg: meanAll, count: nAll, sd };
}

export interface RoomOrderInput {
  roomCount: number;
  /** teams in room order: teamNumbers[roomIndex] = team numbers placed in that room */
  roomTeams: number[][];
  ranks: Map<number, number>;
}

function teamRank(team: number, ranks: Map<number, number>): number {
  const r = ranks.get(team);
  return r !== undefined ? r : 100000 + team;
}

/** Room indices, best room (lowest average team rank) first. Random if no ranking data. */
export function roomPriorityOrder(input: RoomOrderInput, rng: Rng): number[] {
  const { roomCount, roomTeams, ranks } = input;
  const order = Array.from({ length: roomCount }, (_, i) => i);
  if (ranks.size === 0) {
    shuffleRange(order, 0, roomCount - 1, rng);
    return order;
  }
  const avg = roomTeams.map((teams) => teams.reduce((a, t) => a + teamRank(t, ranks), 0) / teams.length);
  const tie = roomTeams.map(() => rng());
  order.sort((a, b) => {
    if (avg[a] !== avg[b]) return avg[a] - avg[b];
    return tie[a] - tie[b];
  });
  return order;
}

export interface AssignResult {
  error?: string;
  rooms?: AssignedAdjudicator[][]; // indexed by room index
}

export function assignAdjudicators(
  adjudicators: AdjudicatorInput[],
  roomCount: number,
  roomOrder: number[],
  rng: Rng,
): AssignResult {
  const candidates: { name: string; score: number }[] = [];
  const trainees: string[] = [];
  for (const a of adjudicators) {
    if (!a.attending || !a.name.trim()) continue;
    if (a.trainee) trainees.push(a.name);
    else candidates.push({ name: a.name, score: adjudicatorScore(a.avg, a.count, a.confidence) });
  }
  if (candidates.length < roomCount) {
    return {
      error:
        `Only ${candidates.length} non-trainee adjudicator(s) are marked as attending, but ` +
        `${roomCount} room(s) each require a chair. Mark more adjudicators as attending, or reduce the number of rooms.`,
    };
  }
  const withTie = candidates.map((c) => ({ ...c, tie: rng() }));
  withTie.sort((a, b) => (a.score !== b.score ? b.score - a.score : b.tie - a.tie));

  const rooms: AssignedAdjudicator[][] = Array.from({ length: roomCount }, () => []);
  for (let i = 0; i < roomCount; i++) {
    rooms[roomOrder[i]].push({ role: "C", name: withTie[i].name });
  }
  const panelistCount = withTie.length - roomCount;
  if (panelistCount > 0) {
    const base = Math.floor(panelistCount / roomCount);
    const extra = panelistCount % roomCount;
    let idx = roomCount;
    for (let ri = 0; ri < roomCount; ri++) {
      const target = roomOrder[ri];
      const n = base + (ri < extra ? 1 : 0);
      for (let k = 0; k < n; k++) {
        rooms[target].push({ role: "P", name: withTie[idx].name });
        idx++;
      }
    }
  }
  if (trainees.length > 0) {
    const sh = trainees.slice();
    shuffleRange(sh, 0, sh.length - 1, rng);
    for (const t of sh) {
      const r = Math.floor(rng() * roomCount);
      rooms[r].push({ role: "T", name: t });
    }
  }
  return { rooms };
}

// ------------------------------------------------------------------ feedback

export interface FeedbackGiver {
  id: string; // "team:3" | "adj:Name"
  kind: "team" | "adjudicator";
  label: string; // value stored in the feedback table's giver column
  team?: number;
  adjudicator?: string;
  role?: AdjRole;
  targets: { adjudicator: string; role: AdjRole }[];
}

export interface RoomFeedbackLayout {
  /** every (adjudicator, giver) slot the room has */
  slots: { adjudicator: string; role: AdjRole; giver: string }[];
  givers: FeedbackGiver[];
}

/**
 * Who rates whom in a room:
 *   Chair     <- one rating from each team and each panelist
 *   Panelist  <- one rating from the chair and each other panelist
 *   Trainee   <- one rating from the chair
 */
export function roomFeedbackLayout(
  teams: { team: number; position: string }[],
  adjudicators: AssignedAdjudicator[],
): RoomFeedbackLayout {
  const chairs = adjudicators.filter((a) => a.role === "C");
  const panelists = adjudicators.filter((a) => a.role === "P");
  const trainees = adjudicators.filter((a) => a.role === "T");
  const givers: FeedbackGiver[] = [];
  const slots: RoomFeedbackLayout["slots"] = [];

  const teamLabel = (t: { team: number; position: string }) => `Team ${t.team} (${t.position})`;

  for (const t of teams) {
    const targets = chairs.map((c) => ({ adjudicator: c.name, role: c.role }));
    givers.push({ id: "team:" + t.team, kind: "team", label: teamLabel(t), team: t.team, targets });
    for (const c of chairs) slots.push({ adjudicator: c.name, role: "C", giver: teamLabel(t) });
  }
  for (const c of chairs) {
    const label = "Chair: " + c.name;
    const targets = [...panelists, ...trainees].map((a) => ({ adjudicator: a.name, role: a.role }));
    givers.push({ id: "adj:" + c.name, kind: "adjudicator", label, adjudicator: c.name, role: "C", targets });
    for (const p of panelists) slots.push({ adjudicator: p.name, role: "P", giver: label });
    for (const t of trainees) slots.push({ adjudicator: t.name, role: "T", giver: label });
  }
  for (const p of panelists) {
    const label = "Panelist: " + p.name;
    const targets = [
      ...chairs.map((c) => ({ adjudicator: c.name, role: c.role })),
      ...panelists.filter((o) => o.name !== p.name).map((o) => ({ adjudicator: o.name, role: o.role })),
    ];
    givers.push({ id: "adj:" + p.name, kind: "adjudicator", label, adjudicator: p.name, role: "P", targets });
    for (const c of chairs) slots.push({ adjudicator: c.name, role: "C", giver: label });
    for (const o of panelists) if (o.name !== p.name) slots.push({ adjudicator: o.name, role: "P", giver: label });
  }
  // Drop givers with nobody to rate (e.g. a chair in a room with no panelists).
  return { slots, givers: givers.filter((g) => g.targets.length > 0) };
}
