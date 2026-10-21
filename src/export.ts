// Everything about a tournament, as a JSON document and as an Excel workbook.

import { adjudicatorViews, leaderboard, loadAllDraws, loadDecisions, loadFeedback, loadResultRows, loadRoll, loadRounds, roomsOf, tournamentJson } from "./store.ts";
import type { TournamentRow } from "./store.ts";
import { drawView } from "./views.ts";
import { buildXlsx, bold, h, title } from "./xlsx.ts";
import type { Cell, Sheet } from "./xlsx.ts";
import { formatInfo } from "./engine/types.ts";
import type { DrawRoom } from "./engine/types.ts";
import { TEAM_CRITERIA, SPEAKER_CRITERIA } from "./engine/stats.ts";

export const TEAM_CRITERIA_LABELS: Record<string, string> = {
  avgTeamPoints: "Average team points",
  avgSpeakerScore: "Average speaker score",
  avgWeighted: "Average weighted contribution",
  totalTeamPoints: "Total team points",
  totalSpeakerScore: "Total speaker score",
  drawDifficulty: "Draw difficulty",
  feedback: "Feedback given",
};
export const SPEAKER_CRITERIA_LABELS: Record<string, string> = {
  average: "Average score",
  totalScore: "Total score",
  weighted: "Weighted contribution",
  teamPoints: "Team points",
  drawDifficulty: "Draw difficulty",
};

export async function exportJson(env: Env, t: TournamentRow, tournament: unknown) {
  const draws = await loadAllDraws(env, t);
  const adjs = await adjudicatorViews(env, t);
  const dec = await loadDecisions(env, t.id);
  return {
    app: "auds-leaderboard",
    version: 2,
    exportedAt: new Date().toISOString(),
    tournament,
    roll: await loadRoll(env, t.id),
    decisions: [
      ...Object.entries(dec.solo).map(([key, value]) => ({ kind: "solo", key, value })),
      ...Object.entries(dec.pair).map(([key, value]) => ({ kind: "pair", key, value })),
    ],
    adjudicators: adjs.map((a) => ({ name: a.name, trainee: a.trainee, attending: a.attending, confidence: a.confidence })),
    draws: Object.fromEntries(Array.from(draws.entries()).map(([k, v]) => [k, drawView(v)])),
    results: await loadResultRows(env, t.id),
    feedback: await loadFeedback(env, t.id),
  };
}

const adjText = (d: DrawRoom) => d.adjudicators.map((a) => `${a.role}: ${a.name}`).join("; ");

export async function buildWorkbook(env: Env, t: TournamentRow): Promise<Uint8Array> {
  const rounds = await loadRounds(env, t.id);
  const meta = (tournamentJson(t, rounds, true) as any).rounds as { round: number; name: string; topic: string }[];
  const info = formatInfo(t.format);
  const sheets: Sheet[] = [];

  // ---- Setup
  const pairs: [string, string | number | boolean][] = [
    ["Name", t.name],
    ["Format", t.format],
    ["Number of rounds", t.total_rounds],
    ["Weighting parameter", t.weight_k],
    ["Rooms", roomsOf(t).join(", ")],
    ["Debates needed to be break eligible", t.min_debates],
    ["Top break-eligible teams to show", t.top_count],
    ["Rank teams by", (tournamentJson(t, rounds, true) as any).teamRank.map((k: string) => TEAM_CRITERIA_LABELS[k] ?? k).join(", ")],
    ["Rank speakers by", (tournamentJson(t, rounds, true) as any).speakerRank.map((k: string) => SPEAKER_CRITERIA_LABELS[k] ?? k).join(", ")],
    ["Winners", t.winners || ""],
    ["Status", t.status === "archived" ? "Archived" : "Active"],
    ["Date", (t.archived_at || t.created_at || "").slice(0, 10)],
    ["Roll complete", !!t.roll_complete],
    ["Feedback open", !!t.feedback_open],
  ];
  const setup: Cell[][] = [[h("Setting"), h("Value")], ...pairs.map(([k, v]) => [bold(k), v as Cell])];
  setup.push([], [h("Round"), h("Name"), h("Topic"), h("Status"), h("Draw published"), h("Show placement"), h("Show team average"), h("Show speaker scores")]);
  for (const r of rounds) {
    setup.push([r.round, r.name || `Round ${r.round}`, r.topic || "", r.status, !!r.published, !!r.show_placement, !!r.show_team_avg, !!r.show_speaker_scores]);
  }
  sheets.push({ name: "Setup", rows: setup, widths: [36, 40, 40, 14, 16, 16, 18, 20] });

  // ---- Leaderboard
  const lb = await leaderboard(env, t, false);
  const roundNames = meta.map((m) => m.name);
  const lbRows: Cell[][] = [[title(t.name + ": team leaderboard")], [], [h("Rank"), h("Team"), h("Break eligible"), h("Debates"), ...roundNames.map(h), h("Avg team points"), h("Avg speaker score"), h("Total team points"), h("Draw strength"), h("Feedback given")]];
  for (const x of lb.teams) {
    lbRows.push([x.rank, x.members, x.eligible, x.debates, ...x.results.map((v) => v ?? ""), x.avgTeamPoints, x.avgSpeakerScore, x.totalTeamPoints, x.drawStrength ?? "", x.feedback]);
  }
  lbRows.push([], [title(t.name + ": speaker leaderboard")], [], [h("Rank"), h("Speaker"), h("Break eligible"), h("Performances"), ...roundNames.map(h), h("Average"), h("Total score"), h("Weighted contribution"), h("Team points"), h("Irons"), h("Draw strength")]);
  for (const x of lb.speakers) {
    lbRows.push([x.rank, x.name, x.eligible, x.performances, ...x.rounds.map((v) => (v && v.length ? v.join(" / ") : "")), x.average, x.totalScore, x.weighted, x.teamPoints, x.ironCount, x.drawStrength ?? ""]);
  }
  sheets.push({ name: "Leaderboard", rows: lbRows, widths: [8, 38, 14, 12, ...roundNames.map(() => 14), 16, 16, 16, 14, 14] });

  // ---- Adjudicators
  const adjs = await adjudicatorViews(env, t);
  sheets.push({
    name: "Adjudicators",
    freezeHeader: true,
    widths: [30, 10, 11, 12, 16, 12, 14],
    rows: [
      [h("Name"), h("Trainee"), h("Attending"), h("Confidence"), h("Feedback count"), h("Average"), h("Ranking score")],
      ...adjs.map((a) => [a.name, a.trainee, a.attending, a.confidence, a.thisTournament.count, a.thisTournament.avg, a.rankingScore] as Cell[]),
    ],
  });

  // ---- Roll (+ the Y/N answers for short teams)
  const roll = await loadRoll(env, t.id);
  const dec = await loadDecisions(env, t.id);
  const decRows = [
    ...Object.entries(dec.solo).map(([k, v]) => ["solo", k, v]),
    ...Object.entries(dec.pair).map(([k, v]) => ["pair", k, v]),
  ];
  const rollRows: Cell[][] = [[h("Name"), h("Team"), h("Present"), null, h("Short-team question"), h("Speaker / team"), h("Answer")]];
  for (let i = 0; i < Math.max(roll.length, decRows.length); i++) {
    const p = roll[i];
    const d = decRows[i];
    rollRows.push([p?.name, p?.team, p ? p.present : null, null, d?.[0], d?.[1], d?.[2]]);
  }
  sheets.push({ name: "Roll", rows: rollRows, freezeHeader: true, widths: [30, 8, 10, 3, 20, 24, 10] });

  // ---- one sheet per round
  const draws = await loadAllDraws(env, t);
  const results = await loadResultRows(env, t.id);
  for (const r of rounds) {
    const header: Cell[] = [h("Room"), h("Adjudicators"), h("Position"), h("Team"), h("Speaker"), h("Original team"), h("Merged team"), h("Score"), h("Placement"), h("Team average")];
    const rows: Cell[][] = [header];
    const draw = draws.get(r.round) ?? [];
    const res = results.filter((x) => x.round === r.round);
    if (res.length) {
      const order = [...draw.map((d) => d.room)];
      for (const x of res) if (!order.includes(x.room)) order.push(x.room);
      for (const room of order) {
        const d = draw.find((x) => x.room === room);
        let first = true;
        for (const x of res.filter((y) => y.room === room)) {
          rows.push([x.room, first && d ? adjText(d) : "", x.position, x.team, x.speaker, x.originalTeam, x.merged, x.score, x.placement, x.teamTotal]);
          first = false;
        }
      }
    } else {
      for (const d of draw) {
        let first = true;
        for (const tm of d.teams) {
          for (const sp of tm.speakers) {
            rows.push([d.room, first ? adjText(d) : "", tm.position, tm.team, sp.name, sp.originalTeam, tm.merged, null, null, null]);
            first = false;
          }
        }
      }
    }
    sheets.push({ name: `Round ${r.round}`, rows, freezeHeader: true, widths: [12, 44, 10, 8, 28, 14, 13, 9, 11, 13] });
  }

  // ---- Feedback
  const fb = await loadFeedback(env, t.id);
  sheets.push({
    name: "Feedback",
    freezeHeader: true,
    widths: [8, 12, 26, 28, 10, 10, 14, 16, 14, 16, 9, 40, 20],
    rows: [
      [h("Round"), h("Room"), h("Adjudicator"), h("From"), h("Overall"), h("Decision"), h("Justification"), h("Chair management"), h("Contribution"), h("Counts in rating"), h("Source"), h("Comment"), h("Submitted")],
      ...fb.map((f) => [f.round, f.room, f.adjudicator, f.giver, f.score, f.q_decision, f.q_justification, f.q_chair, f.q_contribution, !f.excluded, f.source, f.comment, f.created_at] as Cell[]),
    ],
  });

  void info;
  void TEAM_CRITERIA;
  void SPEAKER_CRITERIA;
  return buildXlsx(sheets);
}
