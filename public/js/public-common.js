// Pieces shared by the public pages: tournament sub-header and the door-placard draw view.
import { h, roleName } from './lib.js';

export const scoreText = (n) => (n === null || n === undefined ? '–' : String(+Number(n).toFixed(2)));

export function ordinalWord(n) {
  const m = n % 100;
  if (m >= 11 && m <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10] || 'th');
}

/** Latest round whose draw has been published (or null). */
export function latestPublished(t) {
  const pub = t.rounds.filter((r) => r.published);
  return pub.length ? pub[pub.length - 1].round : null;
}

export function drawRoundFor(t) {
  return latestPublished(t) || Math.min(t.currentRound, t.totalRounds);
}

/** Name, status and the three public sections of one tournament. */
export function subHeader(t, active) {
  const link = (id, href, label) =>
    h('a', { class: 'tab', href, 'aria-current': active === id ? 'page' : null }, label);
  return h('div', { class: 't-head' },
    h('div', { class: 't-head-top' },
      h('h1', null, t.name),
      h('span', { class: 'badge ' + (t.status === 'active' ? '' : 'badge-quiet') }, t.status === 'active' ? 'Live' : 'Archived'),
      h('span', { class: 'muted t-format' }, t.format === '3v3' ? '3v3, Aff and Neg' : 'British Parliamentary')),
    h('nav', { class: 'tabs', 'aria-label': t.name },
      link('leaderboard', `#/t/${t.slug}`, 'Leaderboard'),
      link('round', `#/t/${t.slug}/round/${drawRoundFor(t)}`, 'Draw and results'),
      t.status === 'active' ? link('feedback', `#/t/${t.slug}/feedback`, 'Give feedback') : null));
}

const BENCH = { Aff: 'gov', Neg: 'opp', OG: 'gov', CG: 'gov', OO: 'opp', CO: 'opp' };

function benchItems(team) {
  if (team.rows) return team.rows.map((r) => ({ name: r.speaker, originalTeam: r.originalTeam, score: r.score }));
  return team.speakers.map((s) => ({ name: s.name, originalTeam: s.originalTeam, score: null }));
}

/**
 * One room drawn as a door placard: room name on the plate, then the benches.
 * `room` is either a draw room (teams[].speakers) or a results room (teams[].rows).
 * `mark` = { team, speaker, adjudicator } highlights what the viewer searched for.
 */
export function placard(room, { format, mark = {} } = {}) {
  const bp = format === 'BP';
  const showResults = room.teams.some((t) => t.placement !== undefined && t.placement !== null);
  const panel = room.adjudicators || [];

  const bench = (team) => {
    const side = BENCH[team.position] || 'gov';
    const items = benchItems(team);
    const seen = {};
    const won = showResults && team.placement === 1;
    const hit = mark.team !== undefined && mark.team === team.team;
    return h('section', { class: `bench bench-${side}${won ? ' bench-won' : ''}${hit ? ' bench-hit' : ''}`, 'aria-label': `${team.position}, team ${team.team}` },
      h('header', { class: 'bench-head' },
        h('span', { class: 'bench-pos' }, team.position),
        h('span', { class: 'bench-team num' }, 'Team ', team.team),
        showResults && team.placement
          ? h('span', { class: 'bench-result' }, bp ? ordinalWord(team.placement) : (team.placement === 1 ? 'Won' : 'Lost'))
          : null),
      team.merged ? h('p', { class: 'bench-note' }, 'Merged team') : null,
      h('ul', { class: 'bench-speakers' }, items.map((s) => {
        seen[s.name] = (seen[s.name] || 0) + 1;
        const nth = seen[s.name];
        const isHit = mark.speaker && s.name.toLowerCase().includes(mark.speaker);
        return h('li', { class: isHit ? 'is-hit' : null },
          h('span', { class: 'sp-name' }, s.name,
            nth > 1 ? h('span', { class: 'sp-tag' }, ' second speech') : null,
            s.originalTeam !== team.team ? h('span', { class: 'sp-tag' }, ` from team ${s.originalTeam}`) : null),
          showResults ? h('span', { class: 'sp-score num' }, scoreText(s.score)) : null);
      })),
      showResults && team.teamTotal !== null && team.teamTotal !== undefined
        ? h('p', { class: 'bench-total' }, h('span', { class: 'num' }, scoreText(team.teamTotal)), ' team total')
        : null);
  };

  return h('article', { class: `placard${bp ? ' placard-bp' : ''}` },
    h('header', { class: 'plate' },
      h('h3', { class: 'plate-room' }, room.room),
      panel.length
        ? h('ul', { class: 'panel-list', 'aria-label': 'Adjudicators' }, panel.map((a) =>
            h('li', { class: mark.adjudicator && a.name.toLowerCase().includes(mark.adjudicator) ? 'is-hit' : null },
              h('span', { class: 'role' }, roleName[a.role] || a.role), ' ', a.name)))
        : h('p', { class: 'muted plate-none' }, 'Panel to be announced')),
    h('div', { class: 'benches' }, room.teams.map(bench)));
}
