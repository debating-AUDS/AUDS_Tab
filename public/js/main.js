import { h, clear, get, post, state, loading, setTitle, errorMessage, toast } from './lib.js';
import { routes as publicRoutes } from './public.js';
import { routes as adminRoutes } from './admin.js';

const routes = [...adminRoutes, ...publicRoutes].map((r) => ({
  ...r,
  parts: r.pattern.split('/').filter(Boolean),
}));

function match(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.parts.forEach((p, i) => {
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) ok = false;
    });
    if (ok) return { route: r, params };
  }
  return null;
}

function renderHeader() {
  const header = document.getElementById('site-header');
  clear(header).append(
    h('div', { class: 'header-inner' },
      h('a', { class: 'brand', href: '#/' },
        h('img', { class: 'brand-logo', src: '/img/logo.png', alt: '', width: 44, height: 44 }),
        h('span', { class: 'brand-name' }, 'AUDS ', h('span', null, 'Leaderboard'))),
      h('nav', { class: 'site-nav', 'aria-label': 'Site' },
        h('a', { href: '#/' }, 'Tournament'),
        h('a', { href: '#/archive' }, 'Archive'),
        state.admin
          ? [h('a', { href: '#/admin' }, 'Admin'),
             h('button', { class: 'linklike', type: 'button', onclick: async () => { await post('/api/logout'); state.admin = false; document.dispatchEvent(new CustomEvent('auth-changed')); location.hash = '#/'; } }, 'Sign out')]
          : h('a', { href: '#/admin' }, 'Admin sign in'))));
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const main = document.getElementById('main');
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const m = match(path);
  document.body.dataset.area = path.startsWith('/admin') ? 'admin' : 'public';
  clear(main).append(loading());
  if (!m) {
    clear(main).append(h('div', { class: 'page narrow' }, h('h1', null, 'Page not found'), h('p', null, 'That address doesn\'t match anything here.'), h('a', { class: 'btn', href: '#/' }, 'Go to the tournament')));
    return;
  }
  setTitle('');
  try {
    const node = await m.route.render({ params: m.params, query, path });
    if (token !== renderToken) return;
    clear(main).append(node);
  } catch (e) {
    if (token !== renderToken) return;
    clear(main).append(h('div', { class: 'page narrow' }, h('h1', null, 'Something went wrong'), h('p', { class: 'error-text' }, errorMessage(e)),
      h('button', { class: 'btn', type: 'button', onclick: render }, 'Try again')));
  }
  if (!location.hash.includes('keepscroll')) window.scrollTo(0, 0);
}

/** Views call this to re-render the current page (e.g. after saving). */
document.addEventListener('rerender', render);
document.addEventListener('auth-changed', () => { renderHeader(); });

async function start() {
  try { state.admin = (await get('/api/me')).admin; } catch { state.admin = false; }
  renderHeader();
  window.addEventListener('hashchange', render);
  await render();
}
start();
