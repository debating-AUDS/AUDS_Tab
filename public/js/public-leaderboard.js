import { h, clear, get, fmt1, fmt2, emptyState, setTitle } from './lib.js';
import { subHeader } from './public-common.js';

const chip = (label) => (label ? h('span', { class: `chip chip-${label.toLowerCase()}` }, label) : h('span', { class: 'muted' }, '–'));

function teamsTable(lb) {
  const rounds = Array.from({ length: lb.totalRounds }, (_, i) => i + 1);
  const head = h('tr', null,
    h('th', { class: 'stick stick-1 n', scope: 'col' }, 'Rank'),
    h('th', { class: 'stick stick-2', scope: 'col' }, 'Team members'),
    rounds.map((r) => h('th', { scope: 'col', title: `Round ${r}` }, 'R' + r)),
    h('th', { class: 'n', scope: 'col', title: 'Debates completed' }, 'Debates'),
    h('th', { class: 'n', scope: 'col' }, 'Avg team'),
    h('th', { class: 'n', scope: 'col' }, 'Avg speaker'),
    h('th', { class: 'n', scope: 'col' }, 'Total'),
    h('th', { class: 'n', scope: 'col' }, 'Draw strength'),
    h('th', { class: 'n', scope: 'col' }, 'Difficulty'),
    h('th', { class: 'n', scope: 'col' }, 'Feedback'));
  const rows = lb.teams.map((t) => h('tr', { class: t.eligible ? 'row-eligible' : 'row-ineligible', dataset: { q: (t.members + ' ' + t.rank).toLowerCase() } },
    h('td', { class: 'stick stick-1 n rank' }, t.rank),
    h('td', { class: 'stick stick-2 members' }, t.members, t.eligible ? null : h('span', { class: 'sr-note' }, ' (fewer than 3 debates)')),
    t.results.map((r) => h('td', null, chip(r))),
    h('td', { class: 'n' }, t.debates),
    h('td', { class: 'n' }, fmt2(t.avgTeamPoints)),
    h('td', { class: 'n' }, fmt1(t.avgSpeakerScore)),
    h('td', { class: 'n' }, fmt1(t.totalTeamPoints)),
    h('td', { class: 'n' }, t.drawStrength ?? '–'),
    h('td', { class: 'n' }, fmt2(t.drawDifficulty)),
    h('td', { class: 'n' }, t.feedback)));
  return h('div', { class: 'table-wrap lb-wrap' },
    h('table', { class: 'data lb-table' }, h('caption', { class: 'visually-hidden' }, 'Team leaderboard'), h('thead', null, head), h('tbody', null, rows)));
}

function speakersTable(lb) {
  const rounds = Array.from({ length: lb.totalRounds }, (_, i) => i + 1);
  const head = h('tr', null,
    h('th', { class: 'stick stick-1 n', scope: 'col' }, 'Rank'),
    h('th', { class: 'stick stick-2', scope: 'col' }, 'Speaker'),
    rounds.map((r) => h('th', { scope: 'col', title: `Round ${r}` }, 'R' + r)),
    h('th', { class: 'n', scope: 'col' }, 'Average'),
    h('th', { class: 'n', scope: 'col' }, 'Team points'),
    h('th', { class: 'n', scope: 'col' }, 'Iron'),
    h('th', { class: 'n', scope: 'col' }, 'Weighted'),
    h('th', { class: 'n', scope: 'col' }, 'Draw strength'),
    h('th', { class: 'n', scope: 'col' }, 'Difficulty'),
    h('th', { scope: 'col' }, 'Break eligible'));
  const rows = lb.speakers.map((s) => h('tr', { class: s.eligible ? 'row-eligible' : 'row-ineligible', dataset: { q: (s.name + ' ' + s.rank).toLowerCase() } },
    h('td', { class: 'stick stick-1 n rank' }, s.rank),
    h('td', { class: 'stick stick-2 members' }, s.name),
    s.rounds.map((r) => h('td', { class: 'num' }, r ? r.map((x) => +x.toFixed(2)).join(' / ') : h('span', { class: 'muted' }, '–'))),
    h('td', { class: 'n' }, fmt2(s.average)),
    h('td', { class: 'n' }, fmt1(s.teamPoints)),
    h('td', { class: 'n' }, s.ironCount),
    h('td', { class: 'n' }, fmt2(s.weighted)),
    h('td', { class: 'n' }, s.drawStrength ?? '–'),
    h('td', { class: 'n' }, fmt2(s.drawDifficulty)),
    h('td', null, s.eligible ? h('span', { class: 'badge badge-brass' }, 'Yes') : h('span', { class: 'muted' }, 'No'))));
  return h('div', { class: 'table-wrap lb-wrap' },
    h('table', { class: 'data lb-table' }, h('caption', { class: 'visually-hidden' }, 'Individual speaker leaderboard'), h('thead', null, head), h('tbody', null, rows)));
}

function topFour(lb) {
  if (!lb.top.length) return null;
  return h('section', { class: 'topfour', 'aria-labelledby': 'top4' },
    h('h2', { id: 'top4' }, 'Top break-eligible teams'),
    h('ol', null, lb.top.map((t) => h('li', null,
      h('span', { class: 'top-rank num' }, t.rank),
      h('span', { class: 'top-members' }, t.members),
      h('span', { class: 'top-stat num' }, fmt2(t.avgTeamPoints), ' avg team, ', fmt1(t.avgSpeakerScore), ' avg speaker')))));
}

function explainer(lb) {
  const bp = lb.format === 'BP';
  return h('details', { class: 'explain' },
    h('summary', null, 'How to read this'),
    h('dl', null,
      h('dt', null, 'Break eligible'), h('dd', null, 'A team or speaker needs at least three debates to be eligible. Eligible rows sit above the rest and carry a brass edge.'),
      h('dt', null, 'Avg team'), h('dd', null, bp ? 'Average team points per debate: 3 for first, 2 for second, 1 for third and 0 for fourth.' : 'Average team points per debate: 1 for a win, 0 for a loss.'),
      h('dt', null, 'Avg speaker'), h('dd', null, 'Average of the speaker scores earned by this team across its debates.'),
      h('dt', null, 'Draw strength'), h('dd', null, 'How tough this team\'s opposition has been, ranked. 1 is the hardest draw. An equals sign marks a tie. Difficulty is the underlying number: the average weighted contribution of the speakers they faced.'),
      h('dt', null, 'Feedback'), h('dd', null, 'Adjudicator ratings this team has submitted. It breaks ties between otherwise level teams.'),
      h('dt', null, 'Iron, weighted, team points'), h('dd', null, 'Iron counts the rounds a speaker spoke twice. Weighted is the speaker\'s share of their team\'s points, adjusted for how well they scored against their teammates. Team points are the points of every team they spoke for.')));
}

export async function leaderboardView({ params }) {
  const [{ tournament: t }, { leaderboard: lb }] = await Promise.all([
    get(`/api/public/t/${params.slug}`), get(`/api/public/t/${params.slug}/leaderboard`)]);
  setTitle(t.name);
  const page = h('div', { class: 'page' }, subHeader(t, 'leaderboard'));
  if (!lb.completedRounds.length) {
    page.append(emptyState('No results yet', 'Standings appear here as soon as the first round is marked complete.',
      h('a', { class: 'btn', href: `#/t/${t.slug}/round/${Math.min(t.currentRound, t.totalRounds)}` }, 'See the draw')));
    return page;
  }
  let tab = 'teams';
  const body = h('div', { class: 'lb-body' });
  const filter = h('input', { type: 'search', placeholder: 'Filter by name or rank', 'aria-label': 'Filter the table', oninput: apply });
  const tabs = h('div', { class: 'tabs lb-tabs', role: 'tablist' });
  function apply() {
    const q = filter.value.trim().toLowerCase();
    body.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = !!q && !tr.dataset.q.includes(q); });
  }
  function paint() {
    clear(tabs).append(...['teams', 'speakers'].map((id) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; paint(); } }, id === 'teams' ? 'Teams' : 'Speakers')));
    clear(body).append(...(tab === 'teams' ? [topFour(lb), teamsTable(lb)] : [speakersTable(lb)]));
    apply();
  }
  page.append(
    h('div', { class: 'lb-bar' },
      h('p', { class: 'muted lb-status' }, `After ${lb.completedRounds.length} of ${lb.totalRounds} rounds`),
      h('div', { class: 'lb-filter' }, filter)),
    tabs, body, explainer(lb));
  paint();
  return page;
}
