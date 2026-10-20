import { h, get, emptyState, setTitle } from './lib.js';
import { subHeader, placard } from './public-common.js';

export async function roundView({ params }) {
  const n = Number(params.n);
  const { tournament: t } = await get(`/api/public/t/${params.slug}`);
  const info = t.rounds.find((r) => r.round === n);
  setTitle(`${t.name}, ${info ? info.name : 'round ' + n}`);
  const page = h('div', { class: 'page' }, subHeader(t, 'round'));
  if (!info) {
    page.append(emptyState('That round doesn\'t exist', `${t.name} has ${t.totalRounds} rounds.`, h('a', { class: 'btn', href: `#/t/${t.slug}/round/1` }, `Go to ${t.rounds[0].name}`)));
    return page;
  }
  const tabs = h('nav', { class: 'tabs round-tabs', 'aria-label': 'Rounds' }, t.rounds.map((r) => {
    const state = r.status === 'completed' ? 'Results' : r.published ? 'Draw' : '';
    return h('a', { class: 'tab', href: `#/t/${t.slug}/round/${r.round}`, 'aria-current': r.round === n ? 'page' : null },
      r.name, state ? h('span', { class: 'tab-state' }, state) : null);
  }));
  page.append(tabs);

  const view = await get(`/api/public/t/${params.slug}/rounds/${n}`);
  const rooms = view.results ? view.results.rooms : view.draw ? view.draw.rooms : null;
  if (!view.published && !view.results) {
    page.append(emptyState(`The ${info.name} draw isn't out yet`,
      n === t.currentRound ? 'The draw appears here as soon as the organisers publish it.' : 'There is no draw for this round yet.'));
    return page;
  }
  if (!rooms || !rooms.length) {
    page.append(emptyState('Nothing to show', 'This round has no rooms.'));
    return page;
  }
  const completed = view.status === 'completed';
  // Organisers choose per round what is published; if nothing is, it reads as a draw.
  const show = view.results ? view.results.show : null;
  const anyShown = !!show && (show.placement || show.teamAverage || show.speakerScores);
  const resultsOut = completed && anyShown;
  let note;
  if (resultsOut) {
    const bits = [];
    if (show.speakerScores) bits.push('Scores are per speech.');
    if (show.teamAverage) bits.push(`A team average is the average of its ${t.format === 'BP' ? 'two' : 'three'} scored speeches.`);
    note = bits.join(' ') || 'Results for this round.';
  } else note = 'Check your room and bench. Results appear here once the round is marked complete.';
  page.append(
    h('div', { class: 'round-head' },
      h('h2', null, resultsOut ? `${info.name} results` : `${info.name} draw`),
      view.topic
        ? h('div', { class: 'topic' }, h('span', { class: 'topic-label' }, 'Topic'), h('p', { class: 'topic-text' }, view.topic))
        : null),
    h('div', { class: 'placards' }, rooms.map((r) => placard(r, { format: t.format }))),
    h('p', { class: 'muted round-note' }, note,
      !completed && t.status === 'active'
        ? [' ', h('a', { href: `#/t/${t.slug}/feedback` }, 'Give feedback on your adjudicators.')] : null));
  return page;
}
