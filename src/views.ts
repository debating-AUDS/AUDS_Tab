// Shapes sent to the browser for draws, results and the feedback grid.

import type { DrawRoom, Format, ResultRow } from "./engine/types.ts";
import { CHOOSE_IRON_LABEL, formatInfo } from "./engine/types.ts";
import { roomFeedbackLayout } from "./engine/adjudicators.ts";
import type { FeedbackRow, Slot } from "./store.ts";

export function drawView(rooms: DrawRoom[]) {
  return {
    rooms: rooms.map((r) => ({
      room: r.room,
      adjudicators: r.adjudicators,
      teams: r.teams.map((t) => ({
        position: t.position,
        team: t.team,
        merged: t.merged,
        speakers: t.speakers.map((s) => ({ name: s.name, originalTeam: s.originalTeam })),
      })),
    })),
  };
}

export interface ShowFlags {
  placement: boolean;
  teamAverage: boolean;
  speakerScores: boolean;
}

export function resultsView(format: Format, rows: ResultRow[], draw: DrawRoom[] | null, completed: boolean, show: ShowFlags = { placement: true, teamAverage: true, speakerScores: true }) {
  const positions = formatInfo(format).positions;
  const roomOrder: string[] = draw ? draw.map((r) => r.room) : [];
  for (const r of rows) if (!roomOrder.includes(r.room)) roomOrder.push(r.room);
  const rooms = roomOrder
    .map((roomName) => {
      const roomRows = rows.filter((r) => r.room === roomName);
      if (roomRows.length === 0) return null;
      const posList: string[] = [];
      for (const r of roomRows) if (!posList.includes(r.position)) posList.push(r.position);
      posList.sort((a, b) => positions.indexOf(a) - positions.indexOf(b));
      const teams = posList.map((pos) => {
        const tr = roomRows.filter((r) => r.position === pos);
        return {
          position: pos,
          team: tr[0].team,
          merged: tr[0].merged,
          placement: show.placement ? tr[0].placement : null,
          teamTotal: show.teamAverage ? tr[0].teamTotal : null,
          rows: tr.map((r) => ({
            id: r.id,
            speaker: r.speaker,
            originalTeam: r.originalTeam,
            score: show.speakerScores ? r.score : null,
            needsIron: r.speaker.trim().toUpperCase() === CHOOSE_IRON_LABEL,
          })),
        };
      });
      return {
        room: roomName,
        adjudicators: draw?.find((d) => d.room === roomName)?.adjudicators ?? [],
        teams,
      };
    })
    .filter(Boolean);
  return { completed, show, rooms };
}

export function feedbackGrid(rooms: DrawRoom[], raw: FeedbackRow[], slots: Slot[]) {
  return rooms.map((room) => {
    const layout = roomFeedbackLayout(room.teams, room.adjudicators);
    return {
      room: room.room,
      adjudicators: room.adjudicators,
      slots: layout.slots.map((s) => {
        const entries = raw.filter(
          (f) => f.room === room.room && f.adjudicator.toLowerCase() === s.adjudicator.toLowerCase() && f.giver === s.giver,
        );
        const slot = slots.find(
          (x) => x.room === room.room && x.adjudicator.toLowerCase() === s.adjudicator.toLowerCase() && x.giver === s.giver,
        );
        return {
          adjudicator: s.adjudicator,
          role: s.role,
          giver: s.giver,
          avg: slot ? slot.mean : null,
          entries: entries.map((e) => ({
            id: e.id,
            score: e.score,
            comment: e.comment,
            source: e.source,
            createdAt: e.created_at,
          })),
        };
      }),
    };
  });
}
