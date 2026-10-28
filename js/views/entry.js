// Karta vozu ve výkazu: poloha přestavovačů (ťuknutím nebo z fotky), brzda, údaje z nápisů vozu,
// náklad a zásilka. Čísla v nadpisech (47., 52. …) odpovídají kolonkám formuláře výkazu vozidel.
// Každá fotka se uloží s polohou, kterou vozmistr nakonec potvrdil – z nich se pak učí síť.

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  SWITCHES, BRAKE_WEIGHTS, BLOCKS, WAGON_FIELDS, optionLabel, bwFor, entryMassKg, trackClass, ridFromLines,
  wagonFromEntry, formatNumber, fmt, uid, toJpeg, isCompleteNumber,
} from '../model.js';
import { db } from '../db.js';
import { readText } from '../ocr.js';
import { brakeModels, predictSwitch } from '../brake.js';
import { HAND_BRAKE, HAND_BRAKE_MEANING } from '../fields.js';
import { Topbar, Icon, Seg, NumField, NumberInput, PhotoButton, BlobImg, toast, go } from '../ui.js';

const FIELD_NO = { axles: '47.', length_m: '48.', tare_kg: '50.', hand_bw_t: '', hand_force_kn: '53.', max_speed: '57.' };

// Popisek fotky pro trénink podle konečného stavu vozu.
function labelFor(kind, e) {
  if (kind === 'cislo') return e.number;
  if (kind === 'rid') return `${e.rid_icn}/${e.rid_un}`;
  if (kind === 'napis') {
    const { number, updated_at, ...w } = wagonFromEntry(e);
    return JSON.stringify(w);
  }
  return e[kind];
}

// Čísla z přečteného nápisu jako nabídka k vyplnění („22,5 t“, „14,02 m“, „19 000 kg“, „20,2 kN“).
function numbersFromLines(lines) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    for (const m of l.text.matchAll(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d+)|\.(\d{1,2})(?!\d))?\s*(kg|kN|km\/h|t|m)?/gi)) {
      const unit = (m[4] ?? '').toLowerCase();
      const dec = m[2] ?? m[3];
      const v = Number(`${m[1].replace(/[ .]/g, '')}${dec ? `.${dec}` : ''}`);
      if (!Number.isFinite(v) || v === 0 || seen.has(`${v}${unit}`)) continue;
      seen.add(`${v}${unit}`);
      out.push({ v, unit, raw: m[0].trim() });
    }
  }
  // nejdřív hodnoty s jednotkou – ty bývají to podstatné
  return out.sort((a, b) => Boolean(b.unit) - Boolean(a.unit));
}

// Převod hodnoty z nápisu na jednotku pole (t ↔ kg).
function convert(n, unit) {
  if (unit === 'kg' && n.unit === 't') return Math.round(n.v * 1000);
  if (unit === 't' && n.unit === 'kg') return n.v / 1000;
  return n.v;
}

export function EntryView({ report, entryId, save }) {
  const index = report.entries.findIndex((x) => x.id === entryId);
  const [e, setE] = useState(report.entries[index]);
  const [photos, setPhotos] = useState([]);
  const [models, setModels] = useState({});
  const [pred, setPred] = useState({});
  const [busy, setBusy] = useState(null);
  const [lines, setLines] = useState(null);
  const [focus, setFocus] = useState(null);
  const [editNumber, setEditNumber] = useState(false);
  const latest = useRef({});
  latest.current = { report, photos, save };
  const pending = useRef(null);

  // Uložení: výkaz, popisky fotek pro trénink a údaje vozu pro příště.
  async function commit() {
    const entry = pending.current;
    if (!entry) return;
    pending.current = null;
    const { report: r, photos: ph, save: sv } = latest.current;
    await sv({ ...r, entries: r.entries.map((x) => (x.id === entry.id ? entry : x)) });
    for (const s of ph) {
      const label = labelFor(s.kind, entry);
      if (s.label !== label) await db.updateSample({ ...s, label, wagon: entry.number });
    }
    if (isCompleteNumber(entry.number)) await db.saveWagon(wagonFromEntry(entry));
  }

  useEffect(() => {
    brakeModels().then(setModels);
    Promise.all((e?.samples ?? []).map((id) => db.sample(id))).then((list) => setPhotos(list.filter((x) => x && !x.deleted_at)));
    return () => { commit(); };   // odchod z obrazovky uloží i rozepsanou změnu
  }, []);

  // Automatické ukládání chvíli po poslední změně.
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) { changed.current = true; return undefined; }
    pending.current = e;
    const t = setTimeout(commit, 300);
    return () => clearTimeout(t);
  }, [e]);

  if (!e) return html`<${Topbar} title="Vůz" back=${`#/vykaz/${report.id}`} /><main><p>Vůz ve výkazu není.</p></main>`;

  const update = (patch) => setE((prev) => ({ ...prev, ...patch }));
  const setBw = (key, v) => setE((prev) => ({ ...prev, bw: { ...prev.bw, [key]: v } }));

  async function addPhoto(kind, file) {
    setBusy(kind);
    try {
      const bmp = await createImageBitmap(file);
      const blob = await toJpeg(bmp, 1024);
      let label = e[kind];
      let predicted = null;
      let patch = {};
      if (SWITCHES[kind]) {
        const p = await predictSwitch(kind, bmp).catch(() => null);
        if (p) {
          predicted = p;
          label = p.label;
          patch = { [kind]: label };
          setPred((x) => ({ ...x, [kind]: p }));
        }
      } else if (kind === 'napis') {
        setLines(await readText(bmp, { maxSide: 1600 }));
      } else if (kind === 'rid') {
        const rid = ridFromLines(await readText(bmp, { maxSide: 1280 }));
        if (rid.un || rid.icn) patch = { rid_un: rid.un, rid_icn: rid.icn };
        toast(rid.un || rid.icn ? 'Tabulka přečtena – zkontrolujte čísla.' : 'Čísla z tabulky se nepodařilo přečíst.');
      }
      const s = { id: uid(), kind, label, blob, wagon: e.number, created_at: new Date().toISOString(), predicted };
      await db.addSample(s);
      setPhotos((x) => [...x, s]);
      setE((prev) => ({ ...prev, ...patch, samples: [...prev.samples, s.id] }));
      if (SWITCHES[kind] && !predicted) toast('Fotka uložena pro trénink sítě – polohu zvolte ťuknutím.');
    } catch (err) {
      toast(`Fotku se nepodařilo zpracovat: ${err.message}`);
    }
    setBusy(null);
  }

  async function removePhoto(s) {
    await db.trashSample(s);
    setPhotos((x) => x.filter((p) => p.id !== s.id));
    setE((prev) => ({ ...prev, samples: prev.samples.filter((id) => id !== s.id) }));
  }

  function move(delta) {
    const entries = [...report.entries];
    const to = index + delta;
    if (to < 0 || to >= entries.length) return;
    [entries[index], entries[to]] = [entries[to], { ...e }];
    save({ ...report, entries });
    toast(`Vůz je teď ${to + 1}. v pořadí.`);
  }

  async function remove() {
    if (!confirm(`Odebrat vůz ${formatNumber(e.number)} z výkazu?`)) return;
    pending.current = null;
    await save({ ...report, entries: report.entries.filter((x) => x.id !== e.id) });
    go(`#/vykaz/${report.id}`, true);
  }

  function fillFrom(n) {
    if (!focus) return toast('Nejdřív ťukněte do pole, kam hodnotu dát.');
    const v = convert(n, focus.unit);
    if (focus.key.startsWith('bw.')) setBw(focus.key.slice(3), v);
    else update({ [focus.key]: v });
    toast(`Vyplněno ${fmt(v, 3)}${focus.unit ? ` ${focus.unit}` : ''}.`);
  }

  const massKg = entryMassKg(e);
  const tc = trackClass(e);
  const thumbs = (kind) => photos.filter((s) => s.kind === kind);
  const thumbRow = (kind) => thumbs(kind).length > 0 && html`<div class="thumbs">
    ${thumbs(kind).map((s) => html`<button class="linkbtn" style="padding:0" title="Smazat fotku"
      onClick=${() => confirm('Přesunout tuto fotku do koše?') && removePhoto(s)}><${BlobImg} blob=${s.blob} /></button>`)}
  </div>`;
  const photoBtn = (kind, label, icon = 'camera') => html`<${PhotoButton} class="btn small"
    onPhoto=${(f) => addPhoto(kind, f)} disabled=${busy === kind}>
    <${Icon} name=${icon} size=${18} /> ${busy === kind ? 'Čtu…' : label}</${PhotoButton}>`;

  return html`
    <${Topbar} title=${`${index + 1}. vůz`} back=${`#/vykaz/${report.id}`} />
    <main>
      <div class="card">
        ${editNumber
          ? html`<${NumberInput} value=${e.number} onChange=${(n) => update({ number: n })} autoFocus />
              <button class="btn small" onClick=${() => setEditNumber(false)}>Hotovo</button>`
          : html`<div class="row">
              <div><div style="font-size:1.35rem;font-weight:700"><span class="number">${formatNumber(e.number)}</span></div>
                ${e.series && html`<div class="small muted">Řada ${e.series} (podle čísla)</div>`}</div>
              <span class="spacer"></span>
              <button class="linkbtn" onClick=${() => setEditNumber(true)}>Opravit</button>
            </div>`}
      </div>

      ${Object.entries(SWITCHES).map(([kind, sw]) => html`<div class="card">
        <div class="row" style="margin-bottom:.5rem">
          <h2 style="margin:0;flex:1">${sw.title}</h2>
          ${photoBtn(kind, 'Fotka')}
        </div>
        <${Seg} value=${e[kind]} options=${sw.options} onChange=${(v) => update({ [kind]: v })}
          bad=${kind === 'kohout' ? ['vypnuta'] : kind === 'rucni' ? ['zabrzdena'] : []} />
        ${pred[kind] && html`<div class="hint"><${Icon} name="brain" size=${14} /> Síť z fotky: <b>${optionLabel(kind, pred[kind].label)}</b>
          (${Math.round(pred[kind].prob * 100)} %)${pred[kind].label !== e[kind] ? ' – opraveno ručně' : ''}</div>`}
        ${!models[kind] && thumbs(kind).length > 0 && html`<div class="hint">Síť pro tento přestavovač se teprve učí – fotky se ukládají s polohou, kterou zvolíte.</div>`}
        ${kind === 'kohout' && e.kohout === 'vypnuta' && html`<div class="hint">Brzdicí váha se ve výkazu proškrtne.</div>`}
        ${kind === 'rucni' && e.rucni !== 'nema' && html`<label class="check">
          <input type="checkbox" checked=${e.hand_checked} onChange=${(ev) => update({ hand_checked: ev.target.checked })} />
          Činnost ruční brzdy ověřena (zapíše se zajišťovací síla, kolonka 53)</label>`}
        ${thumbRow(kind)}
      </div>`)}

      <div class="card">
        <div class="row" style="margin-bottom:.6rem">
          <h2 style="margin:0;flex:1">Údaje z nápisů vozu</h2>
          ${photoBtn('napis', 'Přečíst nápis', 'text')}
        </div>
        ${lines && html`<div class="notice info">
          ${lines.length === 0 ? 'Na fotce se nepodařilo nic přečíst.' : html`
            Ťukněte do pole a pak na hodnotu z nápisu:
            <div class="chips" style="margin-top:.4rem">
              ${numbersFromLines(lines).map((n) => html`<button class="chip" onClick=${() => fillFrom(n)}>${n.raw}</button>`)}
            </div>
            <details class="small" style="margin-top:.4rem"><summary>Celý přečtený text</summary>
              ${lines.map((l) => html`<div>${l.text}</div>`)}</details>`}
        </div>`}
        <div class="grid2">
          ${WAGON_FIELDS.map(([key, label, unit]) => html`<${NumField} label=${`${FIELD_NO[key]} ${label}`.trim()} unit=${unit} value=${e[key]}
            onFocus=${() => setFocus({ key, unit })} onChange=${(v) => update({ [key]: v })} />`)}
        </div>
        <label class="field"><span>Revize (nápis REV)</span>
          <input class="input" value=${e.revision ?? ''} onInput=${(ev) => update({ revision: ev.target.value })} /></label>
        ${e.series_note && html`<p class="hint err">${e.series_note}</p>`}
        <div class="field-title">Rámeček u síly zajišťovací brzdy (pod vlastní hmotností)</div>
        <${Seg} value=${e.hand_brake} options=${HAND_BRAKE} bad=${['cerveny']}
          onChange=${(v) => update({ hand_brake: v, ...(v === 'nema' ? { rucni: 'nema' } : e.rucni === 'nema' ? { rucni: 'odbrzdena' } : {}) })} />
        <div class="hint">${e.hand_brake ? html`→ <b>${HAND_BRAKE_MEANING[e.hand_brake]}</b>` : 'červený = pořádací brzda ze země · černý = ruční brzda z plošiny'}</div>
        <div class="field-title">51. Druh brzdových špalíků</div>
        <${Seg} value=${e.blocks} options=${BLOCKS.map(([v, l]) => [v, l])} onChange=${(v) => update({ blocks: e.blocks === v ? null : v })} />
        <div class="hint">${BLOCKS.find(([v]) => v === e.blocks)?.[2] ?? 'K, L, LL nekovové špalíky · D kotoučová brzda · F litinové špalíky'}</div>
        <div class="field-title">52. Brzdicí váhy z nápisu (t)</div>
        <div class="grid2">
          ${BRAKE_WEIGHTS.map(([key, label]) => html`<${NumField} label=${label} unit="t" value=${e.bw?.[key]}
            onFocus=${() => setFocus({ key: `bw.${key}`, unit: 't' })} onChange=${(v) => setBw(key, v)} />`)}
        </div>
        ${thumbRow('napis')}
        <p class="hint">Údaje vozu se zapamatují podle čísla a příště se vyplní samy.</p>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:.6rem">
          <h2 style="margin:0;flex:1">Náklad a zásilka</h2>
          ${photoBtn('rid', 'Tabulka RID')}
        </div>
        <${NumField} label="49. Hmotnost nákladu" unit="kg" value=${e.cargo_kg}
          onFocus=${() => setFocus({ key: 'cargo_kg', unit: 'kg' })} onChange=${(v) => update({ cargo_kg: v })} />
        <label class="field"><span>56. Stanice určení</span>
          <input class="input" value=${e.destination} onInput=${(ev) => update({ destination: ev.target.value })} /></label>
        <div class="grid2">
          <label class="field"><span>54. RID – UN číslo</span>
            <input class="input" inputmode="numeric" value=${e.rid_un} onInput=${(ev) => update({ rid_un: ev.target.value.trim() })} /></label>
          <label class="field"><span>54. RID – IČN</span>
            <input class="input" value=${e.rid_icn} onInput=${(ev) => update({ rid_icn: ev.target.value.trim().toUpperCase() })} /></label>
        </div>
        <label class="check">
          <input type="checkbox" checked=${e.exceptional} onChange=${(ev) => update({ exceptional: ev.target.checked })} />
          55. Mimořádná zásilka</label>
        ${thumbRow('rid')}
      </div>

      <div class="card">
        <div class="stats">
          <div class="stat"><b>${massKg === null ? '?' : fmt(massKg / 1000)}</b><span>hmotnost (t)</span></div>
          <div class="stat"><b>${bwFor(e, 'P') ?? '–'} / ${bwFor(e, 'G') ?? '–'}</b><span>brzdicí váha P / G (t)</span></div>
          <div class="stat"><b>${tc ?? '?'}</b><span>traťová třída</span></div>
        </div>
        ${e.kohout !== 'vypnuta' && bwFor(e, e.rezim) === null
          && html`<p class="hint err">Chybí brzdicí váha pro ${e.rezim} ${e.naklad === 'prazdny' ? 'prázdný' : 'ložený'}.</p>`}
        <div class="field-title">58. Traťová třída</div>
        <${Seg} value=${e.track_class ?? 'auto'} options=${[['auto', 'Spočítat'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']]}
          onChange=${(v) => update({ track_class: v === 'auto' ? null : v })} />
        <div class="hint">Spočítá se z hmotnosti na nápravu: A do 16 t, B do 18 t, C do 20 t, D do 22,5 t.</div>
        <label class="field" style="margin-top:.8rem"><span>59. Poznámky</span>
          <input class="input" value=${e.note} onInput=${(ev) => update({ note: ev.target.value })} /></label>
        <div class="row">
          <button class="btn small" disabled=${index === 0} onClick=${() => move(-1)}><${Icon} name="up" size=${18} /> Výš</button>
          <button class="btn small" disabled=${index === report.entries.length - 1} onClick=${() => move(1)}><${Icon} name="down" size=${18} /> Níž</button>
          <span class="spacer"></span>
          <button class="btn small danger" onClick=${remove}><${Icon} name="trash" size=${18} /> Odebrat</button>
        </div>
      </div>
    </main>
    <div class="bottombar">
      <a class="btn" href=${`#/vykaz/${report.id}`}>Hotovo</a>
      <a class="btn primary" href=${`#/vykaz/${report.id}/skenovat`}><${Icon} name="camera" /> Další vůz</a>
    </div>`;
}
