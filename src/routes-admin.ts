import type { Router, Ctx } from "./router.ts";
import { bool, fail, int, json, num, readJson, str } from "./http.ts";
import { requireAdmin } from "./auth.ts";
import { DEFAULT_SPEAKER_RANK, DEFAULT_TEAM_RANK, MAX_RANK_LEVELS, SPEAKER_CRITERIA, TEAM_CRITERIA } from "./engine/stats.ts";
import {
  adjudicatorViews,
  assertActive,
  collapseSlots,
  drawStatements,
  getRound,
  getTournament,
  loadAllDraws,
  loadDecisions,
  loadDraw,
  loadFeedback,
  loadResultRows,
  loadRoll,
  loadRounds,
  posHistory,
  rankDictionary,
  resultInsert,
  roomsOf,
  toAdjudicatorInputs,
  tournamentJson,
} from "./store.ts";
import type { TournamentRow } from "./store.ts";
import { drawView, feedbackGrid, resultsView } from "./views.ts";
import { buildWorkbook, exportJson } from "./export.ts";
import { importTournament } from "./import.ts";
import { roundView } from "./routes-public.ts";
import { generateDraw, rollCheck } from "./engine/draw.ts";
import { buildResultRows, scoreKey, validateAndPlace } from "./engine/results.ts";
import { roomFeedbackLayout } from "./engine/adjudicators.ts";
import { randomSeed, seededRng } from "./engine/rng.ts";
import type { DrawRoom, PowerMode, ResultRow } from "./engine/types.ts";
import { DEFAULT_ROOMS, FEEDBACK_MAX, FEEDBACK_MIN, MAX_ROOMS, SCORE_MAX, SCORE_MIN, formatInfo } from "./engine/types.ts";

type H = (ctx: Ctx) => Promise<Response>;

function admin(handler: H): H {
  return async (ctx) => {
    await requireAdmin(ctx.env, ctx.req);
    return handler(ctx);
  };
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "tournament";
}

function isUnique(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
}

async function freshTournament(ctx: Ctx, writable = true): Promise<TournamentRow> {
  const t = await getTournament(ctx.env, ctx.params.slug);
  if (writable) assertActive(t);
  return t;
}

/** Validates an ordered list of ranking criteria from the browser. */
function rankList(v: unknown, allowed: readonly string[], label: string): string {
  if (!Array.isArray(v) || v.length === 0) fail(400, `Choose at least one ${label} ranking criterion.`);
  const list = v as unknown[];
  if (list.length > MAX_RANK_LEVELS) fail(400, `At most ${MAX_RANK_LEVELS} ${label} ranking criteria.`);
  const seen = new Set<string>();
  for (const k of list) {
    if (typeof k !== "string" || !allowed.includes(k)) fail(400, `Unknown ${label} ranking criterion.`);
    if (seen.has(k as string)) fail(400, `Each ${label} ranking criterion can only be used once.`);
    seen.add(k as string);
  }
  return JSON.stringify(list);
}

async function adminTournamentJson(ctx: Ctx, t: TournamentRow) {
  const rounds = await loadRounds(ctx.env, t.id);
  const base = tournamentJson(t, rounds, true) as Record<string, unknown>;
  const roll = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(present), 0) AS present FROM roll WHERE tournament_id = ?",
  )
    .bind(t.id)
    .first<{ total: number; present: number }>();
  const adj = await ctx.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tournament_adjudicators WHERE tournament_id = ? AND attending = 1",
  )
    .bind(t.id)
    .first<{ n: number }>();
  base.counts = { roll: roll?.total ?? 0, present: roll?.present ?? 0, adjudicatorsAttending: adj?.n ?? 0 };
  return base;
}

function parsePower(v: unknown): PowerMode {
  return v === "strict" || v === "broad" ? v : "none";
}

export function registerAdmin(r: Router): void {
  // ------------------------------------------------------------- tournaments
  r.get("/api/admin/tournaments", admin(async ({ env }) => {
    const res = await env.DB.prepare("SELECT slug, name, format, status, total_rounds, current_round, created_at, archived_at FROM tournaments ORDER BY (status = 'active') DESC, (display_order IS NULL), display_order, COALESCE(archived_at, created_at) DESC, id DESC").all<any>();
    return json({
      tournaments: res.results.map((x: any) => ({
        slug: x.slug,
        name: x.name,
        format: x.format,
        status: x.status,
        totalRounds: x.total_rounds,
        currentRound: x.current_round,
        createdAt: x.created_at,
        archivedAt: x.archived_at,
      })),
    });
  }));

  r.post("/api/admin/tournaments", admin(async ({ env, req }) => {
    const body = await readJson(req);
    const name = str(body.name, "Name", 100);
    const format = body.format === "BP" ? "BP" : body.format === "3v3" ? "3v3" : fail(400, "Format must be '3v3' or 'BP'.");
    const totalRounds = int(body.totalRounds, "Number of rounds", 1, 20);
    const weightK = body.weightK === undefined || body.weightK === "" ? 0.1 : num(body.weightK, "Weighting parameter", 0, 10);
    const minDebates = body.minDebates === undefined || body.minDebates === "" ? 3 : int(body.minDebates, "Debates to be break eligible", 1, 20);
    const teamRank = body.teamRank === undefined ? JSON.stringify(DEFAULT_TEAM_RANK) : rankList(body.teamRank, TEAM_CRITERIA, "team");
    const speakerRank = body.speakerRank === undefined ? JSON.stringify(DEFAULT_SPEAKER_RANK) : rankList(body.speakerRank, SPEAKER_CRITERIA, "speaker");
    let rooms = DEFAULT_ROOMS;
    if (Array.isArray(body.rooms) && body.rooms.length > 0) {
      rooms = body.rooms.map((x: unknown) => str(x, "Room name", 40));
      if (new Set(rooms.map((x: string) => x.toLowerCase())).size !== rooms.length) fail(400, "Room names must be unique.");
      if (rooms.length > MAX_ROOMS) fail(400, `At most ${MAX_ROOMS} rooms.`);
    }
    const active = await env.DB.prepare("SELECT name FROM tournaments WHERE status = 'active' LIMIT 1").first<{ name: string }>();
    if (active) fail(409, `"${active.name}" is still active. Archive it before starting a new tournament.`, "active-exists");
    let slug = slugify(name);
    const exists = await env.DB.prepare("SELECT 1 AS x FROM tournaments WHERE slug = ?").bind(slug).first();
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;
    const ins = await env.DB.prepare(
      "INSERT INTO tournaments (slug, name, format, total_rounds, weight_k, rooms_json, min_debates, team_rank, speaker_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(slug, name, format, totalRounds, weightK, JSON.stringify(rooms), minDebates, teamRank, speakerRank)
      .run();
    const tid = (ins.meta as any).last_row_id as number;
    const stmts: D1PreparedStatement[] = [];
    for (let i = 1; i <= totalRounds; i++) {
      stmts.push(env.DB.prepare("INSERT INTO rounds (tournament_id, round) VALUES (?, ?)").bind(tid, i));
    }
    stmts.push(
      env.DB.prepare(
        "INSERT INTO tournament_adjudicators (tournament_id, adjudicator_id, attending) SELECT ?, id, 0 FROM adjudicators",
      ).bind(tid),
    );
    await env.DB.batch(stmts);
    const t = await getTournament(env, slug);
    return json({ tournament: tournamentJson(t, await loadRounds(env, tid), true) }, 201);
  }));

  r.post("/api/admin/import", admin(async ({ env, req }) => {
    const body = await readJson(req, 8_000_000);
    const result = await importTournament(env, body.data, { as: body.as === "keep" ? "keep" : "archive" });
    return json(result, 201);
  }));

  r.get("/api/admin/t/:slug", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    return json({ tournament: await adminTournamentJson(ctx, t) });
  }));

  r.patch("/api/admin/t/:slug", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(req);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) {
      sets.push("name = ?");
      args.push(str(body.name, "Name", 100));
    }
    if (body.weightK !== undefined) {
      sets.push("weight_k = ?");
      args.push(num(body.weightK, "Weighting parameter", 0, 10));
    }
    if (body.rooms !== undefined) {
      if (!Array.isArray(body.rooms) || body.rooms.length === 0) fail(400, "Provide at least one room name.");
      const rooms = body.rooms.map((x: unknown) => str(x, "Room name", 40));
      if (new Set(rooms.map((x: string) => x.toLowerCase())).size !== rooms.length) fail(400, "Room names must be unique.");
      if (rooms.length > MAX_ROOMS) fail(400, `At most ${MAX_ROOMS} rooms.`);
      sets.push("rooms_json = ?");
      args.push(JSON.stringify(rooms));
    }
    if (body.minDebates !== undefined) {
      sets.push("min_debates = ?");
      args.push(int(body.minDebates, "Debates to be break eligible", 1, 20));
    }
    if (body.teamRank !== undefined) (sets.push("team_rank = ?"), args.push(rankList(body.teamRank, TEAM_CRITERIA, "team")));
    if (body.speakerRank !== undefined) (sets.push("speaker_rank = ?"), args.push(rankList(body.speakerRank, SPEAKER_CRITERIA, "speaker")));
    if (body.topCount !== undefined) {
      sets.push("top_count = ?");
      args.push(int(body.topCount, "Number of top teams", 0, 50));
    }
    if (body.feedbackOpen !== undefined) {
      sets.push("feedback_open = ?");
      args.push(bool(body.feedbackOpen) ? 1 : 0);
    }
    if (body.feedbackCode !== undefined) {
      const c = body.feedbackCode === null ? "" : str(body.feedbackCode, "Feedback code", 40, false);
      sets.push("feedback_code = ?");
      args.push(c || null);
    }
    const stmts: D1PreparedStatement[] = [];
    if (body.totalRounds !== undefined) {
      const n = int(body.totalRounds, "Number of rounds", 1, 20);
      const rounds = await loadRounds(env, t.id);
      if (n < t.total_rounds) {
        const blocked = rounds.filter((x) => x.round > n && x.status !== "empty");
        if (blocked.length) fail(409, `Round ${blocked[0].round} already has a draw or results, so it can't be removed.`);
        stmts.push(env.DB.prepare("DELETE FROM rounds WHERE tournament_id = ? AND round > ?").bind(t.id, n));
      } else {
        for (let i = t.total_rounds + 1; i <= n; i++) {
          stmts.push(env.DB.prepare("INSERT INTO rounds (tournament_id, round) VALUES (?, ?)").bind(t.id, i));
        }
      }
      sets.push("total_rounds = ?", "current_round = MIN(current_round, ?)");
      args.push(n, n + 1);
    }
    if (sets.length === 0) fail(400, "Nothing to change.");
    stmts.push(env.DB.prepare(`UPDATE tournaments SET ${sets.join(", ")} WHERE id = ?`).bind(...args, t.id));
    await env.DB.batch(stmts);
    const fresh = await getTournament(env, t.slug);
    return json({ tournament: await adminTournamentJson(ctx, fresh) });
  }));

  r.post("/api/admin/t/:slug/archive", admin(async (ctx) => {
    const { env } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(ctx.req);
    const winners = body.winners === undefined || body.winners === null ? "" : str(body.winners, "Winners", 300, false);
    const stmts: D1PreparedStatement[] = [];
    stmts.push(
      env.DB.prepare("UPDATE tournaments SET status = 'archived', feedback_open = 0, archived_at = datetime('now'), display_order = (SELECT COALESCE(MIN(display_order), 0) - 1 FROM tournaments), winners = ? WHERE id = ?").bind(winners || null, t.id),
    );
    await env.DB.batch(stmts);
    return json({ ok: true });
  }));

  // Archive manager: the date shown for an archived tournament, and the order of the archive list.
  r.patch("/api/admin/t/:slug/archive-date", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    if (t.status !== "archived") fail(409, "Only archived tournaments have an editable date.");
    const body = await readJson(ctx.req);
    const d = typeof body.date === "string" ? body.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + "T12:00:00Z"))) fail(400, "Enter the date as YYYY-MM-DD.");
    await ctx.env.DB.prepare("UPDATE tournaments SET archived_at = ? WHERE id = ?").bind(d + " 12:00:00", t.id).run();
    return json({ ok: true });
  }));

  r.put("/api/admin/archive-order", admin(async ({ env, req }) => {
    const body = await readJson(req);
    if (!Array.isArray(body.slugs) || body.slugs.length > 500) fail(400, "Send the list of tournaments in the order you want.");
    const stmts = body.slugs.map((s: unknown, i: number) =>
      env.DB.prepare("UPDATE tournaments SET display_order = ? WHERE slug = ? AND status = 'archived'").bind(i, String(s)),
    );
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true });
  }));

  r.delete("/api/admin/t/:slug", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    const body = await readJson(ctx.req);
    if (body.confirm !== t.slug) fail(400, "Type the tournament's address name to confirm deletion.");
    await ctx.env.DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(t.id).run();
    return json({ ok: true });
  }));

  r.get("/api/admin/t/:slug/export", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    const data = await exportJson(ctx.env, t, await adminTournamentJson(ctx, t));
    return json(data, 200, { "content-disposition": `attachment; filename="${t.slug}-export.json"` });
  }));

  r.get("/api/admin/t/:slug/export.xlsx", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    const bytes = await buildWorkbook(ctx.env, t);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${t.slug}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }));

  // -------------------------------------------------------------------- roll
  const rollPayload = async (ctx: Ctx, t: TournamentRow) => {
    const roll = await loadRoll(ctx.env, t.id);
    const dec = await loadDecisions(ctx.env, t.id);
    return { roll, rollComplete: !!t.roll_complete, decisions: dec, check: rollCheck(t.format, roll, dec.solo, dec.pair) };
  };

  r.get("/api/admin/t/:slug/roll", admin(async (ctx) => json(await rollPayload(ctx, await freshTournament(ctx, false)))));

  r.put("/api/admin/t/:slug/roll", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(req);
    if (!Array.isArray(body.rows)) fail(400, "rows must be a list.");
    if (body.rows.length > 500) fail(400, "At most 500 people.");
    const seen = new Set<string>();
    const rows = body.rows.map((x: any, i: number) => {
      const name = str(x?.name, `Name (row ${i + 1})`, 80);
      const team = int(x?.team, `Team (row ${i + 1})`, 1, 9999);
      if (seen.has(name.toLowerCase())) fail(400, `'${name}' appears more than once. Names must be unique.`);
      seen.add(name.toLowerCase());
      return { name, team, present: x?.present === undefined ? true : bool(x.present) };
    });
    const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM roll WHERE tournament_id = ?").bind(t.id)];
    rows.forEach((x: any, i: number) =>
      stmts.push(
        env.DB.prepare("INSERT INTO roll (tournament_id, name, team, present, sort) VALUES (?, ?, ?, ?, ?)").bind(t.id, x.name, x.team, x.present ? 1 : 0, i),
      ),
    );
    stmts.push(env.DB.prepare("UPDATE tournaments SET roll_complete = 0 WHERE id = ?").bind(t.id));
    await env.DB.batch(stmts);
    return json(await rollPayload(ctx, await getTournament(env, t.slug)));
  }));

  r.post("/api/admin/t/:slug/roll", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(req);
    const name = str(body.name, "Name", 80);
    const team = int(body.team, "Team", 1, 9999);
    try {
      await env.DB.prepare(
        "INSERT INTO roll (tournament_id, name, team, present, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM roll WHERE tournament_id = ?))",
      )
        .bind(t.id, name, team, body.present === undefined ? 1 : bool(body.present) ? 1 : 0, t.id)
        .run();
    } catch (e) {
      if (isUnique(e)) fail(409, `'${name}' is already on the roll.`);
      throw e;
    }
    await env.DB.prepare("UPDATE tournaments SET roll_complete = 0 WHERE id = ?").bind(t.id).run();
    return json(await rollPayload(ctx, await getTournament(env, t.slug)), 201);
  }));

  r.patch("/api/admin/t/:slug/roll/:id", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const id = int(ctx.params.id, "id");
    const body = await readJson(req);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) {
      sets.push("name = ?");
      args.push(str(body.name, "Name", 80));
    }
    if (body.team !== undefined) {
      sets.push("team = ?");
      args.push(int(body.team, "Team", 1, 9999));
    }
    if (body.present !== undefined) {
      sets.push("present = ?");
      args.push(bool(body.present) ? 1 : 0);
    }
    if (!sets.length) fail(400, "Nothing to change.");
    try {
      const res = await env.DB.prepare(`UPDATE roll SET ${sets.join(", ")} WHERE id = ? AND tournament_id = ?`).bind(...args, id, t.id).run();
      if (!(res.meta as any).changes) fail(404, "Person not found.");
    } catch (e) {
      if (isUnique(e)) fail(409, "Someone with that name is already on the roll.");
      throw e;
    }
    await env.DB.prepare("UPDATE tournaments SET roll_complete = 0 WHERE id = ?").bind(t.id).run();
    return json(await rollPayload(ctx, await getTournament(env, t.slug)));
  }));

  r.delete("/api/admin/t/:slug/roll/:id", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    await ctx.env.DB.prepare("DELETE FROM roll WHERE id = ? AND tournament_id = ?").bind(int(ctx.params.id, "id"), t.id).run();
    await ctx.env.DB.prepare("UPDATE tournaments SET roll_complete = 0 WHERE id = ?").bind(t.id).run();
    return json(await rollPayload(ctx, await getTournament(ctx.env, t.slug)));
  }));

  r.put("/api/admin/t/:slug/roll-complete", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    const body = await readJson(ctx.req);
    await ctx.env.DB.prepare("UPDATE tournaments SET roll_complete = ? WHERE id = ?").bind(bool(body.complete) ? 1 : 0, t.id).run();
    return json(await rollPayload(ctx, await getTournament(ctx.env, t.slug)));
  }));

  r.put("/api/admin/t/:slug/roll-decisions", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(req);
    const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM roll_decisions WHERE tournament_id = ?").bind(t.id)];
    for (const kind of ["solo", "pair"] as const) {
      const m = body[kind] ?? {};
      if (typeof m !== "object" || Array.isArray(m)) fail(400, `${kind} must be an object.`);
      for (const [k, v] of Object.entries(m)) {
        if (v !== "Y" && v !== "N") continue;
        stmts.push(env.DB.prepare("INSERT INTO roll_decisions (tournament_id, kind, key, value) VALUES (?, ?, ?, ?)").bind(t.id, kind, String(k).slice(0, 80), v));
      }
    }
    await env.DB.batch(stmts);
    return json(await rollPayload(ctx, t));
  }));

  // ----------------------------------------------------------- adjudicators
  r.get("/api/admin/t/:slug/adjudicators", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    return json({ adjudicators: await adjudicatorViews(ctx.env, t) });
  }));

  r.post("/api/admin/t/:slug/adjudicators/mark-all", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    const body = await readJson(ctx.req);
    const v = bool(body.attending) ? 1 : 0;
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        "INSERT OR IGNORE INTO tournament_adjudicators (tournament_id, adjudicator_id, attending) SELECT ?, id, ? FROM adjudicators",
      ).bind(t.id, v),
      ctx.env.DB.prepare("UPDATE tournament_adjudicators SET attending = ? WHERE tournament_id = ?").bind(v, t.id),
    ]);
    return json({ adjudicators: await adjudicatorViews(ctx.env, t) });
  }));

  r.post("/api/admin/t/:slug/adjudicators", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const body = await readJson(req);
    const name = str(body.name, "Name", 80);
    const confidence = body.confidence === undefined || body.confidence === "" ? 50 : num(body.confidence, "Confidence", 0, 100);
    try {
      const ins = await env.DB.prepare(
        "INSERT INTO adjudicators (name, trainee, confidence) VALUES (?, ?, ?)",
      )
        .bind(name, bool(body.trainee) ? 1 : 0, confidence)
        .run();
      const id = (ins.meta as any).last_row_id as number;
      await env.DB.prepare("INSERT OR REPLACE INTO tournament_adjudicators (tournament_id, adjudicator_id, attending) VALUES (?, ?, ?)")
        .bind(t.id, id, body.attending === undefined || bool(body.attending) ? 1 : 0)
        .run();
    } catch (e) {
      if (isUnique(e)) fail(409, `'${name}' is already in the adjudicator list.`);
      throw e;
    }
    return json({ adjudicators: await adjudicatorViews(env, t) }, 201);
  }));

  r.patch("/api/admin/t/:slug/adjudicators/:id", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const id = int(ctx.params.id, "id");
    const body = await readJson(req);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) (sets.push("name = ?"), args.push(str(body.name, "Name", 80)));
    if (body.trainee !== undefined) (sets.push("trainee = ?"), args.push(bool(body.trainee) ? 1 : 0));
    if (body.confidence !== undefined) (sets.push("confidence = ?"), args.push(num(body.confidence, "Confidence", 0, 100)));
    try {
      if (sets.length) {
        const res = await env.DB.prepare(`UPDATE adjudicators SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
        if (!(res.meta as any).changes) fail(404, "Adjudicator not found.");
      }
      if (body.attending !== undefined) {
        await env.DB.prepare("INSERT OR REPLACE INTO tournament_adjudicators (tournament_id, adjudicator_id, attending) VALUES (?, ?, ?)")
          .bind(t.id, id, bool(body.attending) ? 1 : 0)
          .run();
      }
    } catch (e) {
      if (isUnique(e)) fail(409, "Another adjudicator already has that name.");
      throw e;
    }
    return json({ adjudicators: await adjudicatorViews(env, t) });
  }));

  r.delete("/api/admin/t/:slug/adjudicators/:id", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    await ctx.env.DB.prepare("DELETE FROM adjudicators WHERE id = ?").bind(int(ctx.params.id, "id")).run();
    return json({ adjudicators: await adjudicatorViews(ctx.env, t) });
  }));

  // ------------------------------------------------------------------- draws
  r.get("/api/admin/t/:slug/rounds/:n", admin(async (ctx) => {
    const t = await freshTournament(ctx, false);
    return json(await roundView(ctx.env, t, Number(ctx.params.n), true));
  }));

  r.post("/api/admin/t/:slug/rounds/:n/draw", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    const body = await readJson(req);
    if (!t.roll_complete) fail(409, "Tick 'Roll complete' on the Roll page first, so we know attendance is final.", "roll-incomplete");
    if (round.status === "completed") fail(409, `Round ${n} is already completed. Reopen it before generating a new draw.`, "round-completed");
    if (round.status === "scoring" && !bool(body.confirm)) {
      fail(409, `Round ${n} already has a results sheet. Generating a new draw will delete it. Confirm to continue.`, "confirm-overwrite");
    }
    const power = parsePower(body.power);
    const roll = await loadRoll(env, t.id);
    const dec = await loadDecisions(env, t.id);
    const ranks = n === 1 ? new Map<number, number>() : await rankDictionary(env, t);
    const history = await posHistory(env, t.id, n);
    const adjs = toAdjudicatorInputs(await adjudicatorViews(env, t));
    const seed = body.seed !== undefined ? Number(body.seed) : randomSeed();
    const out = generateDraw({
      format: t.format,
      round: n,
      roll,
      solo: dec.solo,
      pair: dec.pair,
      power,
      ranks,
      posHistory: history,
      adjudicators: adjs,
      roomNames: roomsOf(t),
      rng: seededRng(Number.isFinite(seed) ? seed : randomSeed()),
    });
    if (out.error) fail(422, out.error);
    await env.DB.batch([
      ...drawStatements(env, t.id, n, out.rooms!),
      env.DB.prepare("DELETE FROM results WHERE tournament_id = ? AND round = ?").bind(t.id, n),
      env.DB.prepare("UPDATE rounds SET status = 'drawn', published = 0, power = ?, completed_at = NULL WHERE tournament_id = ? AND round = ?").bind(power, t.id, n),
      env.DB.prepare("UPDATE tournaments SET roll_complete = 0 WHERE id = ?").bind(t.id),
    ]);
    return json(await roundView(env, t, n, true));
  }));

  r.put("/api/admin/t/:slug/rounds/:n/draw", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    if (round.status === "completed") fail(409, `Round ${n} is completed. Reopen it before editing the draw.`);
    if (round.status === "empty") fail(409, "Generate a draw first.");
    if (round.published) fail(409, "Unpublish this draw before editing it.", "draw-published");
    const body = await readJson(req);
    const rooms = validateDraw(t, body.draw);
    await env.DB.batch(drawStatements(env, t.id, n, rooms));
    return json({ ...(await roundView(env, t, n, true)), resultsStale: round.status === "scoring" });
  }));

  r.patch("/api/admin/t/:slug/rounds/:n", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    await getRound(env, t, n);
    const body = await readJson(req);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (body.name !== undefined) {
      const name = body.name === null ? "" : str(body.name, "Round name", 40, false);
      sets.push("name = ?");
      args.push(!name || name.toLowerCase() === `round ${n}` ? null : name);
    }
    if (body.showPlacement !== undefined) (sets.push("show_placement = ?"), args.push(bool(body.showPlacement) ? 1 : 0));
    if (body.showTeamAverage !== undefined) (sets.push("show_team_avg = ?"), args.push(bool(body.showTeamAverage) ? 1 : 0));
    if (body.showSpeakerScores !== undefined) (sets.push("show_speaker_scores = ?"), args.push(bool(body.showSpeakerScores) ? 1 : 0));
    if (body.topic !== undefined) {
      const topic = body.topic === null ? "" : str(body.topic, "Topic", 600, false);
      sets.push("topic = ?");
      args.push(topic || null);
    }
    if (sets.length === 0) fail(400, "Nothing to change.");
    await env.DB.prepare(`UPDATE rounds SET ${sets.join(", ")} WHERE tournament_id = ? AND round = ?`).bind(...args, t.id, n).run();
    return json({ tournament: await adminTournamentJson(ctx, t), ...(await roundView(env, t, n, true)) });
  }));

  r.put("/api/admin/t/:slug/rounds/:n/publish", admin(async (ctx) => {
    const { env } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    const body = await readJson(ctx.req);
    if (round.status === "empty") fail(409, "There is no draw to publish yet.");
    if (bool(body.published) && !bool(body.confirmMismatch)) {
      const draw = (await loadDraw(env, t, n)) ?? [];
      const present = new Set((await loadRoll(env, t.id)).filter((p) => p.present).map((p) => p.name.toLowerCase()));
      const attending = new Set((await adjudicatorViews(env, t)).filter((a) => a.attending).map((a) => a.name.toLowerCase()));
      const speakers: string[] = [];
      const adjs: string[] = [];
      for (const room of draw) {
        for (const tm of room.teams) for (const sp of tm.speakers) if (!present.has(sp.name.toLowerCase())) speakers.push(sp.name);
        for (const a of room.adjudicators) if (!attending.has(a.name.toLowerCase())) adjs.push(a.name);
      }
      if (speakers.length || adjs.length) {
        const parts: string[] = [];
        if (speakers.length) parts.push(`Speakers not marked present on the roll: ${speakers.join(", ")}.`);
        if (adjs.length) parts.push(`Adjudicators not marked as attending: ${adjs.join(", ")}.`);
        fail(409, `Some names in this draw don't match the roll. ${parts.join(" ")}`, "confirm-mismatch");
      }
    }
    await env.DB.prepare("UPDATE rounds SET published = ? WHERE tournament_id = ? AND round = ?").bind(bool(body.published) ? 1 : 0, t.id, n).run();
    return json(await roundView(env, t, n, true));
  }));

  r.delete("/api/admin/t/:slug/rounds/:n/draw", admin(async (ctx) => {
    const { env } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    if (round.status === "completed") fail(409, `Round ${n} is completed. Reopen it first.`);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM draw_rooms WHERE tournament_id = ? AND round = ?").bind(t.id, n),
      env.DB.prepare("DELETE FROM draw_entries WHERE tournament_id = ? AND round = ?").bind(t.id, n),
      env.DB.prepare("DELETE FROM results WHERE tournament_id = ? AND round = ?").bind(t.id, n),
      env.DB.prepare("UPDATE rounds SET status = 'empty', published = 0, power = NULL WHERE tournament_id = ? AND round = ?").bind(t.id, n),
    ]);
    return json(await roundView(env, t, n, true));
  }));

  // ----------------------------------------------------------------- results
  r.post("/api/admin/t/:slug/rounds/:n/results/build", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    const body = await readJson(req);
    const draw = await loadDraw(env, t, n);
    if (!draw || round.status === "empty") fail(409, "Generate a draw for this round first.");
    if (round.status === "completed" && !bool(body.confirm)) {
      fail(409, `Round ${n} is completed. Rebuilding will reopen it (scores are kept). Confirm to continue.`, "confirm-reopen");
    }
    const old = await loadResultRows(env, t.id, n);
    const oldScores = new Map<string, number>();
    const nth = new Map<number, number>();
    for (const row of old) {
      const k = (nth.get(row.team) ?? 0) + 1;
      nth.set(row.team, k);
      if (row.score !== null) oldScores.set(scoreKey(row.team, row.speaker, k), row.score);
    }
    const built = buildResultRows(t.format, draw!, oldScores);
    const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM results WHERE tournament_id = ? AND round = ?").bind(t.id, n)];
    built.forEach((b, i) =>
      stmts.push(
        resultInsert(env, t.id, { ...b, round: n, placement: null, teamTotal: null } as ResultRow, i),
      ),
    );
    stmts.push(env.DB.prepare("UPDATE rounds SET status = 'scoring', completed_at = NULL WHERE tournament_id = ? AND round = ?").bind(t.id, n));
    await env.DB.batch(stmts);
    return json(await roundView(env, t, n, true));
  }));

  r.put("/api/admin/t/:slug/rounds/:n/results", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    if (round.status !== "scoring" && round.status !== "completed") fail(409, "Build the results sheet first.");
    const body = await readJson(req);
    if (!Array.isArray(body.rows)) fail(400, "rows must be a list.");
    const rows = await loadResultRows(env, t.id, n);
    const byId = new Map(rows.map((x) => [x.id!, x]));
    for (const u of body.rows) {
      const id = int(u?.id, "row id");
      const row = byId.get(id);
      if (!row) fail(404, `Row ${id} not found in this round.`);
      if (u.speaker !== undefined) row!.speaker = str(u.speaker, "Speaker", 80);
      if (u.score !== undefined) {
        if (u.score === null || u.score === "") row!.score = null;
        else row!.score = num(u.score, "Score", SCORE_MIN, SCORE_MAX);
      }
    }
    if (round.status === "completed") {
      const out = validateAndPlace({ format: t.format, roundNo: n, rows, allowDuplicateSpeakers: bool(body.allowDuplicateSpeakers) });
      if (out.error) fail(out.needsConfirm ? 409 : 422, out.error, out.needsConfirm ? "confirm-duplicate" : undefined);
      await writeCompletedRows(env, t, n, rows, out.extraRows ?? [], out.placements!, out.totals!, false);
    } else {
      await env.DB.batch(
        rows.map((x) =>
          env.DB.prepare("UPDATE results SET speaker = ?, score = ? WHERE id = ? AND tournament_id = ?").bind(x.speaker, x.score, x.id, t.id),
        ),
      );
    }
    return json(await roundView(env, t, n, true));
  }));

  r.post("/api/admin/t/:slug/rounds/:n/complete", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    if (round.status !== "scoring" && round.status !== "completed") fail(409, "Build the results sheet and enter scores first.");
    const body = await readJson(req);
    const rows = await loadResultRows(env, t.id, n);
    const out = validateAndPlace({ format: t.format, roundNo: n, rows, allowDuplicateSpeakers: bool(body.allowDuplicateSpeakers) });
    if (out.error) fail(out.needsConfirm ? 409 : 422, out.error, out.needsConfirm ? "confirm-duplicate" : undefined);
    await writeCompletedRows(env, t, n, rows, out.extraRows ?? [], out.placements!, out.totals!, true);
    return json(await roundView(env, t, n, true));
  }));

  r.post("/api/admin/t/:slug/rounds/:n/reopen", admin(async (ctx) => {
    const { env } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    const round = await getRound(env, t, n);
    if (round.status !== "completed") fail(409, "This round isn't completed.");
    await env.DB.batch([
      env.DB.prepare("UPDATE results SET placement = NULL, team_total = NULL WHERE tournament_id = ? AND round = ?").bind(t.id, n),
      env.DB.prepare("UPDATE rounds SET status = 'scoring', completed_at = NULL WHERE tournament_id = ? AND round = ?").bind(t.id, n),
    ]);
    return json(await roundView(env, t, n, true));
  }));

  // ---------------------------------------------------------------- feedback
  r.get("/api/admin/t/:slug/rounds/:n/feedback", admin(async (ctx) => {
    const { env } = ctx;
    const t = await freshTournament(ctx, false);
    const n = Number(ctx.params.n);
    await getRound(env, t, n);
    const draw = (await loadDraw(env, t, n)) ?? [];
    const raw = await loadFeedback(env, t.id, n);
    const draws = new Map([[n, draw]]);
    const slots = collapseSlots(raw, draws);
    return json({ round: n, rooms: feedbackGrid(draw, raw, slots), min: FEEDBACK_MIN, max: FEEDBACK_MAX });
  }));

  r.put("/api/admin/t/:slug/rounds/:n/feedback", admin(async (ctx) => {
    const { env, req } = ctx;
    const t = await freshTournament(ctx);
    const n = Number(ctx.params.n);
    await getRound(env, t, n);
    const body = await readJson(req);
    const roomName = str(body.room, "room", 80);
    const adjudicator = str(body.adjudicator, "adjudicator", 100);
    const giver = str(body.giver, "giver", 120);
    const draw = (await loadDraw(env, t, n)) ?? [];
    const room = draw.find((x) => x.room === roomName);
    if (!room) fail(400, "That room is not in this round's draw.");
    const slot = roomFeedbackLayout(room!.teams, room!.adjudicators).slots.find(
      (s) => s.adjudicator.toLowerCase() === adjudicator.toLowerCase() && s.giver === giver,
    );
    if (!slot) fail(400, "That feedback slot doesn't exist in this room.");
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare("DELETE FROM feedback WHERE tournament_id = ? AND round = ? AND room = ? AND adjudicator = ? COLLATE NOCASE AND giver = ?").bind(
        t.id,
        n,
        roomName,
        slot!.adjudicator,
        giver,
      ),
    ];
    if (body.score !== null && body.score !== undefined && body.score !== "") {
      const score = num(body.score, "Score", FEEDBACK_MIN, FEEDBACK_MAX);
      stmts.push(
        env.DB.prepare("INSERT INTO feedback (tournament_id, round, room, adjudicator, giver, score, source) VALUES (?, ?, ?, ?, ?, ?, 'admin')").bind(
          t.id,
          n,
          roomName,
          slot!.adjudicator,
          giver,
          score,
        ),
      );
    }
    await env.DB.batch(stmts);
    const raw = await loadFeedback(env, t.id, n);
    return json({ round: n, rooms: feedbackGrid(draw, raw, collapseSlots(raw, new Map([[n, draw]]))) });
  }));

  r.patch("/api/admin/t/:slug/feedback/:id", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    const body = await readJson(ctx.req);
    const res = await ctx.env.DB.prepare("UPDATE feedback SET excluded = ? WHERE id = ? AND tournament_id = ?")
      .bind(bool(body.excluded) ? 1 : 0, int(ctx.params.id, "id"), t.id)
      .run();
    if (!(res.meta as any).changes) fail(404, "That feedback was not found.");
    return json({ ok: true });
  }));

  r.delete("/api/admin/t/:slug/feedback/:id", admin(async (ctx) => {
    const t = await freshTournament(ctx);
    await ctx.env.DB.prepare("DELETE FROM feedback WHERE id = ? AND tournament_id = ?").bind(int(ctx.params.id, "id"), t.id).run();
    return json({ ok: true });
  }));
}

// ---------------------------------------------------------------- helpers

async function writeCompletedRows(
  env: Ctx["env"],
  t: TournamentRow,
  n: number,
  rows: ResultRow[],
  extra: ResultRow[],
  placements: Map<number, number>,
  totals: Map<number, number>,
  advance: boolean,
): Promise<void> {
  // Insert iron-person duplicates directly after the last row of their team, then renumber.
  const ordered = rows.slice();
  for (const e of extra) {
    let idx = -1;
    ordered.forEach((x, i) => {
      if (x.team === e.team) idx = i;
    });
    ordered.splice(idx + 1, 0, e);
  }
  const unique = Array.from(new Set(ordered));
  const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM results WHERE tournament_id = ? AND round = ?").bind(t.id, n)];
  unique.forEach((x, i) => {
    stmts.push(
      resultInsert(env, t.id, { ...x, round: n, placement: placements.get(x.team) ?? null, teamTotal: totals.get(x.team) ?? null }, i),
    );
  });
  stmts.push(env.DB.prepare("UPDATE rounds SET status = 'completed', completed_at = datetime('now') WHERE tournament_id = ? AND round = ?").bind(t.id, n));
  if (advance && n === t.current_round) {
    stmts.push(env.DB.prepare("UPDATE tournaments SET current_round = ? WHERE id = ?").bind(Math.min(n + 1, t.total_rounds + 1), t.id));
  }
  await env.DB.batch(stmts);
}

function validateDraw(t: TournamentRow, draw: any): DrawRoom[] {
  const info = formatInfo(t.format);
  if (!draw || !Array.isArray(draw.rooms) || draw.rooms.length === 0) fail(400, "The draw has no rooms.");
  const rooms: DrawRoom[] = [];
  const roomNames = new Set<string>();
  const speakers = new Set<string>();
  const teamsSeen = new Set<number>();
  for (const rm of draw.rooms) {
    const room = str(rm?.room, "Room name", 40);
    if (roomNames.has(room.toLowerCase())) fail(400, `Room '${room}' appears twice.`);
    roomNames.add(room.toLowerCase());
    if (!Array.isArray(rm.teams) || rm.teams.length !== info.teamsPerRoom) {
      fail(400, `Room ${room} must have exactly ${info.teamsPerRoom} teams.`);
    }
    const positions = new Set<string>();
    const teams = rm.teams.map((tm: any) => {
      const position = str(tm?.position, "Position", 10);
      if (!info.positions.includes(position)) fail(400, `Unknown position '${position}'.`);
      if (positions.has(position)) fail(400, `Room ${room} has two teams in position ${position}.`);
      positions.add(position);
      const team = int(tm.team, "Team number", 1, 9999);
      if (teamsSeen.has(team)) fail(400, `Team ${team} appears twice in the draw.`);
      teamsSeen.add(team);
      if (!Array.isArray(tm.speakers) || tm.speakers.length === 0) fail(400, `Team ${team} has no speakers.`);
      const sp = tm.speakers.map((s: any) => {
        const name = str(s?.name, "Speaker name", 80);
        if (speakers.has(name.toLowerCase())) fail(400, `'${name}' appears twice in the draw.`);
        speakers.add(name.toLowerCase());
        return { name, originalTeam: s.originalTeam === undefined ? team : int(s.originalTeam, "Original team", 1, 9999) };
      });
      return { position, team, merged: bool(tm.merged), speakers: sp };
    });
    const adjudicators = (Array.isArray(rm.adjudicators) ? rm.adjudicators : []).map((a: any) => {
      if (a?.role !== "C" && a?.role !== "P" && a?.role !== "T") fail(400, "Adjudicator role must be C, P or T.");
      return { role: a.role, name: str(a.name, "Adjudicator name", 80) };
    });
    const names = new Set<string>();
    for (const a of adjudicators) {
      if (names.has(a.name.toLowerCase())) fail(400, `${a.name} is on more than one panel in this round.`);
      names.add(a.name.toLowerCase());
    }
    rooms.push({ room, teams, adjudicators });
  }
  // The same adjudicator can't be in two rooms.
  const adjSeen = new Set<string>();
  for (const rm of rooms) {
    for (const a of rm.adjudicators) {
      if (adjSeen.has(a.name.toLowerCase())) fail(400, `${a.name} is in more than one room.`);
      adjSeen.add(a.name.toLowerCase());
    }
  }
  return rooms;
}

export { MAX_ROOMS, resultsView, loadAllDraws, loadDraw };
