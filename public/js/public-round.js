import { h, get, emptyState, setTitle } from './lib.js';
import { subHeader, placard } from './public-common.js';

export async function roundView({ params }) {
  const n = Number(params.n);
  const { tournament: t } = await get(`/api/public/t/${params.slug}`);
  setTitle(`${t.name}, round ${n}`);
  const page = h('div', { class: 'page' }, subHeader(t, 'round'));
  if (!Number.isInteger(n) || n < 1 || n > t.totalRounds) {
    page.append(emptyState('That round doesn\'t exist', `${t.name} has ${t.totalRounds} rounds.`, h('a', { class: 'btn', href: `#/t/${t.slug}/round/1` }, 'Go to round 1')));
    return page;
  }
  const tabs = h('nav', { class: 'tabs round-tabs', 'aria-label': 'Rounds' }, t.rounds.map((r) => {
    const state = r.status === 'completed' ? 'Results' : r.published ? 'Draw' : '';
    return h('a', { class: 'tab', href: `#/t/${t.slug}/round/${r.round}`, 'aria-current': r.round === n ? 'page' : null },
      'Round ', r.round, state ? h('span', { class: 'tab-state' }, state) : null);
  }));
  page.append(tabs);

  const view = await get(`/api/public/t/${params.slug}/rounds/${n}`);
  const rooms = view.results ? view.results.rooms : view.draw ? view.draw.rooms : null;
  if (!view.published && !view.results) {
    page.append(emptyState(`Round ${n} draw isn't out yet`,
      n === t.currentRound ? 'The draw appears here as soon as the organisers publish it.' : 'There is no draw for this round yet.'));
    return page;
  }
  if (!rooms || !rooms.length) {
    page.append(emptyState('Nothing to show', 'This round has no rooms.'));
    return page;
  }
  const completed = view.status === 'completed';
  page.append(
    h('div', { class: 'round-head' },
      h('h2', null, completed ? `Round ${n} results` : `Round ${n} draw`),
      h('p', { class: 'muted' }, completed
        ? 'Scores are per speech. A team total is the average of its three scored speeches in 3v3 and of its two in BP.'
        : 'Check your room and bench. Results appear here once the round is marked complete.',
        view.status !== 'completed' && t.status === 'active'
          ? [' ', h('a', { href: `#/t/${t.slug}/feedback` }, 'Give feedback on your adjudicators.')] : null)),
    h('div', { class: 'placards' }, rooms.map((r) => placard(r, { format: t.format }))));
  return page;
}
