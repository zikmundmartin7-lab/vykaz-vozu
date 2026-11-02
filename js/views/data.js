// Fotky pro trénink sítí: přehled, na čem se síť učí, vozy (hledání podle posledního čtyřčíslí, karta vozu se všemi
// jeho snímky), náhledy snímků s opravou hodnoty a porovnáním s fotkou téhož vozu s jinou hodnotou, export do ZIPu
// (pro Google Disk a sešit v Colabu) a úklid přes koš.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { SWITCHES, plural, formatDate, formatDateTime, formatNumber } from '../model.js';
import { FIELDS, FIELD, HAND_BRAKE, LOAD_LABELS, displayValue, parseRevision } from '../fields.js';
import { db } from '../db.js';
import { brakeModels } from '../brake.js';
import { seriesInfo } from '../series.js';
import { zip, download } from '../xlsx.js';
import { Topbar, Icon, Seg, BlobImg, WagonNumber, LastFourSearch, matchesLastFour, toast } from '../ui.js';

// Druhy s volbou tlačítkem (přestavovače, nápravy, špalíky): fotky po složkách podle polohy, počty po polohách.
const OPTIONS = {
  ...Object.fromEntries(Object.entries(SWITCHES).map(([k, s]) => [k, s.options])),
  ...Object.fromEntries(FIELDS.filter((f) => f.type === 'switch').map((f) => [f.key, f.options])),
  hand_frame: HAND_BRAKE.filter(([v]) => v !== 'nema'),   // popisek = barva rámečku
};
const optionText = (kind, v) => OPTIONS[kind]?.find(([x]) => x === v)?.[1] ?? v;

const KINDS = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.title])),
  ...Object.fromEntries(Object.entries(SWITCHES).map(([k, s]) => [k, s.title])),
  hand_frame: 'Rámeček síly zajišťovací brzdy (výřez)',
  hand_t: 'Síla zajišťovací brzdy (dřívější samostatný krok)',
  napis: 'Nápisy na voze (karta vozu)',
  rid: 'Tabulky RID',
};

// Co sešit training/trenink_prestavovacu.ipynb trénuje: síť na polohu z celé fotky (MIN_FOTEK v sešitu).
// Nápravy se nefotí (počet je z čísla vozu); starší snímky náprav zůstávají jen v přehledu.
const TRAINED = ['rezim', 'naklad', 'kohout', 'rucni', 'blocks'];
const MIN_PHOTOS = 8;

/** Hodnota snímku k zobrazení (poloha, číslo vozu s mezerami, hmotnost s jednotkou…). */
function labelText(s) {
  if (OPTIONS[s.kind]) return optionText(s.kind, s.label);
  if (FIELD[s.kind]) return displayValue(FIELD[s.kind], s.label) || s.label;
  return s.label || '—';
}

// Polohy přestavovačů a páky se mezi dny měnit můžou – porovnávají se jen fotky téhož vozu ze stejného dne.
// Ostatní údaje jsou vlastnost vozu: dvě fotky s různou hodnotou = jedna je špatně.
const STATES = ['rezim', 'naklad', 'kohout', 'rucni'];
const day = (s) => new Date(s.created_at).toDateString();
const valueKey = (s) => (s.kind === 'revize' ? parseRevision(s.label).date : String(s.label ?? ''));

/** id snímku → jiné snímky téhož vozu a údaje s jinou hodnotou (u poloh jen ze stejného dne). */
function conflicts(samples) {
  const groups = {};
  for (const s of samples) if (s.wagon) (groups[`${s.wagon}|${s.kind}`] ??= []).push(s);
  const out = {};
  for (const list of Object.values(groups)) {
    for (const s of list) {
      const other = list.filter((o) => o.id !== s.id && valueKey(o) !== valueKey(s) && (!STATES.includes(s.kind) || day(o) === day(s)));
      if (other.length) out[s.id] = other;
    }
  }
  return out;
}

/** Je druh připravený k tréninku? Aspoň dvě polohy s MIN_PHOTOS snímky; jinak co chybí. */
function readiness(kind, counts) {
  const opts = OPTIONS[kind].map(([v]) => v);
  const enough = opts.filter((v) => (counts[v] ?? 0) >= MIN_PHOTOS);
  if (enough.length >= 2) return { ready: true, text: `připraveno – trénovat se bude ${enough.map((v) => optionText(kind, v)).join(', ')}` };
  // nejbližší dvě polohy k cíli
  const missing = opts.map((v) => [v, MIN_PHOTOS - (counts[v] ?? 0)]).sort((a, b) => a[1] - b[1]).slice(0, 2).filter(([, n]) => n > 0);
  return { ready: false, text: `chybí ještě ${missing.map(([v, n]) => `${optionText(kind, v)} ${n}×`).join(', ')}` };
}

const enc = new TextEncoder();
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Struktura ZIPu: <druh>/<poloha>/<id>.jpg u přestavovačů (přímo pro torchvision ImageFolder),
// <druh>/<id>.jpg u ostatních; u snímků z tréninku navíc <id>.json s přečteným textem, rámečky řádků
// a označeným nápisem (match = indexy řádků). labels.csv shrnuje vše; snímky vyřazené z tréninku (koš u fotky
// už vyexportované) jsou v něm jen řádkem se smazano = 1, bez fotky – sešit je vynechá i ze starších ZIPů.
async function buildZip(samples) {
  const files = [];
  const csv = [['soubor', 'druh', 'hodnota', 'vuz', 'porizeno', 'zdroj', 'odhad', 'jistota', 'dalsi', 'smazano'].join(';')];
  for (const s of samples) {
    const dir = OPTIONS[s.kind] ? `${s.kind}/${s.label}` : s.kind;
    const name = `${dir}/${s.id}.jpg`;
    if (s.deleted_at) {
      csv.push([name, s.kind, s.label, s.wagon, s.created_at, s.source ?? 'karta', '', '', '', '1'].map(csvCell).join(';'));
      continue;
    }
    files.push({ name, data: new Uint8Array(await s.blob.arrayBuffer()) });
    if (s.ocr) {
      const meta = { kind: s.kind, label: s.label, extra: s.extra, wagon: s.wagon, predicted: s.predicted,
        match: s.match, match_extra: s.match_extra, ocr: s.ocr };
      files.push({ name: `${dir}/${s.id}.json`, data: enc.encode(JSON.stringify(meta)) });
    }
    csv.push([name, s.kind, s.label, s.wagon, s.created_at, s.source ?? 'karta', s.predicted?.label, s.predicted?.prob?.toFixed(3),
      s.extra ? JSON.stringify(s.extra) : '', '']
      .map(csvCell).join(';'));
  }
  files.push({ name: 'labels.csv', data: enc.encode(`﻿${csv.join('\n')}\n`) });
  return zip(files, 'application/zip');
}

/** Snímek s rámečky přečtených řádků: zeleně ten, který vozmistr potvrdil jako hledaný údaj. */
function SampleImage({ s }) {
  const ocr = s.ocr;
  const hit = new Set([...(s.match ?? []), ...Object.values(s.match_extra ?? {}).flat()]);
  return html`<div class="sample-img">
    <${BlobImg} blob=${s.blob} />
    ${ocr && html`<svg viewBox=${`0 0 ${ocr.w} ${ocr.h}`} preserveAspectRatio="none" aria-hidden="true">
      ${ocr.lines.map((l, i) => html`<rect x=${l.x} y=${l.y} width=${l.w} height=${l.h}
        class=${hit.has(i) ? 'hit' : ''} />`)}
    </svg>`}
  </div>`;
}

/**
 * Detail snímku: co se uložilo, oprava hodnoty, přesun do koše; others = fotky téhož vozu s jinou hodnotou
 * (ukážou se pod ním k porovnání, ťuknutím se otevřou).
 */
function SampleDetail({ s, others = [], onOpen, onClose, onChange }) {
  const [label, setLabel] = useState(s.label ?? '');
  useEffect(() => setLabel(s.label ?? ''), [s.id]);
  const changed = label !== (s.label ?? '');
  const inColab = s.exported_once || Boolean(s.exported_at);

  // opravená fotka jde znovu s „Exportovat nové“ – sešit bere hodnotu z posledního exportu, kde fotka je
  async function save() {
    await db.updateSample({ ...s, label, relabeled_at: new Date().toISOString(), exported_at: null, exported_once: inColab });
    toast(inColab ? 'Hodnota opravena – do Colabu půjde s příštím exportem.' : 'Hodnota opravena.');
    onChange();
  }
  async function trash() {
    if (!confirm(inColab ? 'Přesunout tento snímek do koše? Z tréninku v Colabu se vyřadí s příštím exportem (Exportovat nové).'
      : 'Přesunout tento snímek do koše? Do tréninku pak nepůjde.')) return;
    await db.trashSample(s, true);
    toast('Snímek je v koši.');
    onChange();
  }

  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet-panel">
      <div class="row" style="margin-bottom:.5rem">
        <h2 style="margin:0;flex:1">${KINDS[s.kind] ?? s.kind}</h2>
        <button class="iconbtn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="close" /></button>
      </div>
      <${SampleImage} s=${s} />
      <p class="small muted" style="margin:.5rem 0">
        ${s.wagon && html`<a href=${`#/data/vuz/${s.wagon}`}>vůz ${formatNumber(s.wagon)}</a> · `}
        ${[formatDateTime(s.created_at), s.source === 'trenink' ? 'z tréninku' : 'z karty vozu',
          s.exported_at ? 'vyexportováno' : inColab ? 'opraveno, zatím neexportováno' : 'zatím neexportováno'].join(' · ')}
        ${s.predicted?.label != null && html`<br />Aplikace četla: ${labelText({ ...s, label: s.predicted.label })}`}
        ${s.extra && html`<br />Navíc: ${Object.entries(s.extra).filter(([, v]) => v != null).map(([k, v]) => `${LOAD_LABELS[k] ?? k} = ${v}`).join(', ')}`}
      </p>
      <div class="field-title">Hodnota, na které se síť učí</div>
      ${OPTIONS[s.kind]
        ? html`<${Seg} value=${label} options=${OPTIONS[s.kind]} onChange=${setLabel} />`
        : html`<input class="input" value=${label} onInput=${(e) => setLabel(e.target.value)} />
            <div class="hint">${labelText({ ...s, label })}</div>`}
      <div class="row" style="margin-top:.8rem">
        <button class="btn danger" onClick=${trash}><${Icon} name="trash" size=${18} /> Do koše</button>
        <span class="spacer"></span>
        <button class="btn primary" disabled=${!changed} onClick=${save}><${Icon} name="check" size=${18} /> Uložit opravu</button>
      </div>
      ${others.length > 0 && html`<div class="compare">
        <div class="field-title"><b>⚠ ${others.length > 1 ? 'Jiné fotky' : 'Jiná fotka'} tohoto vozu ${others.length > 1 ? 'mají' : 'má'} jinou hodnotu${
          STATES.includes(s.kind) ? ' (ze stejného dne)' : ''}</b> – ťuknutím otevřete a opravíte</div>
        ${others.map((o) => html`<div key=${o.id} onClick=${() => onOpen(o)}>
          <${SampleImage} s=${o} />
          <p class="small" style="margin:.3rem 0 .6rem"><b>${labelText(o)}</b> · ${formatDateTime(o.created_at)}</p>
        </div>`)}
      </div>`}
    </div>
  </div>`;
}

/**
 * Náhledy snímků jednoho druhu (u voleb po polohách), nejnovější první; bad = rozpory (červeně orámované),
 * flat = bez dělení po polohách, hodnota u každého náhledu (karta vozu).
 */
function Gallery({ kind, list, onOpen, bad = {}, flat = false }) {
  const [limit, setLimit] = useState(24);
  const groups = OPTIONS[kind] && !flat
    ? OPTIONS[kind].map(([v, t]) => [t, list.filter((s) => s.label === v)]).filter(([, l]) => l.length)
    : [[null, list]];
  return html`${groups.map(([title, items]) => html`
    ${title && html`<div class="field-title">${title} (${items.length})</div>`}
    <div class="gallery">
      ${items.slice(0, limit).map((s) => html`<button type="button" class=${`thumb ${bad[s.id] ? 'bad' : ''}`} onClick=${() => onOpen(s)}
        title=${bad[s.id] ? `${labelText(s)} – jiná fotka vozu: ${bad[s.id].map(labelText).join(', ')}` : labelText(s)}>
        <${BlobImg} blob=${s.blob} />
        ${(flat || !OPTIONS[kind] || bad[s.id]) && html`<span>${bad[s.id] ? '⚠ ' : ''}${labelText(s)}</span>`}
      </button>`)}
    </div>
    ${items.length > limit && html`<button class="linkbtn small" onClick=${() => setLimit(limit + 48)}>Zobrazit další (${items.length - limit})</button>`}
  `)}`;
}

const WAGONS_SHOWN = 6;
const kindsIn = (list) => [...Object.keys(KINDS), ...new Set(list.map((s) => s.kind))].filter((k, i, a) => a.indexOf(k) === i && list.some((s) => s.kind === k));

/** Data pro trénink; wagon = číslo vozu (nebo „-“ = snímky bez čísla) → karta vozu se všemi jeho snímky. */
export function DataView({ wagon = null }) {
  const [models, setModels] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [allWagons, setAllWagons] = useState(false);
  const [series, setSeries] = useState(null);

  const [all, setAll] = useState(null);
  const load = () => db.samples().then((list) => setAll(list.sort((a, b) => b.created_at.localeCompare(a.created_at))));
  useEffect(() => { load(); brakeModels().then(setModels); }, []);
  useEffect(() => {
    setOpen(null);
    setSeries(null);
    if (wagon && wagon !== '-') seriesInfo(wagon).then((i) => setSeries(i?.series ?? null)).catch(() => {});
  }, [wagon]);

  if (!all) return html`<${Topbar} title="Data pro trénink" back="#/" /><main><p class="muted">Načítám…</p></main>`;

  const samples = all.filter((s) => !s.deleted_at);
  const trash = all.filter((s) => s.deleted_at);
  const fresh = samples.filter((s) => !s.exported_at);
  // fotky v koši, které už jsou v Colabu: příští export je tam nahlásí jako smazané
  const removed = trash.filter((s) => s.removed);
  const gone = removed.filter((s) => !s.exported_at);
  // poslední export = fotky s nejnovějším razítkem (každý export razítko přepíše všem fotkám v něm)
  const exported = [...samples, ...removed];
  const lastStamp = exported.reduce((m, s) => (s.exported_at && s.exported_at > m ? s.exported_at : m), '');
  const last = lastStamp ? exported.filter((s) => s.exported_at === lastStamp) : [];
  const byKind = {};
  for (const s of samples) (byKind[s.kind] ??= []).push(s);
  const counts = (kind) => (byKind[kind] ?? []).reduce((c, s) => ((c[s.label] = (c[s.label] ?? 0) + 1), c), {});
  const clash = conflicts(samples);
  const detail = open && html`<${SampleDetail} key=${open.id} s=${open} others=${clash[open.id] ?? []} onOpen=${setOpen}
    onClose=${() => setOpen(null)} onChange=${() => { setOpen(null); load(); }} />`;

  if (wagon !== null) {
    const list = samples.filter((s) => (s.wagon || '-') === wagon);
    const nbad = list.filter((s) => clash[s.id]).length;
    const days = [...new Set(list.map((s) => formatDate(s.created_at)))].join(', ');
    return html`
      <${Topbar} title=${wagon === '-' ? 'Bez čísla vozu' : formatNumber(wagon)} back="#/data" />
      <main>
        <div class="card wagon-big">
          ${wagon === '-' ? html`<span class="number">Bez čísla vozu</span>` : html`<${WagonNumber} number=${wagon} />`}
          <p class="small muted" style="margin:.3rem 0 0">${[series && `řada ${series}`, plural(list.length, 'snímek', 'snímky', 'snímků'), days]
            .filter(Boolean).join(' · ')}</p>
        </div>
        ${nbad > 0 && html`<div class="notice bad">⚠ ${plural(nbad, 'snímek má', 'snímky mají', 'snímků má')} jinou hodnotu než jiná fotka
          téhož údaje (červeně orámované). Ťukněte – pod fotkou uvidíte tu druhou k porovnání.</div>`}
        ${kindsIn(list).map((kind) => html`<div class="card" key=${kind}>
          <h2>${KINDS[kind] ?? kind}</h2>
          <${Gallery} kind=${kind} list=${list.filter((s) => s.kind === kind)} onOpen=${setOpen} bad=${clash} flat />
        </div>`)}
        ${!list.length && html`<div class="notice info">Tento vůz nemá žádné snímky (možná jsou v koši).</div>`}
      </main>
      ${detail}`;
  }

  // vozy se snímky, nejnovější první; bez čísla vozu jako jeden řádek
  const byWagon = {};
  for (const s of samples) (byWagon[s.wagon || '-'] ??= []).push(s);
  const wagonRows = Object.entries(byWagon).map(([w, list]) => ({ w, list, bad: list.filter((s) => clash[s.id]).length }))
    .sort((a, b) => b.list[0].created_at.localeCompare(a.list[0].created_at));
  const foundRows = q ? wagonRows.filter((r) => r.w !== '-' && matchesLastFour(r.w, q)) : wagonRows;
  const shownRows = q || allWagons ? foundRows : foundRows.slice(0, WAGONS_SHOWN);

  // how = 'share' (nabídka sdílení telefonu) nebo 'download' (stažení souboru, v iPhonu do Souborů → Stažené)
  async function exportZip(list, how = 'share') {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const file = new File([await buildZip(list)], `vykaz_data_${stamp}.zip`, { type: 'application/zip' });
      if (how === 'share' && navigator.canShare?.({ files: [file] })) {
        // jen soubor, bez názvu a textu: aplikace Disk v iPhonu jinak uloží místo ZIPu jen text s názvem
        try { await navigator.share({ files: [file] }); } catch (e) { if (e.name === 'AbortError') { setBusy(false); return; } throw e; }
      } else download(file, file.name);
      const now = new Date().toISOString();
      for (const s of list) await db.updateSample({ ...s, exported_at: now, exported_once: true });
      const nGone = list.filter((s) => s.deleted_at).length;
      toast(`Vyexportováno ${plural(list.length - nGone, 'fotka', 'fotky', 'fotek')}${nGone ? `, vyřazeno ${nGone}` : ''}`
        + ` (${(file.size / 1048576).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} MB).`);
      await load();
    } catch (e) {
      toast(`Export se nepovedl: ${e.message}`);
    }
    setBusy(false);
  }

  const fotek = (n) => plural(n, 'fotku', 'fotky', 'fotek');

  async function toTrash(list, question) {
    if (!list.length || !confirm(question)) return;
    for (const s of list) await db.trashSample(s);
    toast(`${plural(list.length, 'fotka přesunuta', 'fotky přesunuty', 'fotek přesunuto')} do koše.`);
    await load();
  }

  async function restoreAll() {
    for (const s of trash) await db.restoreSample(s);
    toast(`Obnoveno: ${plural(trash.length, 'fotka', 'fotky', 'fotek')}.`);
    await load();
  }

  // fotky, jejichž vyřazení ještě nešlo do Colabu, zůstanou v koši až do exportu (jinak by se tam trénovaly dál)
  async function emptyTrash() {
    const purge = trash.filter((s) => !gone.includes(s));
    if (!purge.length) return toast('V koši jsou jen fotky, které se musí nejdřív vyřadit i z Colabu – dejte Exportovat nové.');
    if (!confirm(`Trvale smazat ${fotek(purge.length)} z koše? Vrátit to už nepůjde.${gone.length
      ? ` Fotky k vyřazení z Colabu (${gone.length}) zůstanou v koši do příštího exportu.` : ''}`)) return;
    for (const s of purge) await db.purgeSample(s.id);
    toast('Koš vysypán.');
    await load();
  }

  return html`
    <${Topbar} title="Data pro trénink" back="#/" />
    <main>
      <a class="btn primary block" href="#/trenink" style="margin-bottom:12px"><${Icon} name="camera" /> Snímat pro trénink</a>

      <div class="card">
        <h2>Na čem se síť učí</h2>
        <p class="small muted" style="margin-top:0">Síť na polohu se natrénuje u údaje, který má aspoň dvě polohy,
          každou s ${MIN_PHOTOS} a více snímky. Snímky nápisů se zatím sbírají pro pozdější doučení čtení textu.</p>
        <ul class="train-list">
          ${TRAINED.map((kind) => {
            const r = readiness(kind, counts(kind));
            return html`<li><span>${KINDS[kind]}</span>
              ${models[kind] ? html`<b class="okc">síť nasazena</b>` : html`<b class=${r.ready ? 'okc' : 'muted'}>${r.text}</b>`}</li>`;
          })}
          <li><span>Nápisy (číslo, hmotnost, kN, délka, rychlost, revize)</span>
            <b class="muted">${fotek(['cislo', 'tare', 'hand_kn', 'length', 'speed', 'revize'].reduce((n, k) => n + (byKind[k]?.length ?? 0), 0))} – sbírá se</b></li>
        </ul>
      </div>

      ${samples.length > 0 && html`<div class="card">
        <h2>Vozy</h2>
        <${LastFourSearch} value=${q} onChange=${setQ} />
        <ul class="wagon-list">
          ${shownRows.map((r) => html`<li key=${r.w}><a href=${`#/data/vuz/${r.w}`}>
            ${r.w === '-' ? html`<span class="number">Bez čísla vozu</span>` : html`<${WagonNumber} number=${r.w} />`}
            ${r.bad > 0 && html`<span class="chip bad">⚠ porovnat ${r.bad}</span>`}
            <span class="small muted">${plural(r.list.length, 'snímek', 'snímky', 'snímků')} · ${formatDateTime(r.list[0].created_at)}</span>
          </a></li>`)}
        </ul>
        ${q && !foundRows.length && html`<p class="muted small">Žádný vůz se snímky nekončí na ${q}.</p>`}
        ${!q && !allWagons && foundRows.length > WAGONS_SHOWN && html`<button class="linkbtn small" onClick=${() => setAllWagons(true)}>
          Zobrazit všechny vozy (${foundRows.length})</button>`}
      </div>`}

      ${Object.entries(KINDS).filter(([kind]) => byKind[kind]?.length).map(([kind, title]) => {
        const list = byKind[kind];
        const c = counts(kind);
        return html`<details class="card kind">
          <summary>
            <span class="kind-title">${title}</span>
            <span class="chips">${OPTIONS[kind]
              ? OPTIONS[kind].filter(([v]) => c[v]).map(([v]) => html`<span class="chip">${optionText(kind, v)}: ${c[v]}</span>`)
              : html`<span class="chip">${plural(list.length, 'fotka', 'fotky', 'fotek')}</span>`}</span>
          </summary>
          <p class="hint" style="margin-top:.2rem">Ťukněte na snímek: uvidíte, co přesně se uložilo, a můžete opravit hodnotu nebo ho dát do koše.
            Červeně orámované mají jinou hodnotu než jiná fotka téhož vozu.</p>
          <${Gallery} kind=${kind} list=${list} onOpen=${setOpen} bad=${clash} />
        </details>`;
      })}
      ${!samples.length && html`<div class="notice info">Zatím žádné snímky. Nasbírejte je tlačítkem Snímat pro trénink.</div>`}

      <div class="card">
        <p style="margin-top:0">Nových a opravených fotek k exportu: <b>${fresh.length}</b> (celkem ${samples.length})${
          gone.length ? html`, k vyřazení z Colabu: <b>${gone.length}</b>` : ''}.</p>
        <div class="row">
          <button class="btn primary" disabled=${busy || !(fresh.length + gone.length)} onClick=${() => exportZip([...fresh, ...gone])}>
            <${Icon} name="share" /> ${busy ? 'Připravuji…' : 'Exportovat nové'}</button>
          <button class="btn" disabled=${busy || !samples.length} onClick=${() => exportZip([...samples, ...removed])}>Exportovat vše</button>
        </div>
        ${last.length > 0 && html`<button class="btn block" style="margin-top:.5rem" disabled=${busy} onClick=${() => exportZip(last)}>
          <${Icon} name="share" size=${18} /> Zopakovat poslední export (${formatDateTime(lastStamp)}, ${fotek(last.length)})</button>`}
        <p class="hint">V nabídce sdílení zvolte <b>Disk</b> a složku <b>Vykaz_vozu_data</b>. Bez signálu <b>Uložit do Souborů</b>
          → <b>Na iPhonu</b> a doma ze Souborů na Disk. Když se nahrání nepovede, <b>Zopakovat poslední export</b> pošle
          stejné fotky znovu. Na Disku musí být soubor <b>.zip</b> o velikosti v MB – ne text s názvem. Opravená fotka
          i fotka dána do koše v detailu snímku se do Colabu dostanou s <b>Exportovat nové</b> (smazaná se tam vyřadí).
          Hromadné mazání dole jen uvolní místo v telefonu – v Colabu fotky zůstanou.</p>
        <button class="linkbtn small" disabled=${busy || !samples.length} onClick=${() => exportZip([...samples, ...removed], 'download')}>
          <${Icon} name="download" size=${16} /> Stáhnout všechno jako ZIP do telefonu</button>
        <div class="row" style="margin-top:.4rem">
          <button class="linkbtn small danger"
            onClick=${() => toTrash(samples.filter((s) => s.exported_at), `Přesunout ${fotek(samples.filter((s) => s.exported_at).length)} (už vyexportované) do koše?`)}>
            Smazat vyexportované</button>
          <span class="spacer"></span>
          <button class="btn small danger" disabled=${!samples.length}
            onClick=${() => toTrash(samples, `Přesunout všechny fotky do koše (${plural(samples.length, 'fotka', 'fotky', 'fotek')})? Z koše je jde obnovit.`)}>
            <${Icon} name="trash" size=${18} /> Smazat všechny fotky</button>
        </div>
      </div>

      ${trash.length > 0 && html`<div class="card">
        <h2><${Icon} name="trash" size=${18} /> Koš</h2>
        <p style="margin-top:0">V koši: ${plural(trash.length, 'fotka', 'fotky', 'fotek')}. Do exportu ani do tréninku nejdou.${gone.length
          ? ` Už v Colabu: ${gone.length} – vyřadí se tam s příštím Exportovat nové.` : ''}</p>
        <div class="row">
          <button class="btn" onClick=${restoreAll}>Obnovit vše</button>
          <button class="btn danger" onClick=${emptyTrash}>Vysypat koš</button>
        </div>
      </div>`}
    </main>
    ${detail}`;
}
