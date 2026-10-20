// Leaderboard maths - a port of ComputeStats / WriteTeamCombinationBlock /
// WriteIndividualBlock / BuildPowerPairingRankDictionary from the workbook macros.

import type { Format, ResultRow, RollPerson } from "./types.ts";
import { formatInfo, isSwing } from "./types.ts";

const EPS = 1e-7;

export interface ComputeInput {
  format: Format;
  totalRounds: number;
  weightK: number;
  /** Rows of COMPLETED rounds only (score, placement filled in). */
  rows: ResultRow[];
}

export interface Stats {
  format: Format;
  totalRounds: number;
  teamsPerRoom: number;
  targetSize: number;
  speakerSum: Map<string, number>;
  speakerCount: Map<string, number>;
  speakerRoundScores: Map<string, number[]>; // key speaker|round
  speakerIron: Map<string, number>;
  speakerFlatPoints: Map<string, number>;
  speakerWeightedSum: Map<string, number>;
  speakerWeightedRounds: Map<string, number>;
  comboNames: Map<string, string[]>; // key -> sorted names
  comboOcc: Map<string, number>;
  comboPointsSum: Map<string, number>;
  comboScoreSum: Map<string, number>;
  comboScoreCount: Map<string, number>;
  comboRoundPlacement: Map<string, number>; // key|round
  comboRoundTeam: Map<string, Map<number, number>>; // key -> round -> team number
  speakerDifficulty: Map<string, number>;
  comboDifficulty: Map<string, number>;
}

function add(m: Map<string, number>, k: string, v: number): void {
  m.set(k, (m.get(k) ?? 0) + v);
}

export function textCompare(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function sortedNames(names: Iterable<string>): string[] {
  return Array.from(names).sort(textCompare);
}

export function computeStats(input: ComputeInput): Stats {
  const { format, totalRounds, weightK } = input;
  const { teamsPerRoom, targetTeamSize } = formatInfo(format);
  const s: Stats = {
    format,
    totalRounds,
    teamsPerRoom,
    targetSize: targetTeamSize,
    speakerSum: new Map(),
    speakerCount: new Map(),
    speakerRoundScores: new Map(),
    speakerIron: new Map(),
    speakerFlatPoints: new Map(),
    speakerWeightedSum: new Map(),
    speakerWeightedRounds: new Map(),
    comboNames: new Map(),
    comboOcc: new Map(),
    comboPointsSum: new Map(),
    comboScoreSum: new Map(),
    comboScoreCount: new Map(),
    comboRoundPlacement: new Map(),
    comboRoundTeam: new Map(),
    speakerDifficulty: new Map(),
    comboDifficulty: new Map(),
  };

  const byRound = new Map<number, ResultRow[]>();
  for (const r of input.rows) {
    if (!byRound.has(r.round)) byRound.set(r.round, []);
    byRound.get(r.round)!.push(r);
  }
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  for (const round of rounds) {
    const rows = byRound.get(round)!;
    const groups = new Map<number, Map<string, number[]>>(); // team -> speaker -> scores
    const placement = new Map<number, number>();
    const roundSpeakerCounts = new Map<string, number>();

    for (const r of rows) {
      const speaker = r.speaker.trim();
      if (speaker) add(roundSpeakerCounts, speaker, 1);
      if (r.score !== null && r.score !== undefined && speaker) {
        add(s.speakerSum, speaker, r.score);
        add(s.speakerCount, speaker, 1);
        const rk = speaker + "|" + round;
        if (!s.speakerRoundScores.has(rk)) s.speakerRoundScores.set(rk, []);
        s.speakerRoundScores.get(rk)!.push(r.score);
        if (!groups.has(r.team)) groups.set(r.team, new Map());
        const g = groups.get(r.team)!;
        if (!g.has(speaker)) g.set(speaker, []);
        g.get(speaker)!.push(r.score);
      }
      if (r.placement !== null && r.placement !== undefined && !placement.has(r.team)) {
        placement.set(r.team, r.placement);
      }
    }

    for (const [sp, n] of roundSpeakerCounts) {
      if (n >= 2) add(s.speakerIron, sp, 1);
    }

    for (const [team, spMap] of groups) {
      if (!placement.has(team)) continue;
      const place = placement.get(team)!;
      const teamPoints = teamsPerRoom - place;
      const reps = new Map<string, number>();
      for (const [sp, scores] of spMap) {
        reps.set(sp, scores.reduce((a, b) => a + b, 0) / scores.length);
      }
      const n = reps.size;
      if (n < 1) continue;

      const contrib = new Map<string, number>();
      const repEntries = Array.from(reps.entries());
      if (format === "3v3") {
        const mean = repEntries.reduce((a, [, v]) => a + v, 0) / n;
        for (const [sp, v] of repEntries) {
          contrib.set(sp, (teamPoints / targetTeamSize) * (1 + weightK * (v - mean)));
        }
      } else if (n === 1) {
        contrib.set(repEntries[0][0], teamPoints / 2);
      } else if (n === 2) {
        const [sp1, s1] = repEntries[0];
        const [sp2, s2] = repEntries[1];
        let w1: number, w2: number;
        if (s1 >= s2) {
          w1 = 1 + weightK * (s1 - s2);
          w2 = 1;
        } else {
          w1 = 1;
          w2 = 1 + weightK * (s2 - s1);
        }
        contrib.set(sp1, (teamPoints * w1) / (w1 + w2));
        contrib.set(sp2, (teamPoints * w2) / (w1 + w2));
      } else {
        const mean = repEntries.reduce((a, [, v]) => a + v, 0) / n;
        for (const [sp, v] of repEntries) {
          contrib.set(sp, (teamPoints / 2) * (1 + weightK * (v - mean)));
        }
      }
      for (const [sp, c] of contrib) {
        add(s.speakerWeightedSum, sp, c);
        add(s.speakerWeightedRounds, sp, 1);
      }
      for (const [sp] of repEntries) add(s.speakerFlatPoints, sp, teamPoints);

      const names = sortedNames(reps.keys());
      const key = names.join("|");
      if (!s.comboNames.has(key)) {
        s.comboNames.set(key, names);
        s.comboOcc.set(key, 0);
        s.comboPointsSum.set(key, 0);
        s.comboScoreSum.set(key, 0);
        s.comboScoreCount.set(key, 0);
        s.comboRoundTeam.set(key, new Map());
      }
      add(s.comboOcc, key, 1);
      s.comboRoundPlacement.set(key + "|" + round, place);
      s.comboRoundTeam.get(key)!.set(round, team);
      add(s.comboPointsSum, key, teamPoints);
      for (const [, v] of repEntries) {
        add(s.comboScoreSum, key, v);
        add(s.comboScoreCount, key, 1);
      }
    }
  }

  computeDifficulty(s, byRound, rounds);
  return s;
}

function weightedMean(s: Stats, speaker: string): number | null {
  const cnt = s.speakerWeightedRounds.get(speaker);
  if (!cnt || cnt <= 0) return null;
  return (s.speakerWeightedSum.get(speaker) ?? 0) / cnt;
}

function computeDifficulty(s: Stats, byRound: Map<number, ResultRow[]>, rounds: number[]): void {
  const spTotal = new Map<string, number>();
  const spCount = new Map<string, number>();
  const coTotal = new Map<string, number>();
  const coCount = new Map<string, number>();

  for (const round of rounds) {
    const rows = byRound.get(round)!;
    const roomTeams = new Map<string, Set<number>>();
    const teamSpeakers = new Map<number, Set<string>>();
    for (const r of rows) {
      const room = r.room.trim();
      const speaker = r.speaker.trim();
      if (!room || !speaker) continue;
      if (r.score === null || r.score === undefined) continue;
      if (!roomTeams.has(room)) roomTeams.set(room, new Set());
      roomTeams.get(room)!.add(r.team);
      if (!teamSpeakers.has(r.team)) teamSpeakers.set(r.team, new Set());
      teamSpeakers.get(r.team)!.add(speaker);
    }
    for (const [, teams] of roomTeams) {
      for (const home of teams) {
        let total = 0;
        let count = 0;
        for (const opp of teams) {
          if (opp === home) continue;
          const oppSp = teamSpeakers.get(opp);
          if (!oppSp) continue;
          for (const sp of oppSp) {
            const wm = weightedMean(s, sp);
            if (wm !== null) {
              total += wm;
              count++;
            }
          }
        }
        if (count === 0) continue;
        const roundDifficulty = total / count;
        const homeSp = teamSpeakers.get(home);
        if (!homeSp) continue;
        for (const sp of homeSp) {
          add(spTotal, sp, roundDifficulty);
          add(spCount, sp, 1);
        }
        if (homeSp.size > 0) {
          const key = sortedNames(homeSp).join("|");
          add(coTotal, key, roundDifficulty);
          add(coCount, key, 1);
        }
      }
    }
  }
  for (const [k, v] of spTotal) {
    const c = spCount.get(k)!;
    if (c > 0) s.speakerDifficulty.set(k, v / c);
  }
  for (const [k, v] of coTotal) {
    const c = coCount.get(k)!;
    if (c > 0) s.comboDifficulty.set(k, v / c);
  }
}

/** "Draw Strength": rank by difficulty (hardest = 1), ties shown as "=n". */
export function buildDifficultyRanks(d: Map<string, number>): Map<string, string> {
  const keys = Array.from(d.keys());
  keys.sort((a, b) => {
    const da = d.get(a)!;
    const db = d.get(b)!;
    if (da > db + EPS) return -1;
    if (da < db - EPS) return 1;
    return textCompare(a, b);
  });
  const out = new Map<string, string>();
  let i = 0;
  while (i < keys.length) {
    const cur = d.get(keys[i])!;
    let end = i;
    while (end < keys.length - 1 && Math.abs(d.get(keys[end + 1])! - cur) <= EPS) end++;
    const rank = i + 1;
    for (let k = i; k <= end; k++) {
      out.set(keys[k], end > i ? "=" + rank : String(rank));
    }
    i = end + 1;
  }
  return out;
}

export function ordinal(n: number): string {
  const m100 = n % 100;
  let suffix: string;
  if (m100 === 11 || m100 === 12 || m100 === 13) suffix = "th";
  else {
    const m10 = n % 10;
    suffix = m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  }
  return n + suffix;
}

// ---------------------------------------------------------------- leaderboard

export interface TeamRow {
  rank: number;
  members: string;
  memberList: string[];
  results: (string | null)[];
  debates: number;
  avgTeamPoints: number;
  avgSpeakerScore: number;
  totalTeamPoints: number;
  drawStrength: string | null;
  drawDifficulty: number | null;
  feedback: number;
  eligible: boolean;
}

export interface SpeakerRow {
  rank: number;
  name: string;
  rounds: (number[] | null)[];
  average: number;
  totalScore: number;
  performances: number;
  teamPoints: number;
  ironCount: number;
  weighted: number;
  drawStrength: string | null;
  drawDifficulty: number | null;
  eligible: boolean;
}

export const TEAM_CRITERIA = ["avgTeamPoints", "avgSpeakerScore", "avgWeighted", "totalTeamPoints", "totalSpeakerScore", "drawDifficulty", "feedback"] as const;
export const SPEAKER_CRITERIA = ["average", "totalScore", "weighted", "teamPoints", "drawDifficulty"] as const;
export const DEFAULT_TEAM_RANK: string[] = ["avgTeamPoints", "avgSpeakerScore", "feedback"];
export const DEFAULT_SPEAKER_RANK: string[] = ["average", "totalScore"];
export const MAX_RANK_LEVELS = 5;

export interface RankOptions {
  minDebates?: number;
  teamRank?: string[];
  speakerRank?: string[];
}

/** Keep only known, unique criteria (in order); fall back to the default if nothing valid is left. */
export function cleanRank(list: unknown, allowed: readonly string[], fallback: string[]): string[] {
  const out: string[] = [];
  if (Array.isArray(list)) for (const k of list) if (typeof k === "string" && allowed.includes(k) && !out.includes(k)) out.push(k);
  return out.length ? out.slice(0, MAX_RANK_LEVELS) : [...fallback];
}

export interface Leaderboard {
  minDebates: number;
  teamRank: string[];
  speakerRank: string[];
  format: Format;
  totalRounds: number;
  teamsPerRoom: number;
  completedRounds: number[];
  teams: TeamRow[];
  top: TeamRow[];
  speakers: SpeakerRow[];
}

/** feedbackGiven: key `${round}|${team}` -> number of feedback ratings that team submitted. */
export function buildLeaderboard(
  s: Stats,
  completedRounds: number[],
  feedbackGiven: Map<string, number>,
  opts: RankOptions = {},
): Leaderboard {
  const minDebates = Math.max(1, Math.floor(opts.minDebates ?? 3));
  const teamRank = cleanRank(opts.teamRank, TEAM_CRITERIA, DEFAULT_TEAM_RANK);
  const speakerRank = cleanRank(opts.speakerRank, SPEAKER_CRITERIA, DEFAULT_SPEAKER_RANK);
  const wOf = (name: string): number => {
    const wc = s.speakerWeightedRounds.get(name) ?? 0;
    return wc > 0 ? (s.speakerWeightedSum.get(name) ?? 0) / wc : 0;
  };
  const comboKeys = Array.from(s.comboNames.keys());
  const rows = comboKeys.map((key) => {
    const occ = s.comboOcc.get(key)!;
    const pts = s.comboPointsSum.get(key)!;
    const avgTeam = pts / occ;
    const avgSp = s.comboScoreSum.get(key)! / s.comboScoreCount.get(key)!;
    let fb = 0;
    for (const [round, team] of s.comboRoundTeam.get(key)!) {
      fb += feedbackGiven.get(round + "|" + team) ?? 0;
    }
    const names = s.comboNames.get(key)!;
    const vals: Record<string, number> = {
      avgTeamPoints: avgTeam,
      avgSpeakerScore: avgSp,
      avgWeighted: names.reduce((acc, n) => acc + wOf(n), 0) / Math.max(1, names.length),
      totalTeamPoints: pts,
      totalSpeakerScore: s.comboScoreSum.get(key)!,
      drawDifficulty: s.comboDifficulty.get(key) ?? 0,
      feedback: fb,
    };
    return { key, occ, avgTeam, avgSp, pts, fb, vals, eligible: occ >= minDebates };
  });
  rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    for (const k of teamRank) {
      if (Math.abs(a.vals[k] - b.vals[k]) > 1e-9) return b.vals[k] - a.vals[k];
    }
    return textCompare(a.key, b.key);
  });

  const comboRank = buildDifficultyRanks(s.comboDifficulty);
  const teams: TeamRow[] = rows.map((r, i) => {
    const results: (string | null)[] = [];
    for (let rd = 1; rd <= s.totalRounds; rd++) {
      const p = s.comboRoundPlacement.get(r.key + "|" + rd);
      if (p === undefined) results.push(null);
      else if (s.format === "3v3") results.push(p === 1 ? "Win" : "Loss");
      else results.push(ordinal(p));
    }
    const names = s.comboNames.get(r.key)!;
    return {
      rank: i + 1,
      members: names.join(", "),
      memberList: names,
      results,
      debates: r.occ,
      avgTeamPoints: r.avgTeam,
      avgSpeakerScore: r.avgSp,
      totalTeamPoints: r.pts,
      drawStrength: comboRank.get(r.key) ?? null,
      drawDifficulty: s.comboDifficulty.get(r.key) ?? null,
      feedback: r.fb,
      eligible: r.eligible,
    };
  });
  const top = teams.filter((t) => t.eligible).slice(0, 4); // resized by the caller from the tournament setting

  const spKeys = Array.from(s.speakerSum.keys());
  const spVal = (name: string, k: string): number => {
    switch (k) {
      case "average": return s.speakerSum.get(name)! / s.speakerCount.get(name)!;
      case "totalScore": return s.speakerSum.get(name)!;
      case "weighted": return wOf(name);
      case "teamPoints": return s.speakerFlatPoints.get(name) ?? 0;
      default: return s.speakerDifficulty.get(name) ?? 0;
    }
  };
  spKeys.sort((a, b) => {
    for (const k of speakerRank) {
      const x = spVal(a, k), y = spVal(b, k);
      if (Math.abs(x - y) > 1e-9) return y - x;
    }
    return textCompare(a, b);
  });
  const spRank = buildDifficultyRanks(s.speakerDifficulty);
  const speakers: SpeakerRow[] = spKeys.map((name, i) => {
    const rounds: (number[] | null)[] = [];
    for (let rd = 1; rd <= s.totalRounds; rd++) {
      rounds.push(s.speakerRoundScores.get(name + "|" + rd) ?? null);
    }
    const cnt = s.speakerCount.get(name)!;
    const wCnt = s.speakerWeightedRounds.get(name) ?? 0;
    return {
      rank: i + 1,
      name,
      rounds,
      average: s.speakerSum.get(name)! / cnt,
      totalScore: s.speakerSum.get(name)!,
      performances: cnt,
      teamPoints: s.speakerFlatPoints.get(name) ?? 0,
      ironCount: s.speakerIron.get(name) ?? 0,
      weighted: wCnt > 0 ? (s.speakerWeightedSum.get(name) ?? 0) / wCnt : 0,
      drawStrength: spRank.get(name) ?? null,
      drawDifficulty: s.speakerDifficulty.get(name) ?? null,
      eligible: cnt >= minDebates,
    };
  });

  return {
    minDebates,
    teamRank,
    speakerRank,
    format: s.format,
    totalRounds: s.totalRounds,
    teamsPerRoom: s.teamsPerRoom,
    completedRounds,
    teams,
    top,
    speakers,
  };
}

// ------------------------------------------------------- power pairing ranks

/**
 * Port of BuildPowerPairingRankDictionary. Returns team number -> rank (1 = best)
 * for every team that appears on the roll. Returns an empty map when no round has
 * been completed (so Round 1 behaves as "no ranking data").
 */
export function powerPairingRanks(s: Stats, roll: RollPerson[]): Map<number, number> {
  const out = new Map<number, number>();
  if (s.speakerWeightedRounds.size === 0) return out;

  const teamScore = new Map<number, number>();
  const teamMembers = new Map<number, number>();
  for (const p of roll) {
    if (!p.name.trim() || !Number.isFinite(p.team)) continue;
    if (!teamScore.has(p.team)) teamScore.set(p.team, 0);
    const wm = weightedMean(s, p.name.trim());
    if (wm !== null) {
      teamScore.set(p.team, teamScore.get(p.team)! + wm);
      teamMembers.set(p.team, (teamMembers.get(p.team) ?? 0) + 1);
    }
  }
  for (const [t, n] of teamMembers) {
    if (n > 0) teamScore.set(t, (teamScore.get(t)! / n) * s.targetSize);
  }
  const keys = Array.from(teamScore.keys());
  keys.sort((a, b) => {
    const sa = isSwing(a);
    const sb = isSwing(b);
    if (sa !== sb) return sa ? 1 : -1;
    const va = teamScore.get(a)!;
    const vb = teamScore.get(b)!;
    if (va > vb) return -1;
    if (va < vb) return 1;
    return a - b;
  });
  keys.forEach((k, i) => out.set(k, i + 1));
  return out;
}
