import { h, clear, get, post, emptyState, setTitle, errorMessage, roleName } from './lib.js';
import { subHeader } from './public-common.js';

function store(slug) {
  const key = 'auds-feedback-' + slug;
  return {
    load() { try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; } },
    save(v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
}

const GUIDE_INTRO = 'Please consider the following score guide:';
const GUIDE = [
  ['1.', 'This was a very poor adjudication.'],
  ['3.', 'This was a poor adjudication. An obvious clash was called incorrectly, parts of the debate were not heard and/or reasoning and justification was lacking.'],
  ['5.', 'This was a sufficient adjudication, with the obvious clashes called correctly. The decision should have been explained differently or better. Some close clashes were called incorrectly.'],
  ['7.', 'This was a good quality adjudication and the adjudication came to an appropriate decision and provided appropriate justification of their decision. All clashes were called correctly.'],
  ['9.', 'This was an excellent adjudication. The adjudicator came to the right decision, had excellent justification of their decision, and gave useful feedback to the teams. All clashes were called correctly. This adjudicator should adjudicate the grand final.'],
  ['10.', 'This was a superb adjudication. This adjudicator should chair the grand final.'],
];

function questionText(q, tg) {
  switch (q) {
    case 'overall': return 'How well did your adjudicator do overall?';
    case 'decision': return 'How would you rate their decision?';
    case 'justification': return 'How would you rate their justification?';
    case 'chair': return 'How well did your chair manage the deliberation?';
    case 'contribution': return `How well did your ${tg.role === 'trainee' ? 'trainee' : 'panelist'} contribute to the deliberation?`;
    default: return q;
  }
}

function scoreGuide() {
  return h('div', { class: 'score-guide' },
    h('p', null, GUIDE_INTRO),
    h('ul', null, GUIDE.map(([n, t]) => h('li', null, h('strong', null, n), ' ', t))));
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
        form.rounds.map((r) => h('option', { value: r.round, selected: r.round === st.round }, r.name)))));
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
        h('p', { class: 'muted' }, 'Score from ', form.min, ' (poor) to ', form.max, ' (excellent). Skip anyone you can\'t rate; if you rate someone, answer every question for them.'),
        giver.targets.map((tg, i) => {
          const mine = (st.ratings[tg.adjudicator] ||= {});
          return h('div', { class: 'rate' },
            h('div', { class: 'rate-who' }, h('strong', null, tg.adjudicator), h('span', { class: 'muted' }, ' ', roleName[tg.role] || tg.role)),
            tg.questions.map((q) => h('div', { class: 'rate-q' },
              h('div', { class: 'rate-q-text', id: `q-${i}-${q}` }, questionText(q, tg)),
              q === 'overall' ? scoreGuide() : null,
              scorePicker(`rate-${i}-${q}`, form.min, form.max, mine[q] ?? null, (v) => { if (v === null) delete mine[q]; else mine[q] = v; sync(); }))),
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
      form1.append(h('div', { id: 'fb-incomplete', class: 'notice', role: 'status', hidden: true }));
      form1.append(h('div', { id: 'fb-error', class: 'notice notice-bad', role: 'alert', hidden: !st.error }, st.error));
      form1.append(h('div', { class: 'btn-row' }, h('button', { id: 'fb-send', class: 'btn btn-primary', type: 'submit', disabled: true }, 'Send feedback')));
    }
    root.append(form1);
    sync();
  }

  // A target counts as "started" once any question is answered; it is "complete" when all are.
  function progress() {
    const room = roomObj();
    const giver = room && room.givers.find((g) => g.id === st.giverId);
    const out = { started: [], incomplete: [] };
    if (!giver) return out;
    for (const tg of giver.targets) {
      const mine = st.ratings[tg.adjudicator] || {};
      const n = tg.questions.filter((q) => mine[q] != null).length;
      if (n > 0) out.started.push(tg);
      if (n > 0 && n < tg.questions.length) out.incomplete.push(tg);
    }
    return out;
  }

  function sync() {
    const b = document.getElementById('fb-send');
    if (!b) return;
    const p = progress();
    b.disabled = st.busy || p.started.length === 0 || p.incomplete.length > 0;
    const hint = document.getElementById('fb-incomplete');
    if (hint) {
      hint.hidden = p.incomplete.length === 0;
      hint.textContent = p.incomplete.length ? 'Answer every question for ' + p.incomplete.map((t) => t.adjudicator).join(', ') + ', or clear their ratings, to send.' : '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    const p = progress();
    const ratings = p.started.map((tg) => { const { overall, ...rest } = st.ratings[tg.adjudicator]; return { adjudicator: tg.adjudicator, score: overall, ...rest, comment: (st.comments[tg.adjudicator] || '').trim() || undefined }; });
    if (!ratings.length || p.incomplete.length) return;
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
