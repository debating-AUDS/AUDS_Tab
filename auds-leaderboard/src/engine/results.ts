// Results sheets - ports of Enter_Results (building rows from a draw) and
// Round_Complete (validation, placements, team totals).

import type { DrawRoom, Format, ResultRow } from "./types.ts";
import { CHOOSE_IRON_LABEL, SCORE_MAX, SCORE_MIN, formatInfo } from "./types.ts";

export interface BuiltRow {
  room: string;
  position: string;
  team: number;
  speaker: string;
  originalTeam: number;
  merged: boolean;
  score: number | null;
}

/**
 * Expand a draw into result rows. A team that is short of the target size gets extra
 * rows: a lone speaker is simply duplicated (they iron-person), while a team with 2+
 * members gets "CHOOSE IRON" placeholder rows to be replaced by the real speaker.
 * `oldScores` carries scores across a rebuild, keyed team|speaker|nth-row-of-team.
 */
export function buildResultRows(
  format: Format,
  rooms: DrawRoom[],
  oldScores: Map<string, number>,
): BuiltRow[] {
  const target = formatInfo(format).targetTeamSize;
  const out: BuiltRow[] = [];
  for (const room of rooms) {
    for (const t of room.teams) {
      const rows: BuiltRow[] = t.speakers.map((s) => ({
        room: room.room,
        position: t.position,
        team: t.team,
        speaker: s.name,
        originalTeam: s.originalTeam,
        merged: t.merged,
        score: null,
      }));
      if (rows.length > 0 && rows.length < target) {
        const first = rows[0];
        const missing = target - rows.length;
        for (let i = 0; i < missing; i++) {
          rows.push({
            ...first,
            speaker: t.speakers.length === 1 ? first.speaker : CHOOSE_IRON_LABEL,
            score: null,
          });
        }
      }
      rows.forEach((r, i) => {
        const key = `${r.team}|${r.speaker}|${i + 1}`;
        const old = oldScores.get(key);
        if (old !== undefined) r.score = old;
      });
      out.push(...rows);
    }
  }
  return out;
}

export function scoreKey(team: number, speaker: string, nth: number): string {
  return `${team}|${speaker}|${nth}`;
}

export interface CompleteInput {
  format: Format;
  roundNo: number;
  rows: ResultRow[]; // in sheet order
  allowDuplicateSpeakers: boolean;
}

export interface CompleteOutput {
  error?: string;
  /** set when the caller may retry with allowDuplicateSpeakers = true */
  needsConfirm?: "duplicate-speaker";
  /** rows to insert (solo iron-person duplicates) - same fields as ResultRow with no id */
  extraRows?: ResultRow[];
  placements?: Map<number, number>;
  totals?: Map<number, number>;
}

export function validateAndPlace(input: CompleteInput): CompleteOutput {
  const { format, roundNo } = input;
  const { teamsPerRoom, targetTeamSize } = formatInfo(format);
  let rows = input.rows.slice();
  if (rows.length === 0) return { error: `No result data exists for Round ${roundNo}.` };

  for (const r of rows) {
    if (r.speaker.trim().toUpperCase() === CHOOSE_IRON_LABEL) {
      return {
        error: `A row for team ${r.team} still contains the '${CHOOSE_IRON_LABEL}' placeholder. Replace it with the name of the team member covering that position before completing the round.`,
      };
    }
  }

  // Teams made up of a single speaker repeated: top up to the target size by duplicating.
  const extraRows: ResultRow[] = [];
  const byTeam = new Map<number, ResultRow[]>();
  for (const r of rows) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team)!.push(r);
  }
  for (const [, trs] of byTeam) {
    const names = new Set(trs.map((r) => r.speaker.trim()));
    if (names.size === 1 && trs.length < targetTeamSize) {
      for (let i = trs.length; i < targetTeamSize; i++) {
        const copy: ResultRow = { ...trs[0], id: undefined, score: null, placement: null, teamTotal: null };
        extraRows.push(copy);
        rows.push(copy);
      }
    }
  }

  const teamRowCount = new Map<number, number>();
  for (const r of rows) teamRowCount.set(r.team, (teamRowCount.get(r.team) ?? 0) + 1);

  const roomTeams = new Map<string, number[]>();
  const teamScore = new Map<number, number>();
  const teamScored = new Map<number, number>();
  const speakerTeams = new Map<string, Set<number>>();
  let sawDuplicate = false;

  for (const r of rows) {
    const room = r.room.trim();
    const speaker = r.speaker.trim();
    if (!room || !speaker || !Number.isFinite(r.team)) {
      return { error: "A result row is missing room, team or speaker information." };
    }
    if (speakerTeams.has(speaker)) {
      if (!speakerTeams.get(speaker)!.has(r.team)) {
        sawDuplicate = true;
        speakerTeams.get(speaker)!.add(r.team);
      }
    } else speakerTeams.set(speaker, new Set([r.team]));

    const addRoomTeam = () => {
      if (!roomTeams.has(room)) roomTeams.set(room, []);
      const l = roomTeams.get(room)!;
      if (!l.includes(r.team)) l.push(r.team);
    };

    if (r.score === null || r.score === undefined || Number.isNaN(r.score)) {
      if ((teamRowCount.get(r.team) ?? 0) > targetTeamSize) {
        addRoomTeam();
        continue; // unscored substitute on an oversized team
      }
      return {
        error: `Speaker '${speaker}' has no score entered. Every speaking performance must have a score between ${SCORE_MIN} and ${SCORE_MAX}.`,
      };
    }
    if (r.score < SCORE_MIN || r.score > SCORE_MAX) {
      return { error: `Score for '${speaker}' is outside the permitted range of ${SCORE_MIN}-${SCORE_MAX}.` };
    }
    teamScore.set(r.team, (teamScore.get(r.team) ?? 0) + r.score);
    teamScored.set(r.team, (teamScored.get(r.team) ?? 0) + 1);
    if (teamScored.get(r.team)! > targetTeamSize) {
      return {
        error: `Team ${r.team} has more than ${targetTeamSize} scored performances. Only ${targetTeamSize} speaker(s) per team may be scored in a round.`,
      };
    }
    addRoomTeam();
  }

  if (sawDuplicate && !input.allowDuplicateSpeakers) {
    return {
      needsConfirm: "duplicate-speaker",
      error:
        "A speaker appears under more than one team in this round. This is normally invalid because an iron-person should speak twice for the SAME team. Confirm to accept both appearances.",
    };
  }

  const placements = new Map<number, number>();
  const totals = new Map<number, number>();
  for (const [room, teams] of roomTeams) {
    if (teams.length !== teamsPerRoom) {
      return { error: `Room ${room} does not contain exactly ${teamsPerRoom} team(s).` };
    }
    for (const t of teams) {
      if (!teamScored.has(t)) return { error: `Team ${t} has no score.` };
      if (teamScored.get(t) !== targetTeamSize) {
        return {
          error: `Team ${t} must have exactly ${targetTeamSize} scored performance(s) (currently has ${teamScored.get(t)}).`,
        };
      }
    }
    const sorted = teams.slice().sort((a, b) => teamScore.get(b)! - teamScore.get(a)!);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (teamScore.get(sorted[i]) === teamScore.get(sorted[i + 1])) {
        return { error: `A tie has occurred in room ${room}. The round cannot be completed.` };
      }
    }
    sorted.forEach((t, i) => {
      placements.set(t, i + 1);
      totals.set(t, teamScore.get(t)! / targetTeamSize);
    });
  }
  return { extraRows, placements, totals };
}
