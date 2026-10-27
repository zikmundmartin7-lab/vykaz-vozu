// Fotky pro trénink sítí: přehled, export do ZIPu (pro Google Disk a sešit v Colabu), úklid.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { SWITCHES, plural } from '../model.js';
import { FIELDS } from '../fields.js';
import { db } from '../db.js';
import { brakeModels } from '../brake.js';
import { zip, download } from '../xlsx.js';
import { Topbar, Icon, toast } from '../ui.js';

// Druhy s volbou tlačítkem (přestavovače, nápravy, špalíky): fotky po složkách podle polohy, počty po polohách.
const OPTIONS = {
  ...Object.fromEntries(Object.entries(SWITCHES).map(([k, s]) => [k, s.options])),
  ...Object.fromEntries(FIELDS.filter((f) => f.type === 'switch').map((f) => [f.key, f.options])),
};
const optionText = (kind, v) => OPTIONS[kind]?.find(([x]) => x === v)?.[1] ?? v;

const KINDS = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.title])),
  ...Object.fromEntries(Object.entries(SWITCHES).map(([k, s]) => [k, s.title])),
  napis: 'Nápisy na voze (karta vozu)',
  rid: 'Tabulky RID',
};

const enc = new TextEncoder();
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Struktura ZIPu: <druh>/<poloha>/<id>.jpg u přestavovačů (přímo pro torchvision ImageFolder),
// <druh>/<id>.jpg u ostatních; u snímků z tréninku navíc <id>.json s přečteným textem, rámečky řádků
// a označeným nápisem (match = indexy řádků). labels.csv shrnuje vše.
async function buildZip(samples) {
  const files = [];
  const csv = [['soubor', 'druh', 'hodnota', 'vuz', 'porizeno', 'zdroj', 'odhad', 'jistota'].join(';')];
  for (const s of samples) {
    const dir = OPTIONS[s.kind] ? `${s.kind}/${s.label}` : s.kind;
    const name = `${dir}/${s.id}.jpg`;
    files.push({ name, data: new Uint8Array(await s.blob.arrayBuffer()) });
    if (s.ocr) {
      const meta = { kind: s.kind, label: s.label, wagon: s.wagon, predicted: s.predicted, match: s.match, ocr: s.ocr };
      files.push({ name: `${dir}/${s.id}.json`, data: enc.encode(JSON.stringify(meta)) });
    }
    csv.push([name, s.kind, s.label, s.wagon, s.created_at, s.source ?? 'karta', s.predicted?.label, s.predicted?.prob?.toFixed(3)]
      .map(csvCell).join(';'));
  }
  files.push({ name: 'labels.csv', data: enc.encode(`\ufeff${csv.join('\n')}\n`) });
  return zip(files, 'application/zip');
}

export function DataView() {
  const [samples, setSamples] = useState(null);
  const [models, setModels] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => db.samples().then((list) => setSamples(list.sort((a, b) => a.created_at.localeCompare(b.created_at))));
  useEffect(() => { load(); brakeModels().then(setModels); }, []);

  if (!samples) return html`<${Topbar} title="Data pro trénink" back="#/" /><main><p class="muted">Načítám…</p></main>`;

  const fresh = samples.filter((s) => !s.exported_at);
  const groups = {};
  for (const s of samples) {
    const g = (groups[s.kind] ??= { total: 0, labels: {} });
    g.total++;
    if (OPTIONS[s.kind]) g.labels[s.label] = (g.labels[s.label] ?? 0) + 1;
  }

  async function exportZip(list) {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const file = new File([await buildZip(list)], `vykaz_data_${stamp}.zip`, { type: 'application/zip' });
      let shared = false;
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); shared = true; } catch (e) { if (e.name === 'AbortError') { setBusy(false); return; } }
      }
      if (!shared) download(file, file.name);
      const now = new Date().toISOString();
      for (const s of list) if (!s.exported_at) await db.updateSample({ ...s, exported_at: now });
      toast(`Vyexportováno ${plural(list.length, 'fotka', 'fotky', 'fotek')}.`);
      await load();
    } catch (e) {
      toast(`Export se nepovedl: ${e.message}`);
    }
    setBusy(false);
  }

  async function removeAll() {
    if (!samples.length) return;
    if (!confirm(`Smazat z telefonu všech ${plural(samples.length, 'fotku', 'fotky', 'fotek')} pro trénink? Vrátit to nejde.`)) return;
    for (const s of samples) await db.deleteSample(s.id);
    toast('Fotky pro trénink smazány.');
    await load();
  }

  async function removeExported() {
    const old = samples.filter((s) => s.exported_at);
    if (!old.length || !confirm(`Smazat z telefonu ${plural(old.length, 'vyexportovanou fotku', 'vyexportované fotky', 'vyexportovaných fotek')}?`)) return;
    for (const s of old) await db.deleteSample(s.id);
    await load();
  }

  return html`
    <${Topbar} title="Data pro trénink" back="#/" />
    <main>
      <a class="btn primary block" href="#/trenink" style="margin-bottom:12px"><${Icon} name="camera" /> Snímat pro trénink</a>
      <div class="notice info">
        Každý snímek se uloží s hodnotou, kterou vozmistr potvrdil. Z nich se v Colabu natrénuje síť,
        která pak polohu pozná z fotky sama – i bez signálu. Na začátek stačí desítky fotek od každé polohy, spolehlivě to chce stovky.
      </div>

      ${Object.entries(KINDS).map(([kind, title]) => {
        const g = groups[kind];
        return html`<div class="card">
          <div class="row">
            <h2 style="margin:0;flex:1">${title}</h2>
            ${OPTIONS[kind] && (models[kind]
              ? html`<span class="chip ok"><${Icon} name="brain" size=${14} /> síť nasazena</span>`
              : html`<span class="chip warn">síť zatím není</span>`)}
          </div>
          <div class="chips">
            ${!g ? html`<span class="muted small">žádné fotky</span>`
              : OPTIONS[kind]
                ? OPTIONS[kind].map(([v]) => html`<span class="chip">${optionText(kind, v)}: ${g.labels[v] ?? 0}</span>`)
                : html`<span class="chip">${plural(g.total, 'fotka', 'fotky', 'fotek')}</span>`}
          </div>
        </div>`;
      })}

      <div class="card">
        <p style="margin-top:0">Nových fotek k exportu: <b>${fresh.length}</b> (celkem ${samples.length}).</p>
        <div class="row">
          <button class="btn primary" disabled=${busy || !fresh.length} onClick=${() => exportZip(fresh)}>
            <${Icon} name="share" /> ${busy ? 'Připravuji…' : 'Exportovat nové'}</button>
          <button class="btn" disabled=${busy || !samples.length} onClick=${() => exportZip(samples)}>Exportovat vše</button>
        </div>
        <p class="hint">ZIP uložte na Google Disk do složky <b>Vykaz_vozu_data</b> a spusťte sešit <b>trenink_prestavovacu.ipynb</b> v Colabu.</p>
        <div class="row" style="margin-top:.4rem">
          <button class="linkbtn small danger" onClick=${removeExported}>Smazat vyexportované</button>
          <span class="spacer"></span>
          <button class="btn small danger" disabled=${!samples.length} onClick=${removeAll}><${Icon} name="trash" size=${18} /> Smazat všechny fotky</button>
        </div>
      </div>
    </main>`;
}
