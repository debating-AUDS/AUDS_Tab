import { h, get, post, state, setTitle, clear, attempt, toast } from './lib.js';

export function signInView() {
  const err = h('p', { class: 'error-text', role: 'alert' });
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, autofocus: true });
  const form = h('form', { class: 'panel signin', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await post('/api/login', { password: pw.value });
      state.admin = true;
      document.dispatchEvent(new CustomEvent('auth-changed'));
      document.dispatchEvent(new CustomEvent('rerender'));
    } catch (ex) { err.textContent = ex.message; pw.select(); }
  } },
    h('h1', null, 'Admin sign in'),
    h('p', { class: 'muted' }, 'Organisers only. Everyone else can view the leaderboard and results without signing in.'),
    h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password'), pw),
    err,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in'));
  return h('div', { class: 'page narrow' }, form);
}

const TABS = [
  ['', 'Overview'], ['/roll', 'Roll'], ['/adjudicators', 'Adjudicators'], ['/rounds', 'Rounds'], ['/feedback', 'Feedback'], ['/settings', 'Settings'],
];

/** Wraps a per-tournament admin page: header, sub-nav, archived banner. */
export async function tournamentPage(slug, tab, build, { wide = false } = {}) {
  const { tournament: t } = await get(`/api/admin/t/${encodeURIComponent(slug)}`);
  setTitle(`Admin · ${t.name}`);
  const base = `#/admin/t/${encodeURIComponent(slug)}`;
  const nav = h('nav', { class: 'tabs admin-tabs', 'aria-label': 'Tournament sections' },
    TABS.map(([p, label]) => h('a', { class: 'tab', href: base + (p === '/rounds' ? `/round/${Math.min(t.currentRound, t.totalRounds)}` : p), 'aria-current': tab === p ? 'page' : null }, label)));
  const body = h('div', { class: 'admin-body' });
  const page = h('div', { class: 'page admin-page' + (wide ? ' wide' : '') },
    h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'crumbs' }, h('a', { href: '#/admin' }, 'All tournaments')),
        h('h1', null, t.name),
        h('p', { class: 'page-sub' }, t.format === '3v3' ? '3v3 format' : 'BP format', ' · ', t.totalRounds, ' rounds · ',
          h('span', { class: 'badge ' + (t.status === 'active' ? '' : 'badge-quiet') }, t.status === 'active' ? 'Active' : 'Archived'))),
      h('a', { class: 'btn btn-sm', href: `#/t/${encodeURIComponent(slug)}`, target: '_blank', rel: 'noopener' }, 'View public site')),
    nav,
    t.status === 'archived' ? h('div', { class: 'notice' }, 'This tournament is archived and read-only. Its results stay on the public archive.') : null,
    body);
  body.append(await build(t, body));
  return page;
}

export const readOnly = (t) => t.status !== 'active';

/** Run a mutation, toast success/failure, return result or undefined. */
export const run = attempt;

export function statusBadge(r) {
  const map = { empty: ['No draw', 'badge-quiet'], drawn: ['Drawn', 'badge-warn'], scoring: ['Scoring', 'badge-warn'], completed: ['Completed', ''] };
  const [label, cls] = map[r.status] || [r.status, 'badge-quiet'];
  return h('span', { class: 'badge ' + cls }, label);
}

export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function toggle(checked, onchange, label, disabled = false) {
  return h('label', { class: 'check toggle' },
    h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onchange(e.target.checked, e.target) }),
    h('span', { class: 'visually-hidden' }, label));
}
export { clear, toast };
