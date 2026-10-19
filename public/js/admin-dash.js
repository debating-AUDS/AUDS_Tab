import { h, get, post, patch, del, put, attempt, toast, confirmDialog, navigate, fmtDate, state } from './lib.js';
import { tournamentPage, readOnly, statusBadge, field } from './admin-common.js';

const DEFAULT_ROOMS = ['LG29', 'LG28', 'LG24', 'LG21', 'LG18', 'LG16'];

export async function dashboard() {
  const { tournaments } = await get('/api/admin/tournaments');
  const active = tournaments.find((t) => t.status === 'active');
  const list = h('div', { class: 'panel' },
    h('h2', null, 'Tournaments'),
    tournaments.length === 0
      ? h('div', { class: 'empty' }, h('h3', null, 'No tournaments yet'), h('p', null, 'Create your first one below. You will add the roll and adjudicators next.'))
      : h('ul', { class: 'tlist' }, tournaments.map((t) => h('li', null,
          h('a', { class: 'tlist-name', href: `#/admin/t/${encodeURIComponent(t.slug)}` }, t.name),
          h('span', { class: 'muted' }, `${t.format} · ${t.totalRounds} rounds · ${t.status === 'active' ? 'round ' + Math.min(t.currentRound, t.totalRounds) + ' next' : 'archived ' + fmtDate(t.archivedAt)}`),
          h('span', { class: 'badge ' + (t.status === 'active' ? '' : 'badge-quiet') }, t.status === 'active' ? 'Active' : 'Archived')))));

  const name = h('input', { type: 'text', required: true, placeholder: 'AUDS Spring Cup 2026', maxlength: 100 });
  const format = h('select', null, h('option', { value: '3v3' }, '3v3 (Aff / Neg, teams of 3)'), h('option', { value: 'BP' }, 'BP (OG / OO / CG / CO, teams of 2)'));
  const rounds = h('input', { type: 'number', min: 1, max: 20, value: 5, required: true });
  const weight = h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: 0.1 });
  const rooms = h('input', { type: 'text', value: DEFAULT_ROOMS.join(', ') });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    err.replaceChildren();
    try {
      const r = await post('/api/admin/tournaments', {
        name: name.value, format: format.value, totalRounds: Number(rounds.value), weightK: Number(weight.value),
        rooms: rooms.value.split(',').map((x) => x.trim()).filter(Boolean),
      });
      toast('Tournament created');
      navigate(`/admin/t/${r.tournament.slug}/roll`);
    } catch (ex) {
      err.append(ex.message, ' ');
      if (ex.code === 'active-exists' && active) err.append(h('a', { href: `#/admin/t/${encodeURIComponent(active.slug)}/settings` }, 'Go to the active tournament to archive it'));
    }
  } },
    h('h2', null, 'New tournament'),
    active ? h('div', { class: 'notice' }, h('strong', null, active.name), ' is still active. Archive it from its Settings page before starting another.') : null,
    field('Name', name),
    h('div', { class: 'field-row' },
      field('Format', format, 'Fixed for the life of the tournament.'),
      field('Number of rounds', rounds)),
    field('Weighting parameter', weight, 'How much a speaker’s score relative to their teammates shifts their share of the team’s points. 0.1 is the usual setting; 0 splits points equally.'),
    field('Room names, in priority order', rooms, 'Separate with commas. Extra rooms are named Room 1, Room 2 and so on (up to 10 rooms).'),
    err,
    h('button', { class: 'btn btn-primary', type: 'submit', disabled: !!active }, 'Create tournament'));

  const help = h('div', { class: 'panel help' },
    h('h2', null, 'How a tournament runs'),
    h('ol', null,
      h('li', null, h('strong', null, 'Roll. '), 'Add speakers and team numbers, mark who is present, answer the Y/N questions for short teams, then tick Roll complete.'),
      h('li', null, h('strong', null, 'Adjudicators. '), 'Mark who is attending. Their feedback history from earlier tournaments is kept.'),
      h('li', null, h('strong', null, 'Draw. '), 'Generate the draw for a round, adjust it by hand if needed, then publish it so everyone can see it.'),
      h('li', null, h('strong', null, 'Results. '), 'Build the results sheet, enter scores, then complete the round. The leaderboard updates straight away.'),
      h('li', null, h('strong', null, 'Feedback. '), 'Debaters and adjudicators submit feedback from the public site. You can see and adjust it per round.'),
      h('li', null, h('strong', null, 'Archive. '), 'When the tournament ends, archive it. It stays viewable on the public archive.')));

  return h('div', { class: 'page admin-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Admin')),
    h('div', { class: 'dash-grid' }, h('div', null, list, help), form));
}

const NEXT = {
  empty: (r, t) => ({ label: 'Generate draw', tab: 'draw' }),
  drawn: (r) => (r.published ? { label: 'Build results sheet', tab: 'results' } : { label: 'Review and publish draw', tab: 'draw' }),
  scoring: () => ({ label: 'Enter scores', tab: 'results' }),
  completed: () => ({ label: 'View results', tab: 'results' }),
};

export function overview({ params }) {
  return tournamentPage(params.slug, '', async (t) => {
    const slug = encodeURIComponent(t.slug);
    const base = `#/admin/t/${slug}`;
    const c = t.counts;
    const nextRound = t.rounds.find((r) => r.status !== 'completed');
    const checklist = h('ul', { class: 'checklist' },
      h('li', { class: c.roll > 0 ? 'done' : '' }, h('a', { href: base + '/roll' }, c.roll > 0 ? `${c.present} of ${c.roll} people present on the roll` : 'Add the roll')),
      h('li', { class: t.rollComplete ? 'done' : '' }, h('a', { href: base + '/roll' }, t.rollComplete ? 'Roll marked complete' : 'Tick Roll complete before generating a draw')),
      h('li', { class: c.adjudicatorsAttending > 0 ? 'done' : '' }, h('a', { href: base + '/adjudicators' }, c.adjudicatorsAttending > 0 ? `${c.adjudicatorsAttending} adjudicators attending` : 'Mark adjudicators as attending')));
    const rows = t.rounds.map((r) => {
      const n = NEXT[r.status](r, t);
      return h('li', { class: 'round-step round-' + r.status },
        h('span', { class: 'round-no' }, 'Round ', r.round),
        statusBadge(r),
        r.status !== 'empty' ? h('span', { class: 'badge ' + (r.published ? '' : 'badge-quiet') }, r.published ? 'Draw published' : 'Draw hidden') : null,
        h('a', { class: 'btn btn-sm' + (nextRound && nextRound.round === r.round ? ' btn-primary' : ''), href: `${base}/round/${r.round}?tab=${n.tab}` }, n.label));
    });
    return h('div', null,
      h('div', { class: 'panel' }, h('h2', null, 'Setup'), checklist),
      h('div', { class: 'panel' }, h('h2', null, 'Rounds'), h('ol', { class: 'round-steps' }, rows)));
  });
}

export function settings({ params }) {
  return tournamentPage(params.slug, '/settings', async (t) => {
    const ro = readOnly(t);
    const name = h('input', { type: 'text', value: t.name, disabled: ro });
    const weight = h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: t.weightK, disabled: ro });
    const rooms = h('input', { type: 'text', value: t.rooms.join(', '), disabled: ro });
    const nr = h('input', { type: 'number', min: 1, max: 20, value: t.totalRounds, disabled: ro });
    const form = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const ok = await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, {
        name: name.value, weightK: Number(weight.value), totalRounds: Number(nr.value),
        rooms: rooms.value.split(',').map((x) => x.trim()).filter(Boolean),
      }), 'Settings saved');
      if (ok) document.dispatchEvent(new CustomEvent('rerender'));
    } },
      h('h2', null, 'Tournament settings'),
      field('Name', name),
      h('div', { class: 'field-row' }, field('Number of rounds', nr, 'Rounds that already have a draw can’t be removed.'), field('Weighting parameter', weight, 'Changing this recalculates every speaker’s weighted contribution straight away.')),
      field('Room names, in priority order', rooms, 'Applies to draws you generate from now on.'),
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: ro }, 'Save settings'));

    const open = h('input', { type: 'checkbox', checked: t.feedbackOpen, disabled: ro });
    const code = h('input', { type: 'text', value: t.feedbackCode || '', disabled: ro, maxlength: 40 });
    const fb = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const ok = await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, { feedbackOpen: open.checked, feedbackCode: code.value.trim() || null }), 'Feedback settings saved');
      if (ok) document.dispatchEvent(new CustomEvent('rerender'));
    } },
      h('h2', null, 'Feedback form'),
      h('label', { class: 'check field' }, open, h('span', null, 'Accept feedback from the public site')),
      field('Feedback code (optional)', code, 'If set, people must enter this code to submit feedback. Print it on the venue signage to keep out spam.'),
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: ro }, 'Save feedback settings'));

    const archive = h('div', { class: 'panel' },
      h('h2', null, 'Archive tournament'),
      h('p', null, 'Archiving freezes this tournament so it can no longer be edited, adds it to the public archive, and carries each adjudicator’s feedback history forward into future tournaments. You can’t undo this.'),
      h('button', { class: 'btn', type: 'button', disabled: ro, onclick: async () => {
        if (!(await confirmDialog({ title: 'Archive this tournament?', message: `“${t.name}” will become read-only and move to the public archive. Adjudicator feedback will be added to their history.`, confirmText: 'Archive tournament' }))) return;
        if (await attempt(() => post(`/api/admin/t/${encodeURIComponent(t.slug)}/archive`), 'Tournament archived')) document.dispatchEvent(new CustomEvent('rerender'));
      } }, 'Archive tournament'));

    const exp = h('div', { class: 'panel' },
      h('h2', null, 'Export'),
      h('p', null, 'Download everything in this tournament (roll, draws, results and feedback) as a JSON file for your records.'),
      h('a', { class: 'btn', href: `/api/admin/t/${encodeURIComponent(t.slug)}/export`, download: `${t.slug}-export.json` }, 'Export JSON'));

    const confirmInput = h('input', { type: 'text', placeholder: t.slug, autocomplete: 'off' });
    const delBtn = h('button', { class: 'btn btn-danger', type: 'button', disabled: true, onclick: async () => {
      if (await attempt(() => del(`/api/admin/t/${encodeURIComponent(t.slug)}`, { confirm: t.slug }), 'Tournament deleted')) navigate('/admin');
    } }, 'Delete tournament');
    confirmInput.addEventListener('input', () => { delBtn.disabled = confirmInput.value !== t.slug; });
    const danger = h('div', { class: 'panel panel-danger' },
      h('h2', null, 'Delete tournament'),
      h('p', null, 'Permanently deletes the roll, draws, results and feedback. Archive instead if you want to keep a record. Type ', h('code', null, t.slug), ' to confirm.'),
      h('div', { class: 'field' }, confirmInput), delBtn);

    return h('div', { class: 'settings-grid' }, form, fb, exp, archive, danger);
  });
}

export function feedbackIndex({ params }) {
  return tournamentPage(params.slug, '/feedback', async (t) => {
    const ro = readOnly(t);
    const open = h('input', { type: 'checkbox', checked: t.feedbackOpen, disabled: ro, onchange: async (e) => {
      const r = await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, { feedbackOpen: e.target.checked }), e.target.checked ? 'Feedback opened' : 'Feedback closed');
      if (!r) e.target.checked = !e.target.checked;
    } });
    const code = h('input', { type: 'text', value: t.feedbackCode || '', disabled: ro, maxlength: 40 });
    return h('div', null,
      h('div', { class: 'panel' },
        h('h2', null, 'Feedback form'),
        h('label', { class: 'check field' }, open, h('span', null, 'Accept feedback from the public site')),
        h('div', { class: 'field' }, h('label', null, 'Feedback code (optional)'), code, h('span', { class: 'hint' }, 'People must enter this code to submit. Leave empty for an open form.')),
        h('button', { class: 'btn', type: 'button', disabled: ro, onclick: () => attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, { feedbackCode: code.value.trim() || null }), 'Feedback code saved') }, 'Save code'),
        h('p', { class: 'muted', style: { marginTop: '1rem' } }, 'Share this link at the venue: ', h('code', null, `${location.origin}/#/t/${t.slug}/feedback`))),
      h('div', { class: 'panel' },
        h('h2', null, 'Feedback by round'),
        h('div', { class: 'btn-row' }, t.rounds.map((r) => h('a', { class: 'btn', href: `#/admin/t/${encodeURIComponent(t.slug)}/round/${r.round}?tab=feedback` }, `Round ${r.round}`, r.status === 'empty' ? ' (no draw)' : '')))));
  });
}
