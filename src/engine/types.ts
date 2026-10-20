// Shared types for the tournament engine. Everything in src/engine is pure
// TypeScript with no Cloudflare dependencies, so it can be unit tested in Node.

export type Format = "3v3" | "BP";
export type PowerMode = "none" | "strict" | "broad";
export type AdjRole = "C" | "P" | "T";

export interface RollPerson {
  name: string;
  team: number;
  present: boolean;
}

export interface AdjudicatorInput {
  name: string;
  trainee: boolean;
  attending: boolean;
  /** pooled average feedback score (0-10) or prior estimate */
  avg: number | null;
  /** number of real feedback samples behind `avg` */
  count: number;
  /** subjective confidence 0-100 used when count == 0 */
  confidence: number;
}

export interface AssignedAdjudicator {
  role: AdjRole;
  name: string;
}

export interface DrawSpeaker {
  name: string;
  originalTeam: number;
}

export interface DrawTeam {
  position: string;
  team: number;
  merged: boolean;
  speakers: DrawSpeaker[];
}

export interface DrawRoom {
  room: string;
  teams: DrawTeam[];
  adjudicators: AssignedAdjudicator[];
}

/** One scored (or scoreable) row on a results sheet. */
export interface ResultRow {
  id?: number;
  round: number;
  room: string;
  position: string;
  team: number;
  speaker: string;
  score: number | null;
  originalTeam: number;
  merged: boolean;
  placement: number | null;
  teamTotal: number | null;
}

export interface FormatInfo {
  teamsPerRoom: number;
  targetTeamSize: number;
  positions: string[];
}

export const SWING_TEAM_THRESHOLD = 100;
export const MAX_ROOMS = 10;
export const CHOOSE_IRON_LABEL = "CHOOSE IRON";
export const SCORE_MIN = 50;
export const SCORE_MAX = 100;
export const FEEDBACK_MIN = 1;
export const FEEDBACK_MAX = 10;
export const ADJ_CONFIDENCE_Z = 1.2816014;
export const ADJ_ZERO_FEEDBACK_PSEUDO_SAMPLES = 10;
export const DEFAULT_ROOMS = ["LG29", "LG28", "LG24", "LG21", "LG18", "LG16"];

export function formatInfo(format: Format): FormatInfo {
  if (format === "3v3") {
    return { teamsPerRoom: 2, targetTeamSize: 3, positions: ["Aff", "Neg"] };
  }
  return { teamsPerRoom: 4, targetTeamSize: 2, positions: ["OG", "OO", "CG", "CO"] };
}

export function isSwing(team: number): boolean {
  return team > SWING_TEAM_THRESHOLD;
}

/** Room name for a 0-based room index: fixed names first, then "Room 1", "Room 2"... */
export function roomNameForIndex(rooms: string[], i: number): string {
  if (i < rooms.length) return rooms[i];
  return "Room " + (i - (rooms.length - 1));
}

export function givenLabelTeam(team: number, position: string): string {
  return `Team ${team} (${position})`;
}
