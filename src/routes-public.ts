import type { Router } from "./router.ts";
import { fail, int, json, num, readJson, str } from "./http.ts";
import { checkPassword, clearSessionCookie, fingerprint, isAdmin, makeSessionCookie, sha256Hex } from "./auth.ts";
import {
  collapseSlots,
  completedResultRows,
  getRound,
  getTournament,
  leaderboard,
  loadAllDraws,
  loadDraw,
  loadFeedback,
  loadResultRows,
  loadRounds,
  tournamentJson,
} from "./store.ts";
import type { TournamentRow } from "./store.ts";
import { drawView, resultsView } from "./views.ts";
import { roomFeedbackLayout } from "./engine/adjudicators.ts";
import { FEEDBACK_MAX, FEEDBACK_MIN } from "./engine/types.ts";

function secure(url: URL): boolean {
  return url.protocol === "https:";
}

/** Public view of one round: the draw once published, results once completed. */
export async function roundView(env: any, t: TournamentRow, n: number, admin: boolean) {
  const round = await getRound(env, t, n);
  const draw = await loadDraw(env, t, n);
  const showDraw = !!draw && (admin || !!round.published);
  const showResults = round.status === "completed" || (admin && round.status === "scoring");
  let results = null;
  if (showResults) {
    const rows = await loadResultRows(env, t.id, n);
    const show = admin
      ? { placement: true, teamAverage: true, speakerScores: true }
      : { placement: !!round.show_placement, teamAverage: !!round.show_team_avg, speakerScores: !!round.show_speaker_scores };
    results = resultsView(t.format, rows, draw, round.status === "completed", show);
  }
  return {
    round: n,
    name: round.name || `Round ${n}`,
    topic: showDraw || showResults ? round.topic || "" : "",
    status: round.status,
    published: !!round.published,
    draw: showDraw ? drawView(draw!) : null,
    results,
  };
}

export function registerPublic(r: Router): void {
  r.get("/api/me", async ({ env, req }) => json({ admin: await isAdmin(env, req) }));

  r.post("/api/login", async ({ env, req, url }) => {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      fail(500, "The admin password has not been configured on the server yet (see the setup guide).");
    }
    const body = await readJson(req);
    const fp = await fingerprint(env, req);
    const now = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE fingerprint = ? AND at > ?")
      .bind(fp, now - 15 * 60)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 8) fail(429, "Too many failed attempts. Please wait 15 minutes and try again.");
    const ok = await checkPassword(env, typeof body.password === "string" ? body.password : "");
    if (!ok) {
      await env.DB.prepare("INSERT INTO login_attempts (fingerprint, at) VALUES (?, ?)").bind(fp, now).run();
      await env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(now - 24 * 3600).run();
      fail(401, "Incorrect password.");
    }
    return json({ ok: true }, 200, { "set-cookie": await makeSessionCookie(env, secure(url)) });
  });

  r.post("/api/logout", async ({ url }) => json({ ok: true }, 200, { "set-cookie": clearSessionCookie(secure(url)) }));

  r.get("/api/public/tournaments", async ({ env }) => {
    const res = await env.DB.prepare(
      `SELECT t.slug, t.name, t.format, t.status, t.total_rounds, t.current_round, t.created_at, t.archived_at,
              (SELECT COUNT(*) FROM rounds r WHERE r.tournament_id = t.id AND r.status = 'completed') AS completed
         FROM tournaments t
        ORDER BY (t.status = 'active') DESC, t.created_at DESC, t.id DESC`,
    ).all<any>();
    return json({
      tournaments: res.results.map((x: any) => ({
        slug: x.slug,
        name: x.name,
        format: x.format,
        status: x.status,
        totalRounds: x.total_rounds,
        currentRound: x.current_round,
        completedRounds: x.completed,
        createdAt: x.created_at,
        archivedAt: x.archived_at,
      })),
    });
  });

  r.get("/api/public/t/:slug", async ({ env, params }) => {
    const t = await getTournament(env, params.slug);
    return json({ tournament: tournamentJson(t, await loadRounds(env, t.id), false) });
  });

  r.get("/api/public/t/:slug/leaderboard", async ({ env, params }) => {
    const t = await getTournament(env, params.slug);
    return json({ leaderboard: await leaderboard(env, t, true), topCount: t.top_count, winners: t.status === "archived" ? t.winners || "" : "" });
  });

  r.get("/api/public/t/:slug/rounds/:n", async ({ env, params }) => {
    const t = await getTournament(env, params.slug);
    return json(await roundView(env, t, Number(params.n), false));
  });

  // ------------------------------------------------------------- feedback form
  r.get("/api/public/t/:slug/feedback-form", async ({ env, params }) => {
    const t = await getTournament(env, params.slug);
    const rounds = (await loadRounds(env, t.id)).filter((x) => x.published && x.status !== "empty");
    const draws = await loadAllDraws(env, t);
    const out = rounds.map((rd) => ({
      round: rd.round,
      name: rd.name || `Round ${rd.round}`,
      rooms: (draws.get(rd.round) ?? []).map((room) => {
        const layout = roomFeedbackLayout(room.teams, room.adjudicators);
        return {
          room: room.room,
          adjudicators: room.adjudicators,
          teams: room.teams.map((tm) => ({
            team: tm.team,
            position: tm.position,
            members: tm.speakers.map((s) => s.name),
          })),
          givers: layout.givers.map((g) => ({ id: g.id, kind: g.kind, label: g.label, role: g.role ?? null, targets: g.targets })),
        };
      }),
    }));
    return json({
      open: !!t.feedback_open && t.status === "active",
      codeRequired: !!t.feedback_code,
      min: FEEDBACK_MIN,
      max: FEEDBACK_MAX,
      rounds: out,
    });
  });

  r.post("/api/public/t/:slug/feedback", async ({ env, req, params }) => {
    const t = await getTournament(env, params.slug);
    if (t.status !== "active" || !t.feedback_open) fail(403, "Feedback is not open for this tournament.");
    const body = await readJson(req);
    if (t.feedback_code) {
      const given = typeof body.code === "string" ? body.code.trim() : "";
      const a = await sha256Hex("fc:" + given);
      const b = await sha256Hex("fc:" + t.feedback_code);
      if (a !== b) fail(403, "That feedback code is not correct.", "bad-code");
    }
    const roundNo = int(body.round, "round", 1, t.total_rounds);
    const round = await getRound(env, t, roundNo);
    if (!round.published) fail(404, "That round's draw has not been published.");
    const roomName = str(body.room, "room", 80);
    const giverId = str(body.giverId, "giverId", 120);
    const draw = (await loadDraw(env, t, roundNo)) ?? [];
    const room = draw.find((x) => x.room === roomName);
    if (!room) fail(400, "That room is not in this round's draw.");
    const layout = roomFeedbackLayout(room!.teams, room!.adjudicators);
    const giver = layout.givers.find((g) => g.id === giverId);
    if (!giver) fail(400, "That feedback giver is not in this room.");
    if (!Array.isArray(body.ratings) || body.ratings.length === 0) fail(400, "Add at least one rating.");
    if (body.ratings.length > 20) fail(400, "Too many ratings.");

    const fp = await fingerprint(env, req);
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM feedback WHERE tournament_id = ? AND fingerprint = ? AND created_at > ?",
    )
      .bind(t.id, fp, hourAgo)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 60) fail(429, "You've submitted a lot of feedback recently. Please try again later.");

    const seen = new Set<string>();
    const stmts: D1PreparedStatement[] = [];
    for (const raw of body.ratings) {
      const adjName = str(raw?.adjudicator, "adjudicator", 100);
      const target = giver!.targets.find((x) => x.adjudicator.toLowerCase() === adjName.toLowerCase());
      if (!target) fail(400, `${adjName} cannot be rated by ${giver!.label}.`);
      if (seen.has(target!.adjudicator)) fail(400, `${adjName} appears twice.`);
      seen.add(target!.adjudicator);
      const score = num(raw.score, "score", FEEDBACK_MIN, FEEDBACK_MAX);
      const comment = str(raw.comment, "comment", 1000, false);
      stmts.push(
        env.DB.prepare(
          "DELETE FROM feedback WHERE tournament_id = ? AND round = ? AND room = ? AND adjudicator = ? AND giver = ? AND fingerprint = ? AND source = 'public'",
        ).bind(t.id, roundNo, roomName, target!.adjudicator, giver!.label, fp),
        env.DB.prepare(
          "INSERT INTO feedback (tournament_id, round, room, adjudicator, giver, score, comment, source, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, 'public', ?)",
        ).bind(t.id, roundNo, roomName, target!.adjudicator, giver!.label, score, comment || null, fp),
      );
    }
    await env.DB.batch(stmts);
    return json({ ok: true, saved: seen.size });
  });
}

export { collapseSlots, completedResultRows, loadFeedback };
