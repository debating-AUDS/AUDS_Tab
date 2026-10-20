// Draw generation - a port of Roll_Check + Generate_Draw (team formation, merging of
// short teams, power pairing, position assignment, room/adjudicator allocation).

import type {
  AdjudicatorInput,
  AssignedAdjudicator,
  DrawRoom,
  DrawSpeaker,
  DrawTeam,
  Format,
  PowerMode,
  RollPerson,
} from "./types.ts";
import { MAX_ROOMS, SWING_TEAM_THRESHOLD, formatInfo, isSwing, roomNameForIndex } from "./types.ts";
import type { Rng } from "./rng.ts";
import { shuffleRange } from "./rng.ts";
import { assignAdjudicators, roomPriorityOrder } from "./adjudicators.ts";

export type YN = "Y" | "N";

export interface FormedTeam {
  team: number;
  speakers: DrawSpeaker[];
  merged: boolean;
}

export interface RollCheck {
  attending: number;
  normalTeams: { team: number; members: string[] }[];
  solos: { name: string; team: number; decision: YN | null }[];
  pairs: { team: number; members: string[]; decision: YN | null }[]; // 3v3 only
  swingTeams: number[];
  /** number of teams the draw would contain, once every decision is made */
  expectedTeams: number | null;
  teamsPerRoom: number;
  divisible: boolean | null;
  problems: string[];
}

function groupAttending(roll: RollPerson[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const p of roll) {
    const name = p.name.trim();
    if (!name || !p.present) continue;
    if (!Number.isFinite(p.team)) throw new Error(`Participant '${name}' has no team number.`);
    if (!m.has(p.team)) m.set(p.team, []);
    m.get(p.team)!.push(name);
  }
  return m;
}

export function rollCheck(
  format: Format,
  roll: RollPerson[],
  solo: Record<string, YN>,
  pair: Record<string, YN>,
): RollCheck {
  const { teamsPerRoom } = formatInfo(format);
  const groups = groupAttending(roll);
  const normalTeams: RollCheck["normalTeams"] = [];
  const solos: RollCheck["solos"] = [];
  const pairs: RollCheck["pairs"] = [];
  let attending = 0;
  for (const [team, members] of groups) {
    attending += members.length;
    if (members.length === 1) {
      solos.push({ name: members[0], team, decision: solo[members[0]] ?? null });
    } else if (format === "3v3" && members.length === 2) {
      pairs.push({ team, members, decision: pair[String(team)] ?? null });
    } else {
      normalTeams.push({ team, members });
    }
  }
  const swingTeams = Array.from(groups.keys()).filter(isSwing);
  const problems: string[] = [];
  const undecided = solos.some((s) => s.decision === null) || pairs.some((p) => p.decision === null);
  let expectedTeams: number | null = null;
  let divisible: boolean | null = null;
  if (!undecided) {
    const formed = formTeams(format, roll, solo, pair, () => 0.5);
    if (formed.error) problems.push(formed.error);
    else {
      expectedTeams = formed.teams!.length;
      divisible = expectedTeams % teamsPerRoom === 0;
      if (!divisible) {
        problems.push(
          `${expectedTeams} team(s) is not divisible by ${teamsPerRoom}. Add or adjust a swing team (numbered above ${SWING_TEAM_THRESHOLD}) so every room is full.`,
        );
      }
    }
  }
  return { attending, normalTeams, solos, pairs, swingTeams, expectedTeams, teamsPerRoom, divisible, problems };
}

function mkTeam(team: number, merged: boolean): FormedTeam {
  return { team, speakers: [], merged };
}

/**
 * Turn the attending roll into debating teams.
 *
 * 3v3 merge preference: lone + pair -> team of 3; leftover pairs merge together (team of 4);
 * leftover lones merge together (team of 2, iron-person fills the 3rd); a single leftover
 * of either kind stands alone. BP: lone speakers marked N are paired at random.
 */
export function formTeams(
  format: Format,
  roll: RollPerson[],
  solo: Record<string, YN>,
  pair: Record<string, YN>,
  rng: Rng,
): { teams?: FormedTeam[]; error?: string } {
  let groups: Map<number, string[]>;
  try {
    groups = groupAttending(roll);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const threeV = format === "3v3";
  const teams: FormedTeam[] = [];
  const loneQueue: { name: string; team: number }[] = [];
  const pairQueue: { team: number; names: string[] }[] = [];

  for (const [team, members] of groups) {
    if (members.length === 1) {
      const name = members[0];
      const d = solo[name];
      if (d !== "Y" && d !== "N") return { error: `Enter Y or N for lone speaker '${name}'.` };
      if (d === "Y") {
        const t = mkTeam(team, false);
        t.speakers.push({ name, originalTeam: team });
        teams.push(t);
      } else loneQueue.push({ name, team });
    } else if (threeV && members.length === 2) {
      const d = pair[String(team)];
      if (d !== "Y" && d !== "N") return { error: `Enter Y or N for two-person team '${team}'.` };
      if (d === "Y") {
        const t = mkTeam(team, false);
        for (const n of members) t.speakers.push({ name: n, originalTeam: team });
        teams.push(t);
      } else pairQueue.push({ team, names: members });
    } else {
      const t = mkTeam(team, false);
      for (const n of members) t.speakers.push({ name: n, originalTeam: team });
      teams.push(t);
    }
  }

  if (threeV) {
    while (loneQueue.length > 0 && pairQueue.length > 0) {
      const lone = loneQueue.shift()!;
      const pr = pairQueue.shift()!;
      const t = mkTeam(Math.min(lone.team, pr.team), true);
      for (const n of pr.names) t.speakers.push({ name: n, originalTeam: pr.team });
      t.speakers.push({ name: lone.name, originalTeam: lone.team });
      teams.push(t);
    }
    while (pairQueue.length >= 2) {
      const a = pairQueue.shift()!;
      const b = pairQueue.shift()!;
      const t = mkTeam(Math.min(a.team, b.team), true);
      for (const n of a.names) t.speakers.push({ name: n, originalTeam: a.team });
      for (const n of b.names) t.speakers.push({ name: n, originalTeam: b.team });
      teams.push(t);
    }
    if (pairQueue.length === 1) {
      const a = pairQueue.shift()!;
      const t = mkTeam(a.team, false);
      for (const n of a.names) t.speakers.push({ name: n, originalTeam: a.team });
      teams.push(t);
    }
    while (loneQueue.length >= 2) {
      const a = loneQueue.shift()!;
      const b = loneQueue.shift()!;
      const t = mkTeam(Math.min(a.team, b.team), true);
      t.speakers.push({ name: a.name, originalTeam: a.team });
      t.speakers.push({ name: b.name, originalTeam: b.team });
      teams.push(t);
    }
    if (loneQueue.length === 1) {
      const a = loneQueue.shift()!;
      const t = mkTeam(a.team, false);
      t.speakers.push({ name: a.name, originalTeam: a.team });
      teams.push(t);
    }
  } else if (loneQueue.length > 0) {
    if (loneQueue.length % 2 !== 0) {
      return { error: "There is an odd number of lone speakers marked N. They cannot all be paired." };
    }
    const order = loneQueue.map((_, i) => i);
    shuffleRange(order, 0, order.length - 1, rng);
    for (let i = 0; i < order.length; i += 2) {
      const a = loneQueue[order[i]];
      const b = loneQueue[order[i + 1]];
      const t = mkTeam(Math.min(a.team, b.team), true);
      t.speakers.push({ name: a.name, originalTeam: a.team });
      t.speakers.push({ name: b.name, originalTeam: b.team });
      teams.push(t);
    }
  }
  return { teams };
}

export interface DrawInput {
  format: Format;
  round: number;
  roll: RollPerson[];
  solo: Record<string, YN>;
  pair: Record<string, YN>;
  power: PowerMode;
  /** team number -> rank (1 = best). Empty when there's no ranking data yet. */
  ranks: Map<number, number>;
  /** team number -> positions that team has already debated in OTHER rounds */
  posHistory: Map<number, Set<string>>;
  adjudicators: AdjudicatorInput[];
  roomNames: string[];
  rng: Rng;
}

function teamRank(team: number, ranks: Map<number, number>): number {
  const r = ranks.get(team);
  return r !== undefined ? r : 100000 + team;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const used = new Array(n).fill(false);
  const cur: number[] = [];
  const rec = () => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

/** Choose which team debates in which position, avoiding repeats of earlier positions. */
export function assignPositions(
  roomTeams: FormedTeam[],
  positions: string[],
  history: Map<number, Set<string>>,
  rng: Rng,
): number[] {
  const n = positions.length;
  let best = n + 1;
  let bestPerms: number[][] = [];
  for (const perm of permutations(n)) {
    let score = 0;
    for (let i = 0; i < n; i++) {
      const h = history.get(roomTeams[perm[i]].team);
      if (h && h.has(positions[i])) score++;
    }
    if (score < best) {
      best = score;
      bestPerms = [perm];
    } else if (score === best) bestPerms.push(perm);
  }
  return bestPerms[Math.floor(rng() * bestPerms.length)];
}

export function generateDraw(input: DrawInput): { rooms?: DrawRoom[]; error?: string } {
  const { format, round, power, ranks, rng } = input;
  const { teamsPerRoom, positions } = formatInfo(format);

  const formed = formTeams(format, input.roll, input.solo, input.pair, rng);
  if (formed.error) return { error: formed.error };
  const arr = formed.teams!;
  if (arr.length === 0) return { error: "There are no attending teams." };
  if (arr.length % teamsPerRoom !== 0) {
    return {
      error:
        `${arr.length} team(s) not divisible by ${teamsPerRoom}. Please add or adjust a swing team on the roll ` +
        `(numbered above ${SWING_TEAM_THRESHOLD}) so the number of attending teams is divisible by ${teamsPerRoom}, then generate the draw again.`,
    };
  }
  const roomCount = arr.length / teamsPerRoom;
  if (roomCount > MAX_ROOMS) {
    return { error: `There are ${roomCount} rooms required, but only ${MAX_ROOMS} rooms are available.` };
  }

  const sortByRank = () => arr.sort((a, b) => teamRank(a.team, ranks) - teamRank(b.team, ranks));
  if (round === 1) shuffleRange(arr, 0, arr.length - 1, rng);
  else if (power === "strict") sortByRank();
  else if (power === "broad") {
    sortByRank();
    const band = teamsPerRoom * 2;
    for (let start = 0; start < arr.length; start += band) {
      shuffleRange(arr, start, Math.min(start + band, arr.length) - 1, rng);
    }
  } else shuffleRange(arr, 0, arr.length - 1, rng);

  // Swing teams always go last (stable), so they land in the lowest rooms.
  const ordered = [...arr.filter((t) => !isSwing(t.team)), ...arr.filter((t) => isSwing(t.team))];

  const roomTeamNumbers: number[][] = [];
  for (let ri = 0; ri < roomCount; ri++) {
    roomTeamNumbers.push(ordered.slice(ri * teamsPerRoom, (ri + 1) * teamsPerRoom).map((t) => t.team));
  }
  const order = roomPriorityOrder({ roomCount, roomTeams: roomTeamNumbers, ranks }, rng);
  const adj = assignAdjudicators(input.adjudicators, roomCount, order, rng);
  if (adj.error) return { error: adj.error };

  const rooms: DrawRoom[] = [];
  for (let ri = 0; ri < roomCount; ri++) {
    const group = ordered.slice(ri * teamsPerRoom, (ri + 1) * teamsPerRoom);
    const perm = assignPositions(group, positions, input.posHistory, rng);
    const teams: DrawTeam[] = positions.map((pos, i) => {
      const t = group[perm[i]];
      return { position: pos, team: t.team, merged: t.merged, speakers: t.speakers.map((s) => ({ ...s })) };
    });
    rooms.push({
      room: roomNameForIndex(input.roomNames, ri),
      teams,
      adjudicators: (adj.rooms![ri] as AssignedAdjudicator[]).map((a) => ({ ...a })),
    });
  }
  return { rooms };
}
