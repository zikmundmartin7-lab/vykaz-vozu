// Výkaz: údaje vlaku a vozy v pořadí. Přidávání vozů skenováním čísla.

import { html, useState } from '../../vendor/preact-htm.js';
import { optionLabel, entryBrakeWeight, entryMassKg, totals, fmt, plural, toLocalInput, formatDate } from '../model.js';
import { revisionStatus } from '../fields.js';
import { Topbar, Icon, WagonNumber, toast } from '../ui.js';

export const remember = (key, value) => { try { localStorage.setItem(`vykaz:${key}`, value); } catch {} };
export const recall = (key) => { try { return localStorage.getItem(`vykaz:${key}`) ?? ''; } catch { return ''; } };

export function Stats({ t }) {
  return html`<div class="stats">
    <div class="stat"><b>${t.wagons}</b><span>vozů</span></div>
    <div class="stat"><b>${t.axles}</b><span>náprav</span></div>
    <div class="stat"><b>${fmt(t.length)}</b><span>délka (m)</span></div>
    <div class="stat"><b>${fmt(t.mass)}</b><span>hmotnost (t)</span></div>
    <div class="stat"><b>${fmt(t.bw)}</b><span>brzdicí váha (t)</span></div>
    <div class="stat lambda"><b>${t.lambda ?? '–'} %</b><span>brzdicí procenta</span></div>
  </div>`;
}

export function ReportView({ report, save }) {
  const [open, setOpen] = useState(!report.train && report.entries.length === 0);
  const set = (key) => (ev) => {
    const value = ev.target.value;
    if (key === 'from_station' || key === 'inspector') remember(key, value);
    save({ ...report, [key]: value });
  };
  const t = totals(report.entries);

  function reverse() {
    save({ ...report, entries: [...report.entries].reverse() });
    toast('Pořadí vozů obráceno.');
  }

  return html`
    <${Topbar} title=${report.train ? `Vlak ${report.train}` : 'Nový výkaz'} back="#/">
      <a class="iconbtn" href=${`#/vykaz/${report.id}/vystup`} aria-label="Výkaz"><${Icon} name="table" /></a>
    </${Topbar}>
    <main>
      <div class="card">
        ${open
          ? html`<div class="grid2">
              <label class="field"><span>2. Číslo vlaku</span>
                <input class="input" inputmode="numeric" value=${report.train} onInput=${set('train')} /></label>
              <label class="field"><span>3. Datum odjezdu</span>
                <input class="input" type="date" value=${report.departure_date} onInput=${set('departure_date')} /></label>
            </div>
            <label class="field"><span>4a. Ze stanice</span>
              <input class="input" value=${report.from_station} onInput=${set('from_station')} /></label>
            <label class="field"><span>4b. Do stanice</span>
              <input class="input" value=${report.to_station} onInput=${set('to_station')} /></label>
            <div class="grid2">
              <label class="field"><span>62. Vyhotovil</span>
                <input class="input" value=${report.inspector} onInput=${set('inspector')} /></label>
              <label class="field"><span>60.–61. Vyhotoveno</span>
                <input class="input" type="datetime-local" value=${toLocalInput(report.made_at)}
                  onInput=${(ev) => ev.target.value && save({ ...report, made_at: new Date(ev.target.value).toISOString() })} /></label>
            </div>
            <button class="btn small" onClick=${() => setOpen(false)}>Hotovo</button>`
          : html`<div class="row">
              <div class="main" style="flex:1">
                <div class="title">${[report.from_station, report.to_station].filter(Boolean).join(' → ') || 'Údaje vlaku nevyplněné'}</div>
                <div class="sub">${[report.departure_date && `odjezd ${formatDate(report.departure_date)}`, report.inspector].filter(Boolean).join(' · ')}</div>
              </div>
              <button class="linkbtn" onClick=${() => setOpen(true)}>Upravit</button>
            </div>`}
      </div>

      ${report.entries.length > 0 && html`<div class="card"><${Stats} t=${t} />
        ${t.missing > 0 && html`<p class="hint err">U ${plural(t.missing, 'vozu', 'vozů', 'vozů')} chybí údaje (hmotnost, délka, nápravy nebo brzdicí váha) – součty nejsou úplné.</p>`}
      </div>`}

      <div class="row" style="margin:18px 4px 8px">
        <span class="section-title" style="margin:0;flex:1">Vozy v pořadí</span>
        ${report.entries.length > 1 && html`<button class="linkbtn small" onClick=${reverse}><${Icon} name="swap" size=${16} /> Obrátit pořadí</button>`}
      </div>
      ${report.entries.length === 0 && html`<div class="notice info">Zatím žádný vůz. Ťukněte na <b>Přidat vůz</b> a namiřte kameru na číslo vozu.</div>`}
      <ul class="list">
        ${report.entries.map((e, i) => {
          const bw = entryBrakeWeight(e);
          const mass = entryMassKg(e);
          return html`<li key=${e.id}><a class="item" href=${`#/vykaz/${report.id}/vuz/${e.id}`}>
            <span class="pos">${i + 1}</span>
            <div class="main">
              <div class="title"><${WagonNumber} number=${e.number} /></div>
              <div class="chips">
                <span class="chip">${optionLabel('rezim', e.rezim)}</span>
                <span class="chip">${optionLabel('naklad', e.naklad)}</span>
                ${e.kohout === 'vypnuta' && html`<span class="chip bad">Brzda vypnuta</span>`}
                ${e.rucni === 'zabrzdena' && html`<span class="chip warn">Ruční zabrzděna</span>`}
                ${revisionStatus(e.revision).expired && html`<span class="chip bad">Revize prošlá</span>`}
                ${bw === null || mass === null
                  ? html`<span class="chip warn">Chybí údaje</span>`
                  : html`<span class="chip ok">${fmt(mass / 1000)} t · BV ${fmt(bw)} t</span>`}
              </div>
            </div>
          </a></li>`;
        })}
      </ul>
    </main>
    <div class="bottombar">
      <a class="btn" href=${`#/vykaz/${report.id}/vystup`}><${Icon} name="table" /> Výkaz</a>
      <a class="btn primary big" href=${`#/vykaz/${report.id}/skenovat`}><${Icon} name="camera" /> Přidat vůz</a>
    </div>`;
}
