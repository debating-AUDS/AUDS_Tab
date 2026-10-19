import { h, get, post, put, del, attempt, confirmDialog, clear, navigate, fmt1, roleName, loading } from './lib.js';
import { tournamentPage, readOnly, statusBadge } from './admin-common.js';
import { placard } from './public-common.js';

const POWER = [['none', 'Random (no power pairing)'], ['strict', 'Strict: pair by rank'], ['broad', 'Broad: pair within bands']];
const clone = (x) => JSON.parse(JSON.stringify(x));

export function roundPage({ params, query }) {
  const n = Number(params.n);
  return tournamentPage(params.slug, '/rounds', async (t) => {
    const ro = readOnly(t);
    const api = `/api/admin/t/${encodeURIComponent(t.slug)}`;
    const tab = ['draw', 'results', 'feedback'].includes(query.tab) ? query.tab : 'draw';
    const base = `#/admin/t/${encodeURIComponent(t.slug)}/round/`;
    const info = t.rounds.find((r) => r.round === n);
    if (!info) return h('div', { class: 'empty' }, h('h3', null, 'No such round'), h('a', { class: 'btn', href: `#/admin/t/${encodeURIComponent(t.slug)}` }, 'Back to overview'));

    const pills = h('nav', { class: 'round-pills', 'aria-label': 'Rounds' },
      t.rounds.map((r) => h('a', { class: 'round-pill', href: `${base}${r.round}?tab=${tab}`, 'aria-current': r.round === n ? 'page' : null }, 'R', r.round,
        h('span', { class: 'dot dot-' + r.status, title: r.status }))));
    const tabs = h('nav', { class: 'tabs sub-tabs', 'aria-label': `Round ${n}` },
      [['draw', 'Draw'], ['results', 'Results'], ['feedback', 'Feedback']].map(([id, label]) =>
        h('a', { class: 'tab', href: `${base}${n}?tab=${id}`, 'aria-current': tab === id ? 'page' : null }, label)));
    const box = h('div', { class: 'round-box' }, loading());
    const head = h('div', { class: 'round-bar' }, pills, h('div', { class: 'round-bar-state' }, h('strong', null, `Round ${n}`), ' ', statusBadge(info)));

    (async () => {
      try {
        if (tab === 'feedback') await feedbackTab(box, api, n, ro);
        else {
          const rv = await get(`${api}/rounds/${n}`);
          const adjs = tab === 'draw' ? (await get(`${api}/adjudicators`)).adjudicators : [];
          if (tab === 'draw') drawTab(box, api, t, n, rv, adjs, ro);
          else resultsTab(box, api, t, n, rv, ro);
        }
      } catch (e) { clear(box).append(h('p', { class: 'error-text' }, e.message)); }
    })();
    return h('div', null, head, tabs, box);
  }, { wide: true });
}

// ----------------------------------------------------------------------------- DRAW
function drawTab(box, api, t, n, rv, adjs, ro) {
  let status = rv.status, published = rv.published;
  let draw = rv.draw ? clone(rv.draw) : null; // { rooms }
  let sel = null; // { kind:'team'|'adj', room, idx }
  let dirty = false;
  const power = h('select', { 'aria-label': 'Power pairing', disabled: ro || n === 1 }, POWER.map(([v, l]) => h('option', { value: v }, l)));

  async function generate(confirm) {
    try {
      const r = await post(`${api}/rounds/${n}/draw`, { power: n === 1 ? 'none' : power.value, confirm });
      applyRound(r); toastOk('Draw generated');
    } catch (e) {
      if (e.code === 'confirm-overwrite') {
        if (await confirmDialog({ title: 'Replace results sheet?', message: e.message, confirmText: 'Generate new draw', danger: true })) return generate(true);
      } else attempt(async () => { throw e; });
    }
  }
  const toastOk = (m) => attempt(async () => true, m);
  function applyRound(r) { status = r.status; published = r.published; draw = r.draw ? clone(r.draw) : null; dirty = false; sel = null; paint(); }

  const unassigned = () => {
    const used = new Set(draw.rooms.flatMap((r) => r.adjudicators.map((a) => a.name.toLowerCase())));
    return adjs.filter((a) => a.attending && !used.has(a.name.toLowerCase()));
  };

  function pick(kind, room, idx) {
    if (ro) return;
    if (sel && sel.kind === kind && sel.room === room && sel.idx === idx) { sel = null; return paint(); }
    if (!sel || sel.kind !== kind) { sel = { kind, room, idx }; return paint(); }
    const a = sel, b = { kind, room, idx };
    sel = null;
    if (kind === 'team') {
      const ta = draw.rooms[a.room].teams, tb = draw.rooms[b.room].teams;
      const x = ta[a.idx], y = tb[b.idx];
      const { position: px } = x, { position: py } = y;
      ta[a.idx] = { ...y, position: px }; tb[b.idx] = { ...x, position: py };
    } else {
      const pa = a.room === 'pool' ? null : draw.rooms[a.room].adjudicators;
      const pb = b.room === 'pool' ? null : draw.rooms[b.room].adjudicators;
      if (!pa && !pb) return paint();
      const pool = unassigned();
      const getAdj = (p, i) => (p ? p[i] : { name: pool[i].name, role: pool[i].trainee ? 'T' : 'P' });
      const x = getAdj(pa, a.idx), y = getAdj(pb, b.idx);
      if (pa) pa[a.idx] = { role: x.role, name: y.name };
      if (pb) pb[b.idx] = { role: y.role, name: x.name };
    }
    dirty = true; paint();
  }

  const chip = (label, active, onclick, cls = '') => h('button', { type: 'button', class: `swap-chip ${cls}${active ? ' is-selected' : ''}`, 'aria-pressed': String(!!active), disabled: ro, onclick }, label);

  function editor() {
    const bp = t.format === 'BP';
    return h('div', { class: 'draw-editor' },
      h('p', { class: 'muted editor-help' }, ro ? '' : 'To change the draw, click one team (or adjudicator) and then another to swap them. Save when you are done.'),
      h('div', { class: 'placards' }, draw.rooms.map((room, ri) => h('article', { class: 'placard edit-placard' + (bp ? ' placard-bp' : '') },
        h('header', { class: 'plate' }, h('h3', { class: 'plate-room' }, room.room),
          h('ul', { class: 'panel-list swap-list' }, room.adjudicators.length ? room.adjudicators.map((a, ai) =>
            h('li', null, h('span', { class: 'role' }, roleName[a.role] || a.role), ' ', chip(a.name, sel && sel.kind === 'adj' && sel.room === ri && sel.idx === ai, () => pick('adj', ri, ai)))) : h('li', { class: 'muted' }, 'No adjudicators'))),
        h('div', { class: 'benches' }, room.teams.map((tm, ti) => {
          const side = bp ? 'bp' : (tm.position === 'Aff' ? 'gov' : 'opp');
          return h('section', { class: `bench bench-${side}` },
            h('header', { class: 'bench-head' }, h('span', { class: 'bench-pos' }, tm.position), h('span', { class: 'bench-team num' }, 'Team ', tm.team)),
            tm.merged ? h('p', { class: 'bench-note' }, 'Merged team') : null,
            h('ul', { class: 'bench-speakers' }, tm.speakers.map((s) => h('li', null, h('span', { class: 'sp-name' }, s.name, s.originalTeam !== tm.team ? h('span', { class: 'sp-tag' }, ` from team ${s.originalTeam}`) : null)))),
            chip(sel && sel.kind === 'team' && sel.room === ri && sel.idx === ti ? 'Selected: now pick another team' : 'Swap this team', sel && sel.kind === 'team' && sel.room === ri && sel.idx === ti, () => pick('team', ri, ti), 'swap-team'));
        }))))),
      (() => {
        const pool = unassigned();
        return h('div', { class: 'panel pool' }, h('h3', null, 'Available adjudicators'),
          pool.length ? h('div', { class: 'chip-row' }, pool.map((a, i) => chip(a.name + (a.trainee ? ' (trainee)' : ''), sel && sel.kind === 'adj' && sel.room === 'pool' && sel.idx === i, () => pick('adj', 'pool', i))))
            : h('p', { class: 'muted' }, 'Everyone attending is on a panel.'));
      })());
  }

  async function save() {
    try {
      const r = await put(`${api}/rounds/${n}/draw`, { draw });
      applyRound(r); toastOk(r.resultsStale ? 'Draw saved. Rebuild the results sheet to match it.' : 'Draw saved');
    } catch (e) { attempt(async () => { throw e; }); }
  }

  function paint() {
    clear(box);
    if (status === 'empty' || !draw) {
      box.append(h('div', { class: 'panel' }, h('h2', null, 'Generate the draw'),
        h('p', null, n === 1 ? 'Round 1 is always drawn at random.' : 'Choose how teams are paired based on the standings so far.'),
        h('div', { class: 'field' }, h('label', null, 'Pairing'), power),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: ro, onclick: () => generate(false) }, 'Generate draw'),
        h('p', { class: 'hint' }, 'The roll must be ticked complete. Generating a draw untick it, so you recheck attendance before the next round.')));
      return;
    }
    const regen = h('div', { class: 'btn-row' },
      n === 1 ? null : power,
      h('button', { class: 'btn', type: 'button', disabled: ro || status === 'completed', onclick: async () => {
        if (!(await confirmDialog({ title: 'Generate a new draw?', message: 'The current draw (and any edits) will be replaced.', confirmText: 'Generate new draw', danger: true }))) return;
        generate(false);
      } }, 'Regenerate'));
    const bar = h('div', { class: 'panel action-bar' },
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', disabled: ro || !dirty, onclick: save }, dirty ? 'Save draw changes' : 'Draw saved'),
        h('button', { class: 'btn' + (published ? '' : ' btn-primary'), type: 'button', disabled: ro || dirty, onclick: async () => {
          const r = await attempt(() => put(`${api}/rounds/${n}/publish`, { published: !published }), published ? 'Draw hidden from the public' : 'Draw published');
          if (r) applyRound(r);
        } }, published ? 'Unpublish draw' : 'Publish draw'),
        h('a', { class: 'btn', href: `#/t/${encodeURIComponent(t.slug)}/round/${n}`, target: '_blank', rel: 'noopener' }, 'Public view')),
      h('p', { class: 'muted' }, published ? 'The draw is public.' : 'The draw is hidden from the public until you publish it.', dirty ? ' You have unsaved changes.' : ''),
      regen,
      h('button', { class: 'btn btn-ghost btn-danger-text', type: 'button', disabled: ro || status === 'completed', onclick: async () => {
        if (!(await confirmDialog({ title: 'Delete this draw?', message: `Round ${n}'s draw and any results sheet will be removed.`, confirmText: 'Delete draw', danger: true }))) return;
        const r = await attempt(() => del(`${api}/rounds/${n}/draw`), 'Draw deleted');
        if (r) applyRound(r);
      } }, 'Delete draw'));
    box.append(bar, editor());
  }
  paint();
}

// --------------------------------------------------------------------------- RESULTS
function resultsTab(box, api, t, n, rv, ro) {
  let status = rv.status, res = rv.results, draw = rv.draw;
  const bp = t.format === 'BP';
  const inputs = new Map(); // id -> { speaker, score }

  const apply = (r) => { status = r.status; res = r.results; draw = r.draw; paint(); };
  const gather = () => [...inputs.entries()].map(([id, f]) => ({ id, speaker: f.speaker ? f.speaker.value : undefined, score: f.score.value === '' ? null : Number(f.score.value) }));

  async function saveOnly(msg = 'Scores saved') { const r = await attempt(() => put(`${api}/rounds/${n}/results`, { rows: gather() }), msg); if (r) apply(r); return !!r; }
  async function complete(allowDuplicateSpeakers = false) {
    try {
      const r1 = await put(`${api}/rounds/${n}/results`, { rows: gather() });
      void r1;
      const r = await post(`${api}/rounds/${n}/complete`, { allowDuplicateSpeakers });
      apply(r); attempt(async () => true, `Round ${n} completed. The leaderboard is updated.`);
    } catch (e) {
      if (e.code === 'confirm-duplicate') { if (await confirmDialog({ title: 'Same speaker twice?', message: e.message, confirmText: 'Continue anyway' })) return complete(true); }
      else attempt(async () => { throw e; });
    }
  }
  async function build(confirm) {
    try { apply(await post(`${api}/rounds/${n}/results/build`, { confirm })); attempt(async () => true, 'Results sheet built'); }
    catch (e) {
      if (e.code === 'confirm-reopen') { if (await confirmDialog({ title: 'Rebuild results sheet?', message: e.message, confirmText: 'Rebuild' })) return build(true); }
      else attempt(async () => { throw e; });
    }
  }

  function paint() {
    clear(box); inputs.clear();
    if (status === 'empty' || !draw) { box.append(h('div', { class: 'empty' }, h('h3', null, 'No draw yet'), h('p', null, 'Generate the draw first.'), h('a', { class: 'btn', href: `#/admin/t/${encodeURIComponent(t.slug)}/round/${n}?tab=draw` }, 'Go to Draw'))); return; }
    if (status === 'drawn' || !res) {
      box.append(h('div', { class: 'panel' }, h('h2', null, 'Results sheet'),
        h('p', null, 'Build the results sheet from the current draw. Do this once the draw is final.'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: ro, onclick: () => build(false) }, 'Build results sheet')));
      return;
    }
    const done = status === 'completed';
    const members = (team) => { for (const r of draw.rooms) for (const tm of r.teams) if (tm.team === team) return tm.speakers.map((s) => s.name); return []; };
    const rooms = res.rooms.map((room) => h('article', { class: 'panel score-room' },
      h('header', { class: 'score-room-head' }, h('h3', null, room.room),
        room.adjudicators.length ? h('span', { class: 'muted' }, room.adjudicators.map((a) => `${roleName[a.role] || a.role}: ${a.name}`).join(' · ')) : null),
      h('div', { class: 'score-teams' }, room.teams.map((tm) => {
        const side = bp ? 'bp' : (tm.position === 'Aff' ? 'gov' : 'opp');
        return h('section', { class: `score-team bench-${side}` },
          h('header', { class: 'bench-head' }, h('span', { class: 'bench-pos' }, tm.position), h('span', { class: 'bench-team num' }, 'Team ', tm.team),
            done ? h('span', { class: 'bench-result' }, bp ? `${tm.placement}` + (['st', 'nd', 'rd', 'th'][tm.placement - 1] || 'th') : (tm.placement === 1 ? 'Won' : 'Lost')) : null,
            done ? h('span', { class: 'num score-total' }, fmt1(tm.teamTotal), ' total') : null),
          tm.rows.map((row) => {
            const score = h('input', { type: 'number', class: 'score-input', min: 50, max: 100, step: 'any', inputmode: 'decimal', value: row.score ?? '', disabled: ro, 'aria-label': `Score for ${row.speaker} in team ${tm.team}` });
            let speaker = null;
            if (row.needsIron) {
              speaker = h('select', { class: row.needsIron ? 'needs-iron' : '', disabled: ro, 'aria-label': `Speaker for team ${tm.team}` },
                h('option', { value: row.speaker }, 'CHOOSE IRON'), members(tm.team).map((m) => h('option', { value: m }, m)));
            }
            inputs.set(row.id, { speaker, score });
            return h('div', { class: 'score-row' }, speaker || h('span', { class: 'sp-name' }, row.speaker, row.originalTeam !== tm.team ? h('span', { class: 'sp-tag' }, ` from team ${row.originalTeam}`) : null), score);
          }));
      }))));
    box.append(
      h('div', { class: 'panel action-bar' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', disabled: ro, onclick: () => saveOnly() }, done ? 'Save changes' : 'Save scores'),
          done ? h('button', { class: 'btn', type: 'button', disabled: ro, onclick: async () => { if (await saveOnly('Saved') ) { const r = await attempt(() => post(`${api}/rounds/${n}/reopen`), 'Round reopened'); if (r) apply(r); } } }, 'Reopen round')
               : h('button', { class: 'btn btn-primary', type: 'button', disabled: ro, onclick: () => complete(false) }, 'Complete round'),
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: ro, onclick: () => build(false) }, 'Rebuild from draw')),
        h('p', { class: 'muted' }, done ? 'Completed. The leaderboard includes this round. Edits to scores update it immediately.' : 'Scores are 50 to 100. Teams of two get a “CHOOSE IRON” row: pick which speaker gives the extra speech. Complete the round when every score is in.')),
      h('div', { class: 'score-grid' }, rooms));
  }
  paint();
}

// --------------------------------------------------------------------------- FEEDBACK
async function feedbackTab(box, api, n, ro) {
  let data = await get(`${api}/rounds/${n}/feedback`);
  function paint() {
    clear(box);
    if (!data.rooms.length) { box.append(h('div', { class: 'empty' }, h('h3', null, 'No draw yet'), h('p', null, 'Feedback is collected per room once the draw exists.'))); return; }
    box.append(h('p', { class: 'muted' }, `Each cell is one adjudicator rated by one person in the room (${data.min} to ${data.max}). Only feedback matching the current draw counts toward adjudicator rankings. Type a score to enter or replace one by hand.`),
      ...data.rooms.map((room) => h('article', { class: 'panel fb-room' },
        h('h3', null, room.room),
        h('table', { class: 'data fb-table' },
          h('thead', null, h('tr', null, ['Adjudicator', 'From', 'Average', 'Submissions', 'Set score'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', null, room.slots.map((s) => {
            const inp = h('input', { type: 'number', class: 'score-input', min: data.min, max: data.max, step: 'any', value: s.avg ?? '', disabled: ro, 'aria-label': `Score for ${s.adjudicator} from ${s.giver}` });
            const set = async (score) => { const r = await attempt(() => put(`${api}/rounds/${n}/feedback`, { room: room.room, adjudicator: s.adjudicator, giver: s.giver, score }), 'Saved'); if (r) { data = r; paint(); } };
            return h('tr', null,
              h('td', null, h('strong', null, s.adjudicator), ' ', h('span', { class: 'muted' }, roleName[s.role] || s.role)),
              h('td', null, s.giver),
              h('td', { class: 'n' }, s.avg === null ? '–' : fmt1(s.avg)),
              h('td', null, s.entries.length ? s.entries.map((e) => h('span', { class: 'fb-entry', title: e.comment || '' }, `${e.score}`, h('small', null, e.source === 'public' ? ' public' : ' admin'), e.comment ? ' 💬' : '',
                h('button', { class: 'linklike', type: 'button', disabled: ro, 'aria-label': 'Delete this submission', onclick: async () => {
                  if (!(await confirmDialog({ title: 'Delete submission?', message: `Delete this ${e.score} from ${s.giver}?${e.comment ? ' Comment: “' + e.comment + '”' : ''}`, confirmText: 'Delete', danger: true }))) return;
                  if (await attempt(() => del(`${api.replace(/\/rounds.*/, '')}/feedback/${e.id}`), 'Deleted')) { data = await get(`${api}/rounds/${n}/feedback`); paint(); }
                } }, '×'))) : h('span', { class: 'muted' }, 'none')),
              h('td', null, h('div', { class: 'btn-row nowrap' }, inp,
                h('button', { class: 'btn btn-sm', type: 'button', disabled: ro, onclick: () => set(inp.value === '' ? null : Number(inp.value)) }, 'Set'),
                s.entries.length ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: ro, onclick: () => set(null) }, 'Clear') : null)));
          }))))));
  }
  paint();
}
