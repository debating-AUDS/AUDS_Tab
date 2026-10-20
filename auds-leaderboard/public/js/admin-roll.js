import { h, get, put, post, patch, del, attempt, toast, confirmDialog, clear } from './lib.js';
import { tournamentPage, readOnly } from './admin-common.js';

function parsePaste(text) {
  const rows = [];
  const bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    const parts = l.includes('\t') ? l.split('\t') : l.split(',');
    const team = Number(String(parts[parts.length - 1]).trim());
    const name = parts.slice(0, -1).join(',').trim();
    if (parts.length < 2 || !name || !Number.isInteger(team) || team < 1) bad.push(i + 1);
    else rows.push({ name, team, present: true });
  });
  return { rows, bad };
}

export function rollPage({ params }) {
  return tournamentPage(params.slug, '/roll', async (t) => {
    const ro = readOnly(t);
    const api = `/api/admin/t/${encodeURIComponent(t.slug)}`;
    let data = await get(api + '/roll');
    let filter = '';

    const tableBox = h('div');
    const sideBox = h('div');
    const redraw = () => { renderTable(); renderSide(); };
    const apply = (d) => { if (d) { data = d; redraw(); } };

    function renderTable() {
      const people = data.roll.filter((p) => !filter || p.name.toLowerCase().includes(filter) || String(p.team) === filter);
      const presentN = data.roll.filter((p) => p.present).length;
      const search = h('input', { type: 'search', placeholder: 'Find a person or team', 'aria-label': 'Find a person or team', value: filter, oninput: (e) => { filter = e.target.value.trim().toLowerCase(); renderTable(); const s = tableBox.querySelector('input[type=search]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
      const body = people.map((p) => {
        const name = h('input', { type: 'text', value: p.name, 'aria-label': `Name of ${p.name}`, disabled: ro, maxlength: 80, onchange: async (e) => {
          const r = await attempt(() => patch(`${api}/roll/${p.id}`, { name: e.target.value }), 'Saved');
          if (r) apply(r); else e.target.value = p.name;
        } });
        const team = h('input', { type: 'number', value: p.team, min: 1, max: 9999, class: 'team-input', 'aria-label': `Team for ${p.name}`, disabled: ro, onchange: async (e) => {
          const r = await attempt(() => patch(`${api}/roll/${p.id}`, { team: Number(e.target.value) }), 'Saved');
          if (r) apply(r); else e.target.value = p.team;
        } });
        const present = h('input', { type: 'checkbox', checked: p.present, disabled: ro, 'aria-label': `${p.name} present`, onchange: async (e) => {
          const r = await attempt(() => patch(`${api}/roll/${p.id}`, { present: e.target.checked }));
          if (r) apply(r); else e.target.checked = !e.target.checked;
        } });
        return h('tr', { class: p.present ? '' : 'absent' },
          h('td', null, name), h('td', null, team), h('td', { class: 'c' }, present),
          h('td', { class: 'c' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: ro, 'aria-label': `Remove ${p.name}`, onclick: async () => {
            if (!(await confirmDialog({ title: 'Remove from roll?', message: `Remove ${p.name} from the roll?`, confirmText: 'Remove', danger: true }))) return;
            apply(await attempt(() => del(`${api}/roll/${p.id}`)));
          } }, 'Remove')));
      });
      const addName = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'New person’s name', maxlength: 80, disabled: ro });
      const addTeam = h('input', { type: 'number', placeholder: 'Team', 'aria-label': 'New person’s team', min: 1, max: 9999, class: 'team-input', disabled: ro });
      const add = h('form', { class: 'add-row', onsubmit: async (e) => {
        e.preventDefault();
        const r = await attempt(() => post(`${api}/roll`, { name: addName.value, team: Number(addTeam.value) }), 'Person added');
        if (r) { apply(r); tableBox.querySelector('.add-row input')?.focus(); }
      } }, addName, addTeam, h('button', { class: 'btn btn-primary', type: 'submit', disabled: ro }, 'Add person'));

      const paste = h('textarea', { rows: 6, placeholder: 'Alice Smith, 1\nBob Jones, 1\nCody Lee, 2', 'aria-label': 'Paste the roll', disabled: ro });
      const doPaste = async (mode) => {
        const { rows, bad } = parsePaste(paste.value);
        if (bad.length) return toast(`Line ${bad.slice(0, 5).join(', ')} needs a name and a team number, separated by a comma or tab.`, 'error');
        if (!rows.length) return toast('Paste at least one line.', 'error');
        if (mode === 'replace' && data.roll.length && !(await confirmDialog({ title: 'Replace the roll?', message: `This replaces all ${data.roll.length} people currently on the roll with ${rows.length} from your paste.`, confirmText: 'Replace roll', danger: true }))) return;
        const all = mode === 'replace' ? rows : [...data.roll.map(({ name, team, present }) => ({ name, team, present })), ...rows];
        const r = await attempt(() => put(`${api}/roll`, { rows: all }), mode === 'replace' ? 'Roll replaced' : `${rows.length} people added`);
        if (r) { paste.value = ''; apply(r); }
      };

      clear(tableBox).append(
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Roll'), h('span', { class: 'muted num' }, `${presentN} present of ${data.roll.length}`)),
          data.roll.length === 0 ? h('div', { class: 'empty' }, h('h3', null, 'The roll is empty'), h('p', null, 'Add people one by one below, or paste a list.')) : [
            search,
            h('div', { class: 'table-wrap roll-table' }, h('table', { class: 'data' },
              h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Team'), h('th', { class: 'c' }, 'Present'), h('th', null))),
              h('tbody', null, body)))],
          add),
        h('div', { class: 'panel' },
          h('h3', null, 'Paste a list'),
          h('p', { class: 'muted' }, 'One person per line: name, then team number, separated by a comma or a tab. Copying two columns from a spreadsheet works.'),
          paste,
          h('div', { class: 'btn-row', style: { marginTop: '.75rem' } },
            h('button', { class: 'btn btn-primary', type: 'button', disabled: ro, onclick: () => doPaste('add') }, 'Add these people'),
            h('button', { class: 'btn', type: 'button', disabled: ro, onclick: () => doPaste('replace') }, 'Replace the whole roll'))));
    }

    function renderSide() {
      const chk = data.check;
      const dec = { solo: { ...data.decisions.solo }, pair: { ...data.decisions.pair } };
      const save = async () => apply(await attempt(() => put(`${api}/roll-decisions`, dec)));
      const yn = (kind, key, current) => h('div', { class: 'yn', role: 'radiogroup', 'aria-label': `Decision for ${key}` },
        ['Y', 'N'].map((v) => h('label', { class: 'yn-opt' }, h('input', { type: 'radio', name: `${kind}-${key}`, value: v, checked: current === v, disabled: ro, onchange: () => { dec[kind][key] = v; save(); } }), h('span', null, v))));

      const complete = h('label', { class: 'check complete-check' },
        h('input', { type: 'checkbox', checked: data.rollComplete, disabled: ro, onchange: async (e) => {
          const r = await attempt(() => put(`${api}/roll-complete`, { complete: e.target.checked }), e.target.checked ? 'Roll marked complete' : 'Roll reopened');
          if (r) apply(r); else e.target.checked = !e.target.checked;
        } }),
        h('span', null, h('strong', null, 'Roll complete'), h('br'), h('span', { class: 'muted' }, 'Tick when attendance is final. This clears itself after each draw, so you confirm attendance again for the next round.')));

      const solos = chk.solos.length ? h('div', null,
        h('h3', null, 'One-person teams'),
        h('p', { class: 'muted' }, 'Y: they iron-person the whole team alone. N: merge them with another short team.'),
        h('ul', { class: 'decide' }, chk.solos.map((s) => h('li', null, h('span', null, h('strong', null, s.name), h('span', { class: 'muted' }, ` · team ${s.team}`)), yn('solo', s.name, s.decision))))) : null;
      const pairs = chk.pairs.length ? h('div', null,
        h('h3', null, 'Two-person teams'),
        h('p', { class: 'muted' }, 'Y: stay as two and iron-person the third position. N: merge with another short team.'),
        h('ul', { class: 'decide' }, chk.pairs.map((p) => h('li', null, h('span', null, h('strong', null, `Team ${p.team}`), h('span', { class: 'muted' }, ` · ${p.members.join(', ')}`)), yn('pair', String(p.team), p.decision))))) : null;

      const summary = chk.expectedTeams !== null
        ? h('p', { class: 'check-summary' + (chk.divisible ? ' ok' : ' bad') },
            `${chk.expectedTeams} teams`, chk.divisible ? ` → ${chk.expectedTeams / chk.teamsPerRoom} rooms` : ` is not divisible by ${chk.teamsPerRoom}`)
        : h('p', { class: 'muted' }, chk.solos.length || chk.pairs.length ? 'Answer every Y/N question to see how many teams the draw will have.' : '');

      clear(sideBox).append(
        h('div', { class: 'panel' }, complete),
        h('div', { class: 'panel' },
          h('h2', null, 'Roll check'),
          h('p', { class: 'muted' }, `${chk.attending} people present in ${chk.normalTeams.length + chk.solos.length + chk.pairs.length} teams.`),
          solos, pairs,
          !chk.solos.length && !chk.pairs.length ? h('p', null, 'Every present team is full size. No decisions needed.') : null,
          summary,
          chk.problems.map((p) => h('div', { class: 'notice notice-bad' }, p)),
          chk.swingTeams.length ? h('p', { class: 'muted' }, `Swing teams (numbers above 100): ${chk.swingTeams.join(', ')}. They always go in the lowest room. Add one to make the team count divisible.`) : h('p', { class: 'muted' }, 'To make the team count divisible, add a swing team numbered above 100.')));
    }

    redraw();
    return h('div', { class: 'roll-grid' }, tableBox, sideBox);
  });
}
