import { h, get, post, patch, del, attempt, confirmDialog, openDialog, clear, fmt2, fmt1 } from './lib.js';
import { tournamentPage, readOnly } from './admin-common.js';

export function adjudicatorsPage({ params }) {
  return tournamentPage(params.slug, '/adjudicators', async (t) => {
    const ro = readOnly(t);
    const api = `/api/admin/t/${encodeURIComponent(t.slug)}/adjudicators`;
    let list = (await get(api)).adjudicators;
    const box = h('div');
    const apply = (r) => { if (r) { list = r.adjudicators; render(); } };

    function render() {
      const attending = list.filter((a) => a.attending);
      const chairs = attending.filter((a) => !a.trainee).length;
      const rows = list.map((a) => {
        const tg = (field, label) => h('input', { type: 'checkbox', checked: a[field], disabled: ro, 'aria-label': `${a.name} ${label}`, onchange: async (e) => {
          const r = await attempt(() => patch(`${api}/${a.id}`, { [field]: e.target.checked }));
          if (r) apply(r); else e.target.checked = !e.target.checked;
        } });
        return h('tr', { class: a.attending ? '' : 'absent' },
          h('td', null, h('strong', null, a.name)),
          h('td', { class: 'c' }, tg('attending', 'attending')),
          h('td', { class: 'c' }, tg('trainee', 'is a trainee')),
          h('td', { class: 'n' }, fmt2(a.avg)), h('td', { class: 'n' }, a.count), h('td', { class: 'n' }, fmt2(a.sd)),
          h('td', { class: 'n' }, fmt1(a.confidence)), h('td', { class: 'n' }, fmt2(a.rankingScore)),
          h('td', { class: 'n' }, a.thisTournament.count ? `${a.thisTournament.count} (${fmt2(a.thisTournament.avg)})` : '–'),
          h('td', null, h('div', { class: 'btn-row nowrap' },
            h('button', { class: 'btn btn-sm', type: 'button', disabled: ro, onclick: () => editDialog(a) }, 'Edit'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: ro, 'aria-label': `Remove ${a.name}`, onclick: async () => {
              if (!(await confirmDialog({ title: 'Remove adjudicator?', message: `Remove ${a.name} from the adjudicator list? Their history from earlier tournaments is lost.`, confirmText: 'Remove', danger: true }))) return;
              apply(await attempt(() => del(`${api}/${a.id}`)));
            } }, 'Remove'))));
      });

      clear(box).append(
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Adjudicators'),
            h('span', { class: 'muted num' }, `${attending.length} attending · ${chairs} can chair or panel`)),
          h('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
            h('button', { class: 'btn btn-sm', type: 'button', disabled: ro, onclick: async () => apply(await attempt(() => post(`${api}/mark-all`, { attending: true }))) }, 'Mark all attending'),
            h('button', { class: 'btn btn-sm', type: 'button', disabled: ro, onclick: async () => apply(await attempt(() => post(`${api}/mark-all`, { attending: false }))) }, 'Mark none attending'),
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: ro, onclick: () => editDialog(null) }, 'Add adjudicator')),
          list.length === 0 ? h('div', { class: 'empty' }, h('h3', null, 'No adjudicators yet'), h('p', null, 'Add the adjudicators for this tournament. They stay on the list for future tournaments.')) :
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, ['Name', 'Attending', 'Trainee', 'Avg score', 'No. feedback', 'Std dev', 'Start confidence', 'Ranking score', 'This tournament', ''].map((x, i) => h('th', { class: i >= 3 && i <= 8 ? 'n' : i === 1 || i === 2 ? 'c' : '' }, x)))),
            h('tbody', null, rows)))),
        h('div', { class: 'panel help' },
          h('h3', null, 'How the numbers work'),
          h('p', null, h('strong', null, 'Avg score, No. feedback and Std dev '), 'combine each adjudicator’s history from earlier tournaments with the feedback scored in completed rounds of this one.'),
          h('p', null, h('strong', null, 'Start confidence '), '(0 to 100) only matters for adjudicators with no feedback yet. Their starting average is treated as a guess, and confidence says how much to trust it.'),
          h('p', null, h('strong', null, 'Ranking score '), 'is the cautious estimate used to pick chairs. The best-ranked attending adjudicators chair, the next panel, and trainees are spread randomly.')));
    }

    function editDialog(a) {
      const f = {
        name: h('input', { type: 'text', value: a ? a.name : '', maxlength: 80, required: true }),
        avg: h('input', { type: 'number', step: 0.01, min: 0, max: 10, value: a && a.baseline.avg !== null ? a.baseline.avg : '' }),
        count: h('input', { type: 'number', min: 0, step: 1, value: a ? a.baseline.count : 0 }),
        sd: h('input', { type: 'number', step: 0.01, min: 0, max: 10, value: a && a.baseline.sd !== null ? a.baseline.sd : '' }),
        conf: h('input', { type: 'number', min: 0, max: 100, value: a ? a.confidence : 50 }),
        trainee: h('input', { type: 'checkbox', checked: a ? a.trainee : false }),
      };
      const lab = (txt, el, hint) => h('div', { class: 'field' }, h('label', null, txt), el, hint ? h('span', { class: 'hint' }, hint) : null);
      return openDialog(a ? `Edit ${a.name}` : 'Add adjudicator', (close) => h('form', { class: 'dialog-body', onsubmit: async (e) => {
        e.preventDefault();
        const body = { name: f.name.value, trainee: f.trainee.checked, confidence: Number(f.conf.value),
          baseAvg: f.avg.value === '' ? null : Number(f.avg.value), baseCount: Number(f.count.value || 0), baseSd: f.sd.value === '' ? null : Number(f.sd.value) };
        const r = await attempt(() => (a ? patch(`${api}/${a.id}`, body) : post(api, body)), a ? 'Saved' : 'Adjudicator added');
        if (r) { apply(r); close(true); }
      } },
        lab('Name', f.name),
        h('label', { class: 'check field' }, f.trainee, h('span', null, 'Trainee (can’t chair or panel)')),
        h('p', { class: 'muted' }, 'History from earlier tournaments. Leave the number of feedback at 0 if the average is only your own estimate.'),
        h('div', { class: 'field-row' }, lab('Average score (0 to 10)', f.avg), lab('Number of feedback', f.count), lab('Standard deviation', f.sd), lab('Start confidence (0 to 100)', f.conf)),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'submit' }, a ? 'Save changes' : 'Add adjudicator'))), { wide: true });
    }

    render();
    return box;
  });
}
