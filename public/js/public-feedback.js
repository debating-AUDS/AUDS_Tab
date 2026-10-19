import { h, clear, get, post, emptyState, setTitle, errorMessage, roleName } from './lib.js';
import { subHeader } from './public-common.js';

function store(slug) {
  const key = 'auds-feedback-' + slug;
  return {
    load() { try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; } },
    save(v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
}

function scorePicker(name, min, max, value, onChange) {
  const wrap = h('div', { class: 'score-row', role: 'group', 'aria-label': 'Rating from ' + min + ' to ' + max });
  const inputs = [];
  for (let i = min; i <= max; i++) {
    const input = h('input', { type: 'radio', name, value: String(i), checked: value === i, onchange: () => onChange(i) });
    inputs.push(input);
    wrap.append(h('label', { class: 'score-pick' }, input, h('span', null, i)));
  }
  const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { inputs.forEach((i) => (i.checked = false)); onChange(null); } }, 'Clear');
  return h('div', { class: 'score-wrap' }, wrap, clearBtn);
}

export async function feedbackView({ params }) {
  const slug = params.slug;
  const [{ tournament: t }, form] = await Promise.all([get(`/api/public/t/${slug}`), get(`/api/public/t/${slug}/feedback-form`)]);
  setTitle(`${t.name}, feedback`);
  const page = h('div', { class: 'page narrow' }, subHeader(t, 'feedback'));
  if (!form.open) {
    page.append(emptyState('Feedback is closed', 'The organisers aren\'t taking adjudicator feedback right now.', h('a', { class: 'btn', href: `#/t/${slug}` }, 'View the leaderboard')));
    return page;
  }
  if (!form.rounds.length) {
    page.append(emptyState('No draws to give feedback on yet', 'Feedback opens for a round as soon as its draw is published.'));
    return page;
  }
  const saved = store(slug);
  const mem = saved.load();
  const st = { round: null, room: null, giverId: null, ratings: {}, comments: {}, code: '', done: null, busy: false, error: '' };
  const hasRound = (r) => form.rounds.some((x) => x.round === r);
  st.round = hasRound(mem.round) ? mem.round : form.rounds[form.rounds.length - 1].round;
  const roundObj = () => form.rounds.find((r) => r.round === st.round);
  const roomObj = () => roundObj().rooms.find((r) => r.room === st.room);
  if (roundObj().rooms.some((r) => r.room === mem.room)) st.room = mem.room;
  else if (roundObj().rooms.length === 1) st.room = roundObj().rooms[0].room;

  const root = h('div', { class: 'fb' });
  page.append(root);

  function remember() { saved.save({ round: st.round, room: st.room }); }
  function resetGiving() { st.giverId = null; st.ratings = {}; st.comments = {}; st.error = ''; }

  function paint() {
    clear(root);
    if (st.done !== null) {
      root.append(h('div', { class: 'panel fb-done' },
        h('h2', null, 'Feedback sent'),
        h('p', null, `${st.done} rating${st.done === 1 ? '' : 's'} saved. Thank you; it directly shapes how adjudicators are ranked and allocated.`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { st.done = null; resetGiving(); paint(); } }, 'Submit more feedback'),
          h('a', { class: 'btn', href: `#/t/${slug}` }, 'Back to the leaderboard'))));
      return;
    }
    const form1 = h('form', { class: 'panel fb-form', novalidate: true, onsubmit: submit });
    // Round
    form1.append(h('div', { class: 'field' },
      h('label', { for: 'fb-round' }, 'Round'),
      h('select', { id: 'fb-round', onchange: (e) => { st.round = Number(e.target.value); st.room = roundObj().rooms.length === 1 ? roundObj().rooms[0].room : null; resetGiving(); remember(); paint(); document.getElementById('fb-round')?.focus(); } },
        form.rounds.map((r) => h('option', { value: r.round, selected: r.round === st.round }, 'Round ' + r.round)))));
    // Room
    form1.append(h('div', { class: 'field' },
      h('label', { for: 'fb-room' }, 'Room'),
      h('select', { id: 'fb-room', onchange: (e) => { st.room = e.target.value || null; resetGiving(); remember(); paint(); document.getElementById('fb-room')?.focus(); } },
        h('option', { value: '' }, 'Choose your room'),
        roundObj().rooms.map((r) => h('option', { value: r.room, selected: r.room === st.room }, r.room)))));
    const room = st.room ? roomObj() : null;
    if (!room) { root.append(form1); return; }
    // Who
    const teamInfo = (g) => (g.kind === 'team' ? room.teams.find((tm) => tm.team === Number(g.id.split(':')[1])) : null);
    if (!room.givers.length) {
      form1.append(h('div', { class: 'notice' }, 'This room has no adjudicators to rate yet.'));
      root.append(form1);
      return;
    }
    form1.append(h('fieldset', { class: 'field fb-who' },
      h('legend', { class: 'label' }, 'Who is giving feedback?'),
      room.givers.map((g) => {
        const tm = teamInfo(g);
        return h('label', { class: 'who-opt' },
          h('input', { type: 'radio', name: 'giver', value: g.id, checked: g.id === st.giverId, onchange: () => { st.giverId = g.id; st.ratings = {}; st.comments = {}; st.error = ''; paint(); document.querySelector(`input[name=giver][value="${CSS.escape(g.id)}"]`)?.focus(); } }),
          h('span', null, h('strong', null, g.label), tm ? h('span', { class: 'muted who-sub' }, tm.members.join(', ')) : null));
      })));
    const giver = room.givers.find((g) => g.id === st.giverId);
    if (giver) {
      form1.append(h('div', { class: 'rate-list' },
        h('h2', null, 'Rate your adjudicators'),
        h('p', { class: 'muted' }, 'Score from ', form.min, ' (poor) to ', form.max, ' (excellent). Skip anyone you can\'t rate.'),
        giver.targets.map((tg, i) => {
          const nm = 'rate-' + i;
          return h('div', { class: 'rate' },
            h('div', { class: 'rate-who' }, h('strong', null, tg.adjudicator), h('span', { class: 'muted' }, ' ', roleName[tg.role] || tg.role)),
            scorePicker(nm, form.min, form.max, st.ratings[tg.adjudicator] ?? null, (v) => { if (v === null) delete st.ratings[tg.adjudicator]; else st.ratings[tg.adjudicator] = v; sync(); }),
            h('details', { class: 'rate-comment' },
              h('summary', null, 'Add a comment'),
              h('textarea', { rows: 3, maxlength: 1000, 'aria-label': 'Comment for ' + tg.adjudicator, oninput: (e) => { st.comments[tg.adjudicator] = e.target.value; } }, st.comments[tg.adjudicator] || '')));
        })));
      if (form.codeRequired) {
        form1.append(h('div', { class: 'field' },
          h('label', { for: 'fb-code' }, 'Feedback code'),
          h('input', { id: 'fb-code', type: 'text', autocomplete: 'off', value: st.code, oninput: (e) => { st.code = e.target.value; } }),
          h('span', { class: 'hint' }, 'Ask a tournament organiser if you don\'t have the code.')));
      }
      form1.append(h('div', { id: 'fb-error', class: 'notice notice-bad', role: 'alert', hidden: !st.error }, st.error));
      form1.append(h('div', { class: 'btn-row' }, h('button', { id: 'fb-send', class: 'btn btn-primary', type: 'submit', disabled: true }, 'Send feedback')));
    }
    root.append(form1);
    sync();
  }

  function sync() {
    const b = document.getElementById('fb-send');
    if (b) b.disabled = st.busy || Object.keys(st.ratings).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    const ratings = Object.entries(st.ratings).map(([adjudicator, score]) => ({ adjudicator, score, comment: (st.comments[adjudicator] || '').trim() || undefined }));
    if (!ratings.length) return;
    st.busy = true; sync();
    try {
      const res = await post(`/api/public/t/${slug}/feedback`, { round: st.round, room: st.room, giverId: st.giverId, ratings, code: form.codeRequired ? st.code : undefined });
      st.done = res.saved; st.busy = false; paint(); window.scrollTo(0, 0);
    } catch (err) {
      st.busy = false; st.error = errorMessage(err);
      const box = document.getElementById('fb-error');
      if (box) { box.textContent = st.error; box.hidden = false; box.scrollIntoView({ block: 'center' }); }
      sync();
    }
  }

  paint();
  return page;
}
