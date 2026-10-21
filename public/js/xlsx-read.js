// Reads the workbook produced by "Download Excel" (and similar simple .xlsx files) in the browser,
// and turns it into the same shape as the JSON export. No libraries: zip + XML only.

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65600); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That is not an Excel (.xlsx) file.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true);
    const raw = u8.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error('Unsupported compression in the Excel file.');
    files[name] = dec.decode(data);
  }
  return files;
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** -> { sheetName: any[][] } (strings, numbers, booleans, or null). */
export async function readWorkbook(buf) {
  const files = await unzip(buf);
  if (!files['xl/workbook.xml']) throw new Error('That Excel file has no workbook inside it (macro-only or damaged).');
  const shared = files['xl/sharedStrings.xml']
    ? kids(xml(files['xl/sharedStrings.xml']), 'si').map((si) => kids(si, 't').map((t) => t.textContent).join(''))
    : [];
  const rels = {};
  if (files['xl/_rels/workbook.xml.rels']) for (const r of kids(xml(files['xl/_rels/workbook.xml.rels']), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const out = {};
  for (const s of kids(xml(files['xl/workbook.xml']), 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const body = files[target];
    if (!body) continue;
    const rows = [];
    for (const row of kids(xml(body), 'row')) {
      const r = Number(row.getAttribute('r')) - 1;
      const cells = [];
      for (const c of Array.from(row.children)) {
        if (c.tagName !== 'c') continue;
        const t = c.getAttribute('t');
        const vEl = c.getElementsByTagName('v')[0];
        let v = null;
        if (t === 'inlineStr') v = kids(c, 't').map((x) => x.textContent).join('');
        else if (vEl) {
          const raw = vEl.textContent;
          v = t === 's' ? shared[Number(raw)] ?? '' : t === 'b' ? raw === '1' : t === 'str' || t === 'e' ? raw : Number(raw);
        }
        cells[colIndex(c.getAttribute('r'))] = v;
      }
      rows[r] = cells;
    }
    out[s.getAttribute('name')] = Array.from(rows, (r) => r || []);
  }
  return out;
}

// ------------------------------------------------------------------ workbook -> import payload
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[?:]/g, '');
const yes = (v) => v === true || /^(y|yes|true|1)$/i.test(String(v ?? '').trim());

/** Rows following a header row that contains `first`; returns { header: lowercased names, rows: objects }. */
function table(rows, firstCol) {
  const hi = rows.findIndex((r) => norm(r[0]) === firstCol);
  if (hi < 0) return [];
  const head = rows[hi].map(norm);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((x) => x === null || x === undefined || x === '')) break;
    const o = {};
    head.forEach((k, c) => { if (k) o[k] = r[c] ?? null; });
    out.push(o);
  }
  return out;
}

const posRank = { OG: 0, OO: 1, CG: 2, CO: 3, Aff: 0, Neg: 1 };

export function workbookToImport(sheets) {
  const setup = sheets.Setup;
  if (!setup) throw new Error('This Excel file has no “Setup” sheet. Only files made by “Download Excel” can be imported.');
  const kv = {};
  for (const r of setup) { if (norm(r[0]) === 'round') break; if (r[0]) kv[norm(r[0])] = r[1]; }
  const roundsT = table(setup, 'round');
  const rankBack = (txt, labels) => String(txt ?? '').split(',').map((x) => x.trim()).map((l) => Object.keys(labels).find((k) => labels[k].toLowerCase() === l.toLowerCase())).filter(Boolean);
  const TEAM_L = { avgTeamPoints: 'Average team points', avgSpeakerScore: 'Average speaker score', avgWeighted: 'Average weighted contribution', totalTeamPoints: 'Total team points', totalSpeakerScore: 'Total speaker score', drawDifficulty: 'Draw difficulty', feedback: 'Feedback given' };
  const SP_L = { average: 'Average score', totalScore: 'Total score', weighted: 'Weighted contribution', teamPoints: 'Team points', drawDifficulty: 'Draw difficulty' };
  const tournament = {
    name: String(kv.name ?? '').trim(),
    format: kv.format,
    totalRounds: Number(kv['number of rounds']) || roundsT.length,
    weightK: kv['weighting parameter'],
    rooms: String(kv.rooms ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    minDebates: kv['debates needed to be break eligible'],
    topCount: kv['top break-eligible teams to show'],
    teamRank: rankBack(kv['rank teams by'], TEAM_L),
    speakerRank: rankBack(kv['rank speakers by'], SP_L),
    winners: kv.winners || '',
    status: /^archived/i.test(String(kv.status)) ? 'archived' : 'active',
    date: kv.date,
    rollComplete: yes(kv['roll complete']),
    feedbackOpen: yes(kv['feedback open']),
    rounds: roundsT.map((r) => ({
      round: Number(r.round), name: r.name, customName: true, topic: r.topic || '', status: r.status,
      published: yes(r['draw published']), showPlacement: yes(r['show placement']), showTeamAverage: yes(r['show team average']), showSpeakerScores: yes(r['show speaker scores']),
    })),
  };
  const out = { tournament, roll: [], decisions: [], adjudicators: [], draws: {}, results: [], feedback: [] };

  // Roll sheet (also accepts the original template's "Present?" header)
  const rollRows = sheets.Roll || [];
  for (const r of rollRows.slice(1)) {
    if (r[0] !== null && r[0] !== undefined && r[0] !== '' && r[1] !== undefined && r[1] !== null) out.roll.push({ name: String(r[0]).trim(), team: Number(r[1]), present: r[2] === null || r[2] === undefined || r[2] === '' ? true : yes(r[2]) });
    const kind = String(r[4] ?? '').toLowerCase();
    if ((kind === 'solo' || kind === 'pair') && r[5] != null && r[6]) out.decisions.push({ kind, key: String(r[5]), value: String(r[6]) });
  }
  for (const a of table(sheets.Adjudicators || [], 'name')) out.adjudicators.push({ name: String(a.name).trim(), trainee: yes(a.trainee), attending: yes(a.attending), confidence: a.confidence });

  // Round sheets -> draw (rooms, adjudicators, teams) + result rows
  for (const r of tournament.rounds) {
    const rows = table(sheets[`Round ${r.round}`] || [], 'room');
    if (!rows.length) continue;
    const rooms = [];
    let cur = null;
    const results = [];
    for (const x of rows) {
      const room = String(x.room ?? '').trim();
      if (!room) continue;
      if (!cur || cur.room !== room) { cur = { room, adjudicators: [], teams: [] }; rooms.push(cur); }
      for (const part of String(x.adjudicators ?? '').split(';')) {
        const m = /^\s*([CPT]):\s*(.+?)\s*$/.exec(part);
        if (m) cur.adjudicators.push({ role: m[1], name: m[2] });
      }
      let tm = cur.teams.find((t) => t.position === x.position);
      if (!tm) { tm = { position: x.position, team: Number(x.team), merged: yes(x['merged team']), speakers: [] }; cur.teams.push(tm); }
      tm.speakers.push({ name: String(x.speaker ?? '').trim(), originalTeam: Number(x['original team']) });
      results.push({ round: r.round, room, position: x.position, team: Number(x.team), speaker: String(x.speaker ?? '').trim(), originalTeam: Number(x['original team']), merged: yes(x['merged team']), score: x.score, placement: x.placement, teamTotal: x['team average'] });
    }
    for (const rm of rooms) rm.teams.sort((a, b) => (posRank[a.position] ?? 9) - (posRank[b.position] ?? 9));
    out.draws[r.round] = { rooms };
    if (results.some((x) => x.score !== null && x.score !== undefined && x.score !== '') || /scoring|completed/.test(r.status)) out.results.push(...results);
  }

  for (const f of table(sheets.Feedback || [], 'round')) {
    out.feedback.push({
      round: f.round, room: f.room, adjudicator: f.adjudicator, giver: f.from, score: f.overall ?? f.score,
      q_decision: f.decision, q_justification: f.justification, q_chair: f['chair management'], q_contribution: f.contribution,
      excluded: f['counts in rating'] !== null && f['counts in rating'] !== undefined && !yes(f['counts in rating']),
      source: f.source, comment: f.comment, created_at: f.submitted,
    });
  }
  return out;
}

/** Reads a .json / .xlsx / .xlsm File into an import payload. */
export async function readImportFile(file) {
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    try { return JSON.parse(await file.text()); } catch { throw new Error('That JSON file could not be read.'); }
  }
  if (/\.xls[xm]$/i.test(file.name)) return workbookToImport(await readWorkbook(await file.arrayBuffer()));
  throw new Error('Choose a .json or .xlsx file.');
}
