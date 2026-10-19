// Shared helpers: DOM builder, API client, dialogs, toasts, formatting.

/** Hyperscript. Text is always inserted as text nodes, so user-supplied names can't inject HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export class ApiError extends Error {
  constructor(status, message, code, data) { super(message); this.status = status; this.code = code; this.data = data; }
}

export async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new ApiError(0, "Can't reach the server. Check your connection and try again."); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/api/admin')) { state.admin = false; document.dispatchEvent(new CustomEvent('auth-changed')); }
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status}).`, data && data.code, data);
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p, b = {}) => api('DELETE', p, b);

export const state = { admin: false };

export function navigate(path) { location.hash = '#' + path; }
export function setTitle(t) { document.title = t ? `${t} · AUDS Leaderboard` : 'AUDS Leaderboard'; }

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.classList.add('toast-out'), kind === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), kind === 'error' ? 6400 : 3400);
}
export function errorMessage(e) { return e instanceof Error ? e.message : String(e); }

/** Run an async action, toasting any error. Returns undefined on failure. */
export async function attempt(fn, okMessage) {
  try { const r = await fn(); if (okMessage) toast(okMessage); return r; }
  catch (e) { toast(errorMessage(e), 'error'); return undefined; }
}

/** Modal dialog. `build(close)` returns the dialog body; resolves with whatever close(value) is given. */
export function openDialog(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' + (wide ? ' dialog-wide' : '') });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    dlg.append(h('h2', { class: 'dialog-title' }, title), build(close));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return openDialog(title, (close) => h('div', { class: 'dialog-body' },
    h('p', null, message),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, cancelText),
      h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', autofocus: true, onclick: () => close(true) }, confirmText))))
    .then((v) => !!v);
}

export const fmt1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toFixed(1));
export const fmt2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toFixed(2));
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}
export const roleName = { C: 'Chair', P: 'Panellist', T: 'Trainee' };

export function loading(text = 'Loading…') { return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text); }
export function emptyState(title, body, action) {
  return h('div', { class: 'empty' }, h('h3', null, title), body ? h('p', null, body) : null, action || null);
}
