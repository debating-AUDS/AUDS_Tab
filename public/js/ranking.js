// Ranking criteria the organisers can choose from (keys match src/engine/stats.ts).
import { h } from './lib.js';

export const TEAM_CRITERIA = [
  ['avgTeamPoints', 'Average team points per debate'],
  ['avgSpeakerScore', 'Average speaker score'],
  ['avgWeighted', 'Average weighted contribution of the team’s speakers'],
  ['totalTeamPoints', 'Total team points'],
  ['totalSpeakerScore', 'Total speaker score'],
  ['drawDifficulty', 'Draw difficulty (harder draws rank higher)'],
  ['feedback', 'Feedback submitted by the team'],
];
export const SPEAKER_CRITERIA = [
  ['average', 'Average speaker score'],
  ['totalScore', 'Total speaker score'],
  ['weighted', 'Weighted contribution'],
  ['teamPoints', 'Team points'],
  ['drawDifficulty', 'Draw difficulty (harder draws rank higher)'],
];
export const DEFAULT_TEAM_RANK = ['avgTeamPoints', 'avgSpeakerScore', 'feedback'];
export const DEFAULT_SPEAKER_RANK = ['average', 'totalScore'];

export const labelOf = (list, key) => (list.find((x) => x[0] === key) || [key, key])[1];

const ORDINALS = ['First', 'Then', 'Then', 'Then'];

/** An ordered list of "rank by" dropdowns. `get()` returns the chosen keys, or throws a readable Error. */
export function rankingEditor(options, value, disabled = false) {
  const rows = ORDINALS.map((word, i) => {
    const sel = h('select', { disabled, 'aria-label': `${i === 0 ? 'Rank first by' : 'Then rank by'} (level ${i + 1})` },
      i === 0 ? null : h('option', { value: '' }, '(not used)'),
      options.map(([k, label]) => h('option', { value: k, selected: value[i] === k }, label)));
    if (i > 0 && !value[i]) sel.value = '';
    return h('div', { class: 'rank-row' }, h('span', { class: 'rank-word' }, word), sel);
  });
  const el = h('div', { class: 'rank-editor' }, rows);
  return {
    el,
    get() {
      const out = [];
      for (const r of rows) {
        const v = r.querySelector('select').value;
        if (!v) continue;
        if (out.includes(v)) throw new Error('Each ranking criterion can only be used once.');
        out.push(v);
      }
      return out;
    },
  };
}
