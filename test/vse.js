// Zkoušky čtení všech sad najednou (test/vse.html) – fotky jsou jen lokálně v test/img (mimo git).
// Každá zkouška je položka { id, sekce, chci, mam, ok, vazne }; vazne = číslo vozu přijaté jako jisté, ale cizí
// (do výkazu by se zapsal jiný vůz). Přečtený text fotek se ukládá do test/img/_vse/ocr_<sada>.json pod otiskem
// ocr.js, ort.js a sítí: změna pravidel (model.js, fields.js, frame.js) se tak změří bez nového čtení a bez šumu
// čtení (to se při opakování trochu liší). Základ k porovnání: test/img/_vse/zaklad.json. Ukládat umí jen test/server.py.

import { loadOcr, readText, readLine, sortLines } from '../js/ocr.js';
import { numberCandidates, indexWagons, formatNumber } from '../js/model.js';
import { FIELD, extractField, extractHandT, extractLoadBrake, parseRevision, readRevisionYears } from '../js/fields.js';
import { handBrakeFrame, hull } from '../js/frame.js';

const DIR = '/test/img';
const SAVE = `${DIR}/_vse`;
const NUMBER_DIRS = ['cisla_wa', 'cisla_1103', 'cisla_archiv'];
const EXPORTS = ['export29', 'export1102', 'eval'];
const FIELD_NAMES = { tare: 'Hmotnost', hand_kn: 'Zajišťovací síla', length: 'Délka', speed: 'Rychlost', revize: 'Revize – datum' };
const LOAD_NAMES = { empty: 'prázdný', half: '½', loaded: 'ložený', change: 'přestavná', change2: 'přestavná 2', max: 'MAX' };

const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const short = (img) => img.replace(/([0-9a-f]{8})-[0-9a-f-]{27}/, '$1');
const no = (n) => formatNumber(n);

export async function put(name, data) {
  const r = await fetch(`${SAVE}/${name}`, { method: 'PUT', body: JSON.stringify(data) }).catch(() => null);
  if (!r?.ok) throw new Error(`${name} se nepodařilo uložit – stránka musí běžet přes test/server.py`);
}

// otisk čtení: změní se s ocr.js, ort.js nebo sítěmi, pak se fotky čtou znovu
async function ocrKey() {
  const parts = await Promise.all(['/js/ocr.js', '/js/ort.js'].map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.text())));
  for (const m of ['det.onnx', 'rec_latin.onnx', 'rec_latin_dict.txt']) {
    parts.push(m + (await fetch(`/models/${m}`, { method: 'HEAD', cache: 'no-store' })).headers.get('content-length'));
  }
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')));
  return [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// size = rozměr, ve kterém je uložený text z telefonu (snímek pak jen jako plátno, bez bitmapy)
async function picture(path, size) {
  const bmp = await createImageBitmap(await fetch(path).then((r) => r.blob()));
  const c = document.createElement('canvas');
  c.width = size?.w ?? bmp.width;
  c.height = size?.h ?? bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (size) bmp.close();
  return { c, bmp };
}

// napodobený živý rámeček skeneru (jako cisla_wa.js): blok s číslem zabere ~80 % rámečku 1,53 : 1, výřez 760 px
function frameCrop(bmp, [x0, y0, x1, y1]) {
  let fw = Math.max((x1 - x0) / 0.8, ((y1 - y0) / 0.8) * 1.53);
  let fh = fw / 1.53;
  const fx = Math.max(0, Math.min(bmp.width - fw, (x0 + x1) / 2 - fw / 2));
  const fy = Math.max(0, Math.min(bmp.height - fh, (y0 + y1) / 2 - fh / 2));
  fw = Math.min(fw, bmp.width - fx);
  fh = Math.min(fh, bmp.height - fy);
  const c = document.createElement('canvas');
  c.width = 760;
  c.height = Math.round((fh * 760) / fw);
  c.getContext('2d').drawImage(bmp, fx, fy, fw, fh, 0, 0, c.width, c.height);
  return c;
}

const copy = (lines) => lines.map((l) => ({ ...l }));
const replay = (s) => sortLines(copy(s.ocr.lines));

// ───── verdikty čísla vozu (stejně jako skener) ─────

function offer(list, label) {
  const i = list.findIndex((x) => x.number === label);
  if (i >= 0) return `nabídka ${i + 1}. z ${list.length}${list[i].filled ? ` (doplněno: ${list[i].filled})` : ''}`;
  return list.length ? `cizí ${list.map((x) => no(x.number)).join(', ')}` : 'nic';
}
// Vyfotit: samo se přijme jen jisté číslo, jinak nabídka nejvýš 3 čísel s platnou kontrolní číslicí
function photoVerdict(cands, label) {
  const valid = cands.filter((x) => x.valid);
  const sure = valid.find((x) => x.sure);
  if (sure) return sure.number === label ? 'ok' : `ŠPATNĚ ${no(sure.number)}`;
  return offer(valid.slice(0, 3), label);
}
// živá kamera: jisté z prvních 3 platných (hlasování přes víc snímků se tu nenapodobuje)
function liveVerdict(cands, label) {
  const top = cands.filter((x) => x.valid).slice(0, 3);
  const sure = top.find((x) => x.sure);
  if (sure) return sure.number === label ? 'ok' : `ŠPATNĚ ${no(sure.number)}`;
  return offer(top, label);
}

/**
 * Projede všechny sady. onProgress(text) hlásí postup. fresh = nebrat uložený text, číst všechno znovu.
 * synthetic = i umělé nápisy a nárazníky (test/napisy.html, test/narazniky.html ve skrytém rámu).
 */
export async function runAll({ fresh = false, synthetic = true, onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const key = await ocrKey();
  await loadOcr();
  const store = {};
  let reads = 0;
  const cache = async (set) => {
    if (!store[set]) {
      const c = fresh ? null : await json(`${SAVE}/ocr_${set}.json`);
      store[set] = c?.key === key ? { ...c, dirty: false } : { key, reads: {}, dirty: false };
    }
    return store[set];
  };
  const read = async (set, id, how) => {
    const c = await cache(set);
    if (!c.reads[id]) {
      onProgress(`čtu ${set}/${short(id)} (nově přečteno ${reads})`);
      c.reads[id] = await how();
      c.dirty = true;
      reads++;
    }
    return copy(c.reads[id]);
  };
  const flush = async () => {
    for (const [set, c] of Object.entries(store)) {
      if (c.dirty) { await put(`ocr_${set}.json`, { key: c.key, reads: c.reads }); c.dirty = false; }
    }
  };
  const items = [];
  const add = (it) => items.push({ ...it, chci: String(it.chci ?? '–'), mam: String(it.mam ?? '–'), vazne: Boolean(it.vazne) });

  // ── sady ──
  const numberSets = {};
  for (const dir of NUMBER_DIRS) {
    // cisla_archiv/p*.jpg jsou kopie fotek z cisla_1103
    numberSets[dir] = ((await json(`${DIR}/${dir}/samples.json`)) ?? []).filter((s) => !(dir === 'cisla_archiv' && s.img.startsWith('p')));
  }
  const c45 = (await json(`${DIR}/cisla/samples.json`)) ?? [];
  const exports = {};
  for (const set of EXPORTS) exports[set] = (await json(`${DIR}/${set}/${set === 'eval' ? 'labels' : 'samples'}.json`)) ?? [];
  const labels = [...new Set([
    ...Object.values(numberSets).flat().map((s) => s.label), ...c45.map((s) => s.label),
    ...Object.values(exports).flat().map((s) => s.wagon).filter(Boolean),
  ])];
  const all = indexWagons(labels);
  const scenarios = [
    ['bez paměti vozů', () => undefined],
    ['vůz v paměti', () => all],
    ['vůz mimo paměť', (label) => indexWagons(labels.filter((x) => x !== label))],
  ];
  const numberItems = (base, sekce, lines, label, verdict) => {
    for (const [name, known] of scenarios) {
      const mam = verdict(numberCandidates(copy(lines), known(label)), label);
      add({ id: `${base} · ${name}`, sekce: `${sekce} · ${name}`, chci: no(label), mam, ok: mam === 'ok', vazne: mam.startsWith('ŠPATNĚ') });
    }
  };

  // ── čísla vozů: fotky čísel (Vyfotit + napodobený rámeček) ──
  for (const dir of NUMBER_DIRS) {
    for (const s of numberSets[dir]) {
      let pic = null;
      const load = async () => (pic ??= await picture(`${DIR}/${dir}/${s.img}`));
      const photo = await read(dir, `${s.img}|fotka`, async () => readText((await load()).c, { maxSide: 1600 }));
      const live = await read(dir, `${s.img}|ramecek`, async () => readText(frameCrop((await load()).bmp, s.box)));
      pic?.bmp.close();
      numberItems(`${dir}/${s.img} · Vyfotit`, 'Číslo · Vyfotit', photo, s.label, photoVerdict);
      numberItems(`${dir}/${s.img} · rámeček`, 'Číslo · rámeček', live, s.label, liveVerdict);
    }
    await flush();
  }

  // ── čísla vozů: 45 snímků z terénu (text uložený v telefonu + znovu přečtený snímek 1280 px) ──
  for (const s of c45) {
    numberItems(`cisla/${short(s.img)} · terén`, 'Číslo · terén, text z telefonu', replay(s), s.label, liveVerdict);
    const again = await read('cisla', `${s.img}|znovu`, async () => {
      const { c, bmp } = await picture(`${DIR}/cisla/${s.img}`);
      bmp.close();
      return readText(c);
    });
    numberItems(`cisla/${short(s.img)} · znovu`, 'Číslo · terén, znovu přečtený', again, s.label, liveVerdict);
  }
  await flush();

  // ── snímky ostatních údajů: údaje podle pravidel + falešná čísla vozů ──
  for (const set of EXPORTS) {
    for (const s of exports[set]) {
      if (s.kind === 'cislo') continue;   // fotky čísel z exportů jsou v sadě 45
      const path = `${DIR}/${set}/${s.img}`;
      const variants = [];
      if (s.ocr) variants.push(['terén', async () => (await picture(path, s.ocr)).c, () => replay(s)]);
      let pic = null;
      const load = async () => (pic ??= await picture(path));
      const again = await read(set, s.img, async () => readText((await load()).c));
      variants.push(['znovu', async () => (await load()).c, () => again]);
      for (const [how, canvas, getLines] of variants) {
        const lines = getLines();
        const base = `${set}/${short(s.img)} · ${how}`;
        const sfx = how === 'terén' ? 'terén, text z telefonu' : 'znovu přečtený';

        const wrong = new Set();
        for (const k of [undefined, all]) {
          for (const x of numberCandidates(copy(lines), k)) if (x.sure && x.number !== s.wagon) wrong.add(no(x.number));
        }
        add({ id: `${base} · falešné číslo`, sekce: `Falešné číslo na snímku jiného údaje · ${sfx}`, chci: 'žádné',
          mam: wrong.size ? [...wrong].join(', ') : 'žádné', ok: !wrong.size, vazne: wrong.size > 0 });

        const needs = s.kind in FIELD_NAMES || s.kind === 'hand_t' || s.kind === 'naklad';
        if (!needs) continue;
        const c = await canvas();
        if (s.kind in FIELD_NAMES) {
          const found = extractField(FIELD[s.kind], copy(lines), c);
          if (s.kind === 'revize') {
            const want = parseRevision(s.label);
            const got = found ? parseRevision(found.value) : null;
            add({ id: `${base} · datum`, sekce: `Revize – datum · ${sfx}`, chci: want.date, mam: got?.date, ok: got?.date === want.date });
            if (want.years) {
              const y = await readRevisionYears(found, c, readLine);
              const years = y ? parseRevision(y.value).years : null;
              add({ id: `${base} · roky`, sekce: `Revize – roky · ${sfx}`, chci: want.years, mam: years, ok: years === want.years });
            }
          } else {
            add({ id: base, sekce: `${FIELD_NAMES[s.kind]} · ${sfx}`, chci: s.label, mam: found?.value, ok: String(found?.value) === String(s.label) });
          }
        }
        // síla zajišťovací brzdy (t) pod hmotností a barva jejího rámečku (jako krok Hmotnost v tréninku)
        const handT = s.kind === 'hand_t' ? s.label : s.kind === 'tare' && s.extra ? s.extra.hand_t : undefined;
        if (handT !== undefined) {
          const tare = extractField(FIELD.tare, copy(lines), c);
          const t = extractHandT(copy(lines), tare);
          const ok = handT == null ? !t : Number(t?.value) === Number(handT);
          add({ id: `${base} · síla RB`, sekce: `Síla zajišťovací brzdy (t) · ${sfx}`, chci: handT, mam: t?.value, ok });
          if (s.extra?.hand_brake) {
            const color = tare && t?.below
              ? handBrakeFrame(c, hull(tare.lines.map((i) => lines[i])), hull(t.lines.map((i) => lines[i])))?.value : null;
            const want = s.extra.hand_brake;
            add({ id: `${base} · rámeček RB`, sekce: `Rámeček ruční brzdy · ${sfx}`, chci: want, mam: color,
              ok: color === want || (want === 'nema' && !t) });
          }
        }
        if (s.kind === 'naklad') {
          const lb = extractLoadBrake(copy(lines));
          const auto = lb?.auto ? 'ano' : 'ne';
          add({ id: `${base} · samočinný`, sekce: `Samočinný přestavovač · ${sfx}`, chci: s.label === 'auto' ? 'ano' : 'ne', mam: auto,
            ok: auto === (s.label === 'auto' ? 'ano' : 'ne') });
          const keys = Object.keys(LOAD_NAMES).filter((k) => s.extra?.[k] != null);
          if (keys.length) {
            const show = (v) => keys.map((k) => `${LOAD_NAMES[k]} ${v?.[k] ?? '–'}`).join(', ');
            add({ id: `${base} · brzdicí váhy`, sekce: `Brzdicí váhy u přestavovače · ${sfx}`, chci: show(s.extra), mam: show(lb?.values),
              ok: keys.every((k) => Number(lb?.values?.[k]) === Number(s.extra[k])) });
          }
        }
      }
      pic?.bmp.close();
    }
    await flush();
  }

  // ── umělé nápisy a nárazníky (stránky v test/, mají vlastní čtení) ──
  if (synthetic) {
    onProgress('umělé nápisy (test/napisy.html)…');
    const napisy = await framePage('/test/napisy.html');
    for (const r of napisy.contentWindow.results) {
      add({ id: `nápisy/${r.name}`, sekce: 'Umělé nápisy (revize, zajišťovací síla)', chci: r.want,
        mam: `${r.got ?? '–'}${r.cells == null ? '' : ` · buněk ${r.cells}`}`, ok: r.ok });
    }
    napisy.remove();
    onProgress('umělé nárazníky (test/narazniky.html)…');
    const nar = await framePage('/test/narazniky.html');
    for (const r of JSON.parse(nar.contentDocument.getElementById('out').textContent)) {
      const want = r.kind === 'buffers' ? 'oba' : 'žádný';
      const mam = r.left && r.right ? 'oba' : r.left ? 'jen levý' : r.right ? 'jen pravý' : 'žádný';
      add({ id: `nárazníky/${r.kind} ${r.deg}° ${r.ink}`, sekce: 'Umělé nárazníky u délky', chci: want, mam, ok: mam === want });
    }
    nar.remove();
  }

  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) throw new Error(`dvakrát stejná zkouška: ${it.id}`);
    ids.add(it.id);
  }
  return { items, synthetic, ocr: key, reads, ms: Math.round(performance.now() - t0) };
}

async function framePage(url, timeout = 5 * 60e3) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:absolute;left:-2000px;top:0;width:1200px;height:800px;border:0';
  f.src = `${url}?x=${Date.now()}`;
  let failed = null;
  f.onload = () => {
    f.contentWindow.addEventListener('error', (e) => { failed = e.message; });
    f.contentWindow.addEventListener('unhandledrejection', (e) => { failed = String(e.reason); });
  };
  document.body.append(f);
  const t0 = Date.now();
  while (!f.contentWindow?.done) {
    if (failed) throw new Error(`${url}: ${failed}`);
    if (Date.now() - t0 > timeout) throw new Error(`${url} nedoběhla`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return f;
}

// ───── porovnání se základem ─────

const SYNTHETIC = /^(nápisy|nárazníky)\//;

/** Rozdíly proti základu po položkách a souhrn po sekcích; bez umělých zkoušek (?rychle) se ze základu vynechají. */
export function compare(items, base, { synthetic = true } = {}) {
  const was = Object.fromEntries(Object.entries(base?.items ?? {}).filter(([id]) => synthetic || !SYNTHETIC.test(id)));
  const now = new Map(items.map((i) => [i.id, i]));
  const out = { horsi: [], lepsi: [], jinak: [], nove: [], chybi: [] };
  for (const i of items) {
    const b = was[i.id];
    if (!b) { out.nove.push(i); continue; }
    if (b.mam === i.mam) continue;
    const d = { ...i, bylo: b.mam };
    if ((b.ok && !i.ok) || (!b.vazne && i.vazne)) out.horsi.push(d);
    else if (!b.ok && i.ok) out.lepsi.push(d);
    else out.jinak.push(d);
  }
  for (const [id, b] of Object.entries(was)) if (!now.has(id)) out.chybi.push({ id, ...b });
  const sekce = new Map();
  const row = (name) => {
    if (!sekce.has(name)) sekce.set(name, { sekce: name, n: 0, ok: 0, vazne: 0, nBase: 0, okBase: 0 });
    return sekce.get(name);
  };
  for (const i of items) {
    const r = row(i.sekce);
    r.n++;
    r.ok += i.ok;
    r.vazne += i.vazne;
  }
  for (const b of Object.values(was)) {
    const r = row(b.sekce);
    r.nBase++;
    r.okBase += b.ok;
  }
  // sekce stejného údaje pohromadě (terén a znovu přečtený se v pořadí položek střídají)
  const what = (s) => s.sekce.split(' · ')[0];
  const order = [...new Set([...sekce.values()].map(what))];
  out.sekce = [...sekce.values()].sort((a, b) => order.indexOf(what(a)) - order.indexOf(what(b)));
  out.vazne = items.filter((i) => i.vazne);
  return out;
}

export const toBase = (run, version) => ({
  ulozeno: new Date().toISOString(),
  verze: version,
  ocr: run.ocr,
  items: Object.fromEntries(run.items.map(({ id, sekce, chci, mam, ok, vazne }) => [id, { sekce, chci, mam, ok, vazne }])),
});

export const loadBase = () => json(`${SAVE}/zaklad.json`);
