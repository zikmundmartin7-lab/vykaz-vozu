// Fotky pro trénink sítí: přehled, na čem se síť učí, náhledy snímků s opravou hodnoty, export do ZIPu
// (pro Google Disk a sešit v Colabu) a úklid přes koš.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { SWITCHES, plural, formatDateTime } from '../model.js';
import { FIELDS, FIELD, HAND_BRAKE, displayValue } from '../fields.js';
import { db } from '../db.js';
import { brakeModels } from '../brake.js';
import { zip, download } from '../xlsx.js';
import { Topbar, Icon, Seg, BlobImg, toast } from '../ui.js';

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
const TRAINED = ['rezim', 'naklad', 'kohout', 'rucni', 'blocks', 'axles'];
const MIN_PHOTOS = 8;

/** Hodnota snímku k zobrazení (poloha, číslo vozu s mezerami, hmotnost s jednotkou…). */
function labelText(s) {
  if (OPTIONS[s.kind]) return optionText(s.kind, s.label);
  if (FIELD[s.kind]) return displayValue(FIELD[s.kind], s.label) || s.label;
  return s.label || '—';
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
// a označeným nápisem (match = indexy řádků). labels.csv shrnuje vše.
async function buildZip(samples) {
  const files = [];
  const csv = [['soubor', 'druh', 'hodnota', 'vuz', 'porizeno', 'zdroj', 'odhad', 'jistota', 'dalsi'].join(';')];
  for (const s of samples) {
    const dir = OPTIONS[s.kind] ? `${s.kind}/${s.label}` : s.kind;
    const name = `${dir}/${s.id}.jpg`;
    files.push({ name, data: new Uint8Array(await s.blob.arrayBuffer()) });
    if (s.ocr) {
      const meta = { kind: s.kind, label: s.label, extra: s.extra, wagon: s.wagon, predicted: s.predicted,
        match: s.match, match_extra: s.match_extra, ocr: s.ocr };
      files.push({ name: `${dir}/${s.id}.json`, data: enc.encode(JSON.stringify(meta)) });
    }
    csv.push([name, s.kind, s.label, s.wagon, s.created_at, s.source ?? 'karta', s.predicted?.label, s.predicted?.prob?.toFixed(3),
      s.extra ? JSON.stringify(s.extra) : '']
      .map(csvCell).join(';'));
  }
  files.push({ name: 'labels.csv', data: enc.encode(`﻿${csv.join('\n')}\n`) });
  return zip(files, 'application/zip');
}

/** Snímek s rámečky přečtených řádků: zeleně ten, který vozmistr potvrdil jako hledaný údaj. */
function SampleImage({ s }) {
  const ocr = s.ocr;
  const hit = new Set([...(s.match ?? []), ...(s.match_extra?.hand_t ?? [])]);
  return html`<div class="sample-img">
    <${BlobImg} blob=${s.blob} />
    ${ocr && html`<svg viewBox=${`0 0 ${ocr.w} ${ocr.h}`} preserveAspectRatio="none" aria-hidden="true">
      ${ocr.lines.map((l, i) => html`<rect x=${l.x} y=${l.y} width=${l.w} height=${l.h}
        class=${hit.has(i) ? 'hit' : ''} />`)}
    </svg>`}
  </div>`;
}

/** Detail snímku: co se uložilo, oprava hodnoty, přesun do koše. */
function SampleDetail({ s, onClose, onChange }) {
  const [label, setLabel] = useState(s.label ?? '');
  const changed = label !== (s.label ?? '');

  async function save() {
    await db.updateSample({ ...s, label, relabeled_at: new Date().toISOString() });
    toast('Hodnota opravena.');
    onChange();
  }
  async function trash() {
    if (!confirm('Přesunout tento snímek do koše? Do tréninku pak nepůjde.')) return;
    await db.trashSample(s);
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
        ${[s.wagon && `vůz ${s.wagon}`, formatDateTime(s.created_at), s.source === 'trenink' ? 'z tréninku' : 'z karty vozu',
          s.exported_at ? 'vyexportováno' : 'zatím neexportováno'].filter(Boolean).join(' · ')}
        ${s.predicted?.label != null && html`<br />Aplikace četla: ${labelText({ ...s, label: s.predicted.label })}`}
        ${s.extra && html`<br />Navíc: ${Object.entries(s.extra).filter(([, v]) => v != null).map(([k, v]) => `${k} = ${v}`).join(', ')}`}
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
    </div>
  </div>`;
}

/** Náhledy snímků jednoho druhu (u voleb po polohách), nejnovější první. */
function Gallery({ kind, list, onOpen }) {
  const [limit, setLimit] = useState(24);
  const groups = OPTIONS[kind]
    ? OPTIONS[kind].map(([v, t]) => [t, list.filter((s) => s.label === v)]).filter(([, l]) => l.length)
    : [[null, list]];
  return html`${groups.map(([title, items]) => html`
    ${title && html`<div class="field-title">${title} (${items.length})</div>`}
    <div class="gallery">
      ${items.slice(0, limit).map((s) => html`<button type="button" class="thumb" onClick=${() => onOpen(s)} title=${labelText(s)}>
        <${BlobImg} blob=${s.blob} />
        ${!OPTIONS[kind] && html`<span>${labelText(s)}</span>`}
      </button>`)}
    </div>
    ${items.length > limit && html`<button class="linkbtn small" onClick=${() => setLimit(limit + 48)}>Zobrazit další (${items.length - limit})</button>`}
  `)}`;
}

export function DataView() {
  const [models, setModels] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const [all, setAll] = useState(null);
  const load = () => db.samples().then((list) => setAll(list.sort((a, b) => b.created_at.localeCompare(a.created_at))));
  useEffect(() => { load(); brakeModels().then(setModels); }, []);

  if (!all) return html`<${Topbar} title="Data pro trénink" back="#/" /><main><p class="muted">Načítám…</p></main>`;

  const samples = all.filter((s) => !s.deleted_at);
  const trash = all.filter((s) => s.deleted_at);
  const fresh = samples.filter((s) => !s.exported_at);
  const byKind = {};
  for (const s of samples) (byKind[s.kind] ??= []).push(s);
  const counts = (kind) => (byKind[kind] ?? []).reduce((c, s) => ((c[s.label] = (c[s.label] ?? 0) + 1), c), {});

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
      for (const s of list) if (!s.exported_at) await db.updateSample({ ...s, exported_at: now });
      toast(`Vyexportováno ${plural(list.length, 'fotka', 'fotky', 'fotek')} (${(file.size / 1048576).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} MB).`);
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

  async function emptyTrash() {
    if (!confirm(`Trvale smazat ${fotek(trash.length)} z koše? Vrátit to už nepůjde.`)) return;
    for (const s of trash) await db.purgeSample(s.id);
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
          <p class="hint" style="margin-top:.2rem">Ťukněte na snímek: uvidíte, co přesně se uložilo, a můžete opravit hodnotu nebo ho dát do koše.</p>
          <${Gallery} kind=${kind} list=${list} onOpen=${setOpen} />
        </details>`;
      })}
      ${!samples.length && html`<div class="notice info">Zatím žádné snímky. Nasbírejte je tlačítkem Snímat pro trénink.</div>`}

      <div class="card">
        <p style="margin-top:0">Nových fotek k exportu: <b>${fresh.length}</b> (celkem ${samples.length}).</p>
        <div class="row">
          <button class="btn primary" disabled=${busy || !fresh.length} onClick=${() => exportZip(fresh)}>
            <${Icon} name="share" /> ${busy ? 'Připravuji…' : 'Exportovat nové'}</button>
          <button class="btn" disabled=${busy || !samples.length} onClick=${() => exportZip(samples)}>Exportovat vše</button>
        </div>
        <p class="hint">V nabídce sdílení zvolte <b>Disk</b> a složku <b>Vykaz_vozu_data</b> (nebo <b>Uložit do Souborů</b>).
          Na Disku musí být soubor <b>.zip</b> o velikosti v MB – ne text s názvem. Opravené hodnoty se do Colabu
          dostanou novým exportem (<b>Exportovat vše</b>).</p>
        <button class="linkbtn small" disabled=${busy || !samples.length} onClick=${() => exportZip(samples, 'download')}>
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
        <p style="margin-top:0">V koši je ${fotek(trash.length)}. Do exportu ani do tréninku nejdou.</p>
        <div class="row">
          <button class="btn" onClick=${restoreAll}>Obnovit vše</button>
          <button class="btn danger" onClick=${emptyTrash}>Vysypat koš</button>
        </div>
      </div>`}
    </main>
    ${open && html`<${SampleDetail} s=${open} onClose=${() => setOpen(null)} onChange=${() => { setOpen(null); load(); }} />`}`;
}
