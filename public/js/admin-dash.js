import { h, get, post, patch, del, put, attempt, toast, confirmDialog, openDialog, navigate, fmtDate, state } from './lib.js';
import { tournamentPage, readOnly, statusBadge, field } from './admin-common.js';
import { readImportFile } from './xlsx-read.js';
import { TEAM_CRITERIA, SPEAKER_CRITERIA, DEFAULT_TEAM_RANK, DEFAULT_SPEAKER_RANK, rankingEditor } from './ranking.js';

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
  const minDebates = h('input', { type: 'number', min: 1, max: 20, value: 3 });
  const teamEd = rankingEditor(TEAM_CRITERIA, DEFAULT_TEAM_RANK);
  const spEd = rankingEditor(SPEAKER_CRITERIA, DEFAULT_SPEAKER_RANK);
  const err = h('p', { class: 'error-text', role: 'alert' });
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    err.replaceChildren();
    try {
      const r = await post('/api/admin/tournaments', {
        minDebates: Number(minDebates.value), teamRank: teamEd.get(), speakerRank: spEd.get(),
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
    h('details', { class: 'rules-details' },
      h('summary', null, 'Leaderboard rules (optional, can be changed later)'),
      field('Debates needed to be break eligible', minDebates, 'Applies to teams and to speakers.'),
      h('div', { class: 'field' }, h('label', null, 'Rank teams by'), teamEd.el),
      h('div', { class: 'field' }, h('label', null, 'Rank speakers by'), spEd.el)),
    err,
    h('button', { class: 'btn btn-primary', type: 'submit', disabled: !!active }, 'Create tournament'));

  const help = h('div', { class: 'panel help' },
    h('h2', null, 'How a tournament runs'),
    h('ol', null,
      h('li', null, h('strong', null, 'Roll. '), 'Add speakers and team numbers, mark who is present, answer the Y/N questions for short teams, then tick Roll complete.'),
      h('li', null, h('strong', null, 'Adjudicators. '), 'Mark who is attending. Each tournament starts with fresh adjudicator scores.'),
      h('li', null, h('strong', null, 'Draw. '), 'Generate the draw for a round, adjust it by hand if needed, then publish it so everyone can see it.'),
      h('li', null, h('strong', null, 'Results. '), 'Build the results sheet, enter scores, then complete the round. The leaderboard updates straight away.'),
      h('li', null, h('strong', null, 'Feedback. '), 'Debaters and adjudicators submit feedback from the public site. You can see and adjust it per round.'),
      h('li', null, h('strong', null, 'Archive. '), 'When the tournament ends, archive it. It stays viewable on the public archive.')));

  return h('div', { class: 'page admin-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Admin')),
    h('div', { class: 'dash-grid' }, h('div', null, list, archiveManager(tournaments), help), h('div', null, form, importPanel(active))));
}

/** Create a tournament from an earlier JSON or Excel export. */
function importPanel(active) {
  const file = h('input', { type: 'file', accept: '.json,.xlsx,.xlsm,application/json', 'aria-label': 'Tournament file' });
  const as = h('select', null,
    h('option', { value: 'archive' }, 'Add it to the archive (finished tournament)'),
    h('option', { value: 'keep', disabled: !!active }, 'Keep its status (active tournaments stay active)'));
  const msg = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Import tournament');
  return h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren(); msg.className = 'error-text';
    if (!file.files[0]) { msg.textContent = 'Choose a file first.'; return; }
    btn.disabled = true;
    try {
      const data = await readImportFile(file.files[0]);
      const r = await post('/api/admin/import', { data, as: as.value });
      toast(`Imported “${r.name}”`);
      navigate(`/admin/t/${r.slug}`);
    } catch (ex) { msg.textContent = ex.message || 'The import failed.'; } finally { btn.disabled = false; }
  } },
    h('h2', null, 'Import a past tournament'),
    h('p', { class: 'muted' }, 'Upload a JSON or Excel file made with “Download JSON” or “Download Excel” from a tournament’s Settings page. The roll, adjudicators, draws, results and feedback all come across.'),
    field('File', file, 'Excel files need the sheets Setup, Roll, Adjudicators, Round 1…N and Feedback, as downloaded. The original macro spreadsheet’s layout isn’t supported.'),
    field('Import as', as),
    msg, btn);
}

/** Reorder archived tournaments and edit the date shown for each. */
function archiveManager(tournaments) {
  const items = tournaments.filter((t) => t.status === 'archived');
  if (items.length === 0) return null;
  const box = h('div', { class: 'panel' });
  const iso = (t) => { const d = t.archivedAt || t.createdAt || ''; return d.slice(0, 10); };
  function paint() {
    box.replaceChildren(
      h('h2', null, 'Archive order and dates'),
      h('p', { class: 'muted' }, 'This is the order the public archive lists past tournaments in. The date is the one shown beside each name.'),
      h('ol', { class: 'arch-list' }, items.map((t, i) => {
        const date = h('input', { type: 'date', value: iso(t), 'aria-label': 'Date for ' + t.name });
        const move = async (d) => {
          const j = i + d; if (j < 0 || j >= items.length) return;
          [items[i], items[j]] = [items[j], items[i]];
          if (await attempt(() => put('/api/admin/archive-order', { slugs: items.map((x) => x.slug) }), 'Order saved')) paint(); else { [items[i], items[j]] = [items[j], items[i]]; }
        };
        return h('li', null,
          h('span', { class: 'arch-name' }, t.name),
          date,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (!date.value) return; if (await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}/archive-date`, { date: date.value }), 'Date saved')) t.archivedAt = date.value + ' 12:00:00'; } }, 'Save date'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: i === 0, 'aria-label': 'Move ' + t.name + ' up', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: i === items.length - 1, 'aria-label': 'Move ' + t.name + ' down', onclick: () => move(1) }, '↓'));
      })));
  }
  paint();
  return box;
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
        h('span', { class: 'round-no' }, r.name),
        statusBadge(r),
        r.status !== 'empty' ? h('span', { class: 'badge ' + (r.published ? '' : 'badge-quiet') }, r.published ? 'Draw published' : 'Draw hidden') : null,
        h('a', { class: 'btn btn-sm' + (nextRound && nextRound.round === r.round ? ' btn-primary' : ''), href: `${base}/round/${r.round}?tab=${n.tab}` }, n.label));
    });
    return h('div', null,
      h('div', { class: 'panel' }, h('h2', null, 'Setup'), checklist),
      h('div', { class: 'panel' }, h('h2', null, 'Rounds'), h('ol', { class: 'round-steps' }, rows)));
  });
}

/** Asks whether there was a winner. Resolves to the winners text ('' for none) or undefined if cancelled. */
async function archiveDialog(t) {
  let teams = [];
  try { teams = (await get(`/api/public/t/${encodeURIComponent(t.slug)}/leaderboard`)).leaderboard.teams; } catch { /* manual entry still works */ }
  return openDialog('Archive this tournament?', (close) => {
    const yes = h('input', { type: 'radio', name: 'winner', value: 'yes' });
    const no = h('input', { type: 'radio', name: 'winner', value: 'no', checked: true });
    const text = h('input', { type: 'text', maxlength: 300, placeholder: 'e.g. Alice, Bob and Cody', 'aria-label': 'Winners' });
    const pick = h('select', { 'aria-label': 'Pick the winners from the standings', onchange: (e) => { if (e.target.value) text.value = e.target.value; } },
      h('option', { value: '' }, teams.length ? 'Pick from the final standings…' : 'No results yet, type the names below'),
      teams.slice(0, 20).map((x) => h('option', { value: x.members }, `${x.rank}. ${x.members}`)));
    const box = h('div', { class: 'field winner-box', hidden: true }, pick, text);
    const sync = () => { box.hidden = !yes.checked; if (yes.checked) text.focus(); };
    yes.addEventListener('change', sync); no.addEventListener('change', sync);
    const err = h('p', { class: 'error-text', role: 'alert' });
    return h('div', { class: 'dialog-body' },
      h('p', null, `“${t.name}” will become read-only and move to the public archive.`),
      h('fieldset', { class: 'winner-q' }, h('legend', null, 'Was there a tournament winner?'),
        h('label', { class: 'check' }, no, h('span', null, 'No winner')),
        h('label', { class: 'check' }, yes, h('span', null, 'Yes'))),
      box, err,
      h('p', { class: 'hint' }, 'If you name winners, “Tournament Winners” replaces the top break-eligible teams list on the leaderboard.'),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => close(undefined) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
          if (yes.checked && !text.value.trim()) { err.textContent = 'Enter the winners’ names, or choose “No winner”.'; return; }
          close(yes.checked ? text.value.trim() : '');
        } }, 'Archive tournament')));
  });
}

export function settings({ params }) {
  return tournamentPage(params.slug, '/settings', async (t) => {
    const ro = readOnly(t);
    const name = h('input', { type: 'text', value: t.name, disabled: ro });
    const weight = h('input', { type: 'number', min: 0, max: 10, step: 0.05, value: t.weightK, disabled: ro });
    const rooms = h('input', { type: 'text', value: t.rooms.join(', '), disabled: ro });
    const nr = h('input', { type: 'number', min: 1, max: 20, value: t.totalRounds, disabled: ro });
    const topN = h('input', { type: 'number', min: 0, max: 50, value: t.topCount, disabled: ro });
    const form = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const ok = await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, {
        name: name.value, weightK: Number(weight.value), totalRounds: Number(nr.value), topCount: Number(topN.value),
        rooms: rooms.value.split(',').map((x) => x.trim()).filter(Boolean),
      }), 'Settings saved');
      if (ok) document.dispatchEvent(new CustomEvent('rerender'));
    } },
      h('h2', null, 'Tournament settings'),
      field('Name', name),
      h('div', { class: 'field-row' }, field('Number of rounds', nr, 'Add a round to make room for finals, then name it from its round page. Rounds that already have a draw can’t be removed.'), field('Weighting parameter', weight, 'Changing this recalculates every speaker’s weighted contribution straight away.')),
      field('Room names, in priority order', rooms, 'Applies to draws you generate from now on.'),
      field('Top break-eligible teams to show', topN, 'How many teams appear in the highlighted list above the team leaderboard. 0 hides it. Only break-eligible teams are listed (see Leaderboard rules).'),
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: ro }, 'Save settings'));

    const minD = h('input', { type: 'number', min: 1, max: 20, value: t.minDebates, disabled: ro });
    const teamEd = rankingEditor(TEAM_CRITERIA, t.teamRank, ro);
    const spEd = rankingEditor(SPEAKER_CRITERIA, t.speakerRank, ro);
    const rules = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      let teamRank, speakerRank;
      try { teamRank = teamEd.get(); speakerRank = spEd.get(); } catch (ex) { toast(ex.message, 'error'); return; }
      const ok = await attempt(() => patch(`/api/admin/t/${encodeURIComponent(t.slug)}`, { minDebates: Number(minD.value), teamRank, speakerRank }), 'Leaderboard rules saved');
      if (ok) document.dispatchEvent(new CustomEvent('rerender'));
    } },
      h('h2', null, 'Leaderboard rules'),
      field('Debates needed to be break eligible', minD, 'A team needs this many debates, and a speaker this many scored performances. Teams below it are listed under the eligible ones.'),
      h('div', { class: 'field' }, h('label', null, 'Rank teams by'), teamEd.el, h('span', { class: 'hint' }, 'Teams that are not yet eligible always rank below eligible ones. Ties on every chosen criterion are ordered alphabetically.')),
      h('div', { class: 'field' }, h('label', null, 'Rank speakers by'), spEd.el),
      h('button', { class: 'btn btn-primary', type: 'submit', disabled: ro }, 'Save leaderboard rules'));

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
      h('p', null, 'Archiving freezes this tournament so it can no longer be edited and adds it to the public archive. Adjudicator names stay on the list, but their scores do not carry over to the next tournament. You can’t undo this.'),
      h('button', { class: 'btn', type: 'button', disabled: ro, onclick: async () => {
        const winners = await archiveDialog(t);
        if (winners === undefined) return;
        if (await attempt(() => post(`/api/admin/t/${encodeURIComponent(t.slug)}/archive`, { winners }), 'Tournament archived')) document.dispatchEvent(new CustomEvent('rerender'));
      } }, 'Archive tournament'));

    const exp = h('div', { class: 'panel' },
      h('h2', null, 'Export'),
      h('p', null, 'Download everything in this tournament. The Excel file has the sheets Setup, Leaderboard, Adjudicators, Roll, one per round, and Feedback. Both formats can be uploaded again when creating a tournament.'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary', href: `/api/admin/t/${encodeURIComponent(t.slug)}/export.xlsx`, download: `${t.slug}.xlsx` }, 'Download Excel'),
        h('a', { class: 'btn', href: `/api/admin/t/${encodeURIComponent(t.slug)}/export`, download: `${t.slug}-export.json` }, 'Download JSON')));

    const confirmInput = h('input', { type: 'text', placeholder: t.slug, autocomplete: 'off' });
    const delBtn = h('button', { class: 'btn btn-danger', type: 'button', disabled: true, onclick: async () => {
      if (await attempt(() => del(`/api/admin/t/${encodeURIComponent(t.slug)}`, { confirm: t.slug }), 'Tournament deleted')) navigate('/admin');
    } }, 'Delete tournament');
    confirmInput.addEventListener('input', () => { delBtn.disabled = confirmInput.value !== t.slug; });
    const danger = h('div', { class: 'panel panel-danger' },
      h('h2', null, 'Delete tournament'),
      h('p', null, 'Permanently deletes the roll, draws, results and feedback. Archive instead if you want to keep a record. Type ', h('code', null, t.slug), ' to confirm.'),
      h('div', { class: 'field' }, confirmInput), delBtn);

    return h('div', { class: 'settings-grid' }, form, rules, fb, exp, archive, danger);
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
        h('div', { class: 'btn-row' }, t.rounds.map((r) => h('a', { class: 'btn', href: `#/admin/t/${encodeURIComponent(t.slug)}/round/${r.round}?tab=feedback` }, r.name, r.status === 'empty' ? ' (no draw)' : '')))));
  });
}
