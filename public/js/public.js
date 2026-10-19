// Public site: home, leaderboard, rounds, feedback, archive.
import { h, clear, get, emptyState, fmtDate, setTitle } from './lib.js';
import { placard, latestPublished } from './public-common.js';
import { leaderboardView } from './public-leaderboard.js';
import { roundView } from './public-round.js';
import { feedbackView } from './public-feedback.js';

/** Find every room entry matching the search text. */
function findMatches(rooms, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const teamNo = needle.replace(/^team\s*/, '');
  const out = [];
  for (const room of rooms) {
    const hit = {};
    for (const tm of room.teams) {
      if (/^\d+$/.test(teamNo) && String(tm.team) === teamNo) hit.team = tm.team;
      if (tm.speakers.some((s) => s.name.toLowerCase().includes(needle))) { hit.speaker = needle; hit.team = hit.team ?? tm.team; }
    }
    if ((room.adjudicators || []).some((a) => a.name.toLowerCase().includes(needle))) hit.adjudicator = needle;
    if (Object.keys(hit).length) out.push({ room, mark: hit });
  }
  return out;
}

async function homeView() {
  const { tournaments } = await get('/api/public/tournaments');
  const t0 = tournaments.find((t) => t.status === 'active') || tournaments[0];
  if (!t0) {
    return h('div', { class: 'page narrow' }, emptyState('No tournament yet', 'Once the organisers set one up, the draw and standings will be here.', h('a', { class: 'btn', href: '#/archive' }, 'Browse the archive')));
  }
  const { tournament: t } = await get(`/api/public/t/${t0.slug}`);
  setTitle(t.name);
  const live = t.status === 'active';
  const pubRound = latestPublished(t);
  const view = pubRound ? await get(`/api/public/t/${t.slug}/rounds/${pubRound}`) : null;
  const rooms = view ? (view.results || view.draw)?.rooms ?? [] : [];

  const results = h('div', { class: 'find-results', 'aria-live': 'polite' });
  const input = h('input', { id: 'find', type: 'search', autocomplete: 'off', placeholder: 'Your name, team number or an adjudicator', oninput: run, disabled: !pubRound });
  function run() {
    const q = input.value;
    clear(results);
    if (!q.trim()) return;
    const m = findMatches(rooms, q);
    if (!m.length) { results.append(h('p', { class: 'muted' }, `No match for "${q.trim()}" in round ${pubRound}. Check the spelling, or try your team number.`)); return; }
    results.append(...m.map(({ room, mark }) => placard(room, { format: t.format, mark })));
  }

  const doneCount = t.rounds.filter((r) => r.status === 'completed').length;
  const pips = h('ol', { class: 'pips', 'aria-label': 'Round progress' }, t.rounds.map((r) => {
    const state = r.status === 'completed' ? 'done' : r.published ? 'out' : 'todo';
    return h('li', null, h('a', { class: `pip pip-${state}`, href: `#/t/${t.slug}/round/${r.round}`, title: state === 'done' ? 'Results in' : state === 'out' ? 'Draw out' : 'Not drawn yet' },
      h('span', { class: 'pip-n num' }, r.round), h('span', { class: 'pip-s' }, state === 'done' ? 'Results' : state === 'out' ? 'Draw out' : 'Upcoming')));
  }));

  return h('div', { class: 'page home' },
    h('section', { class: 'hero' },
      h('h1', null, t.name),
      h('p', { class: 'hero-line' },
        !live ? 'This tournament is finished. Final standings are in the leaderboard.'
          : pubRound ? `The round ${pubRound} draw is out. Find your room.`
          : 'The first draw isn\'t out yet. Check back soon.'),
      h('div', { class: 'find' },
        h('label', { for: 'find', class: 'find-label' }, 'Find my room'),
        input),
      results),
    h('section', { class: 'progress', 'aria-label': 'Progress' },
      h('h2', null, live ? `${doneCount} of ${t.totalRounds} rounds complete` : 'Rounds'),
      pips,
      h('div', { class: 'btn-row home-links' },
        h('a', { class: 'btn btn-primary', href: `#/t/${t.slug}` }, 'Leaderboard'),
        h('a', { class: 'btn', href: `#/t/${t.slug}/round/${pubRound || Math.min(t.currentRound, t.totalRounds)}` }, 'Draw and results'),
        live ? h('a', { class: 'btn', href: `#/t/${t.slug}/feedback` }, 'Give feedback') : null)));
}

async function archiveView() {
  const { tournaments } = await get('/api/public/tournaments');
  setTitle('Archive');
  const past = tournaments.filter((t) => t.status === 'archived');
  const page = h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Archive'), h('p', { class: 'page-sub' }, 'Draws, results and final standings from past tournaments.'))));
  if (!past.length) {
    page.append(emptyState('Nothing archived yet', 'Finished tournaments are kept here once the organisers archive them.'));
    return page;
  }
  page.append(h('ul', { class: 'archive-list' }, past.map((t) => h('li', null,
    h('a', { class: 'archive-item', href: `#/t/${t.slug}` },
      h('span', { class: 'archive-name' }, t.name),
      h('span', { class: 'archive-meta muted' },
        fmtDate(t.archivedAt || t.createdAt), ', ', t.format === 'BP' ? 'British Parliamentary' : '3v3', ', ',
        `${t.totalRounds} round${t.totalRounds === 1 ? '' : 's'}`))))));
  return page;
}

export const routes = [
  { pattern: '/', render: homeView },
  { pattern: '/archive', render: archiveView },
  { pattern: '/t/:slug', render: leaderboardView },
  { pattern: '/t/:slug/round/:n', render: roundView },
  { pattern: '/t/:slug/feedback', render: feedbackView },
];
