// Výkaz vozidel pro nákladní vlak podle formuláře, který vozmistři vyplňují (kolonky 2–4b, 45–59, 60–66).
// Stránky po 20 vozech jako na papíře; tisk (PDF) na šířku A4, Excel se stejnými kolonkami, sdílení textu.

import { html, useState } from '../../vendor/preact-htm.js';
import {
  digitsOnly, bwFor, entryMassKg, handForce, trackClass, totals, formatNumber, formatDate, formatTime,
  toLocalInput, num, fmt, wagonWarnings,
} from '../model.js';
import { buildXlsx, download } from '../xlsx.js';
import { Topbar, Icon, toast } from '../ui.js';
import { Stats } from './report.js';

const ROWS_PER_PAGE = 20;
const STRIKE = '—';   // proškrtnuté pole

// Kolonka 46 je na formuláři rozdělená: režim (1.–2.), zem. reg. (3.–4.), číslo (5.–11.), k. č. (12.)
function numberParts(n) {
  const d = digitsOnly(n);
  return [d.slice(0, 2), d.slice(2, 4), `${d.slice(4, 8)} ${d.slice(8, 11)}`.trim(), d.slice(11, 12)];
}

const kg = (v) => (num(v) === null ? '' : Math.round(num(v)).toLocaleString('cs-CZ'));
const m2 = (v) => (num(v) === null ? '' : num(v).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const bwCell = (e, mode) => (e.kohout === 'vypnuta' ? STRIKE : fmt(bwFor(e, mode), 2));
const ridCell = (v, e) => (e.rid_un || e.rid_icn ? v : STRIKE);

/** Hodnoty kolonek 45–59 pro jeden vůz (pro tabulku i Excel). */
function rowValues(e, i) {
  const [rezim, zem, cislo, kc] = numberParts(e.number);
  return {
    pos: i + 1, rezim, zem, cislo, kc,
    axles: num(e.axles), length: num(e.length_m), cargo: num(e.cargo_kg), tare: num(e.tare_kg),
    blocks: e.blocks ?? '',
    bwP: e.kohout === 'vypnuta' ? STRIKE : bwFor(e, 'P'),
    bwG: e.kohout === 'vypnuta' ? STRIKE : bwFor(e, 'G'),
    force: handForce(e),
    un: ridCell(e.rid_un, e), icn: ridCell(e.rid_icn, e),
    exceptional: e.exceptional ? 'X' : '',
    destination: e.destination,
    speed: num(e.max_speed),
    track: trackClass(e) ?? '',
    note: [e.kohout === 'vypnuta' ? 'brzda vypnuta' : '', e.note].filter(Boolean).join('; '),
  };
}

function fileName(report, ext) {
  const day = (report.departure_date || report.created_at.slice(0, 10)).replace(/[^\d-]/g, '');
  return `vykaz_vozidel_${report.train || 'vlak'}_${day}.${ext}`.replace(/[^\w.-]+/g, '_');
}

function Sheet({ report, entries, offset, page, pages, t }) {
  const last = page === pages;
  const pad = Array.from({ length: ROWS_PER_PAGE - entries.length });
  return html`<section class="sheet">
    <div class="sheet-head">
      <div class="sheet-title"><b>Výkaz vozidel pro nákladní vlak</b><span>(vozy a nečinná hnací vozidla)</span></div>
      <div class="hbox"><small>2. Číslo vlaku</small><b>${report.train}</b></div>
      <div class="hbox"><small>3. Datum odjezdu</small><b>${formatDate(report.departure_date)}</b></div>
      <div class="hbox wide"><small>4a. Ze stanice</small><b>${report.from_station}</b></div>
      <div class="hbox wide"><small>4b. Do stanice</small><b>${report.to_station}</b></div>
    </div>
    <table class="form">
      <thead>
        <tr>
          <th rowspan="2">45.<br />Pořadí</th>
          <th colspan="4">46. Označení vozidla, 12místné číslo</th>
          <th rowspan="2">47.<br />Počet náprav</th>
          <th rowspan="2">48.<br />Délka přes nárazníky [m]</th>
          <th rowspan="2">49.<br />Hmotnost nákladu [kg]</th>
          <th rowspan="2">50.<br />Hmotnost prázdného vozu [kg]</th>
          <th rowspan="2">51.<br />Druh brzd. špalíků</th>
          <th colspan="2">52. Brzdicí váha [t]</th>
          <th rowspan="2">53.<br />Zajišťovací síla [kN]</th>
          <th colspan="2">54. RID</th>
          <th rowspan="2">55.<br />Mimořádná zásilka</th>
          <th rowspan="2" class="dest">56.<br />Stanice určení</th>
          <th rowspan="2">57.<br />Nejv. dovolená rychlost [km/h]</th>
          <th rowspan="2">58.<br />Traťová třída</th>
          <th rowspan="2" class="note">59.<br />Poznámky</th>
        </tr>
        <tr>
          <th>režim</th><th>zem. reg.</th><th>číslo</th><th>k. č.</th>
          <th>P</th><th>G</th><th>UN</th><th>IČN</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map((e, i) => {
          const r = rowValues(e, offset + i);
          return html`<tr class=${e.kohout === 'vypnuta' ? 'off' : ''}>
            <td>${r.pos}</td><td>${r.rezim}</td><td>${r.zem}</td><td class="num46">${r.cislo}</td><td>${r.kc}</td>
            <td>${r.axles ?? ''}</td><td>${m2(r.length)}</td><td>${kg(r.cargo)}</td><td>${kg(r.tare)}</td><td>${r.blocks}</td>
            <td>${bwCell(e, 'P')}</td><td>${bwCell(e, 'G')}</td><td>${fmt(r.force, 1)}</td>
            <td>${r.un}</td><td>${r.icn}</td><td>${e.exceptional ? '☒' : '☐'}</td>
            <td class="l">${r.destination}</td><td>${r.speed ?? ''}</td><td>${r.track}</td><td class="l">${r.note}</td>
          </tr>`;
        })}
        ${pad.map(() => html`<tr class="pad"><td>&nbsp;</td>${Array.from({ length: 19 }).map(() => html`<td></td>`)}</tr>`)}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="5" class="r">CELKEM:</td>
          <td>${last ? t.axles : ''}</td><td>${last ? m2(t.length) : ''}</td>
          <td>${last ? kg(t.cargoKg) : ''}</td><td>${last ? kg(t.tareKg) : ''}</td><td class="blank"></td>
          <td>${last ? fmt(t.bwP, 2) : ''}</td><td>${last ? fmt(t.bwG, 2) : ''}</td><td>${last ? fmt(t.handForce, 1) : ''}</td>
          <td colspan="7" class="blank"></td>
        </tr>
        <tr>
          <td colspan="7" class="r small">hmotnost vozů celkem [kg]:</td>
          <td colspan="2">${last ? kg(t.massKg) : ''}</td>
          <td colspan="11" class="blank"></td>
        </tr>
      </tfoot>
    </table>
    <div class="sheet-foot">
      <table class="foot">
        <tr><td><small>60. Datum vyhotovení</small>${formatDate(report.made_at)}</td>
          <td><small>61. Čas vyhotovení</small>${formatTime(report.made_at)}</td>
          <td><small>62. Vyhotovil</small>${report.inspector}</td><td class="blank"></td></tr>
        <tr><td><small>63. Datum změny</small>${formatDate(report.change_at)}</td>
          <td><small>64. Čas změny</small>${formatTime(report.change_at)}</td>
          <td><small>65. Změnil</small>${report.changed_by}</td>
          <td><small>66. Poznámka</small>${report.change_note}</td></tr>
      </table>
      <div class="sheet-meta">
        <div>${last ? '☐' : '☒'} Sestava pokračuje na další straně</div>
        <div>Strana <b>${page}</b> / <b>${pages}</b></div>
      </div>
    </div>
  </section>`;
}

export function OutputView({ report, save }) {
  const [showChange, setShowChange] = useState(Boolean(report.change_at));
  const t = totals(report.entries);
  const entries = report.entries;
  const pages = Math.max(1, Math.ceil(entries.length / ROWS_PER_PAGE));

  function excel() {
    const col = (header, key, width = 10) => ({ header, width, value: (r) => r[key] ?? '' });
    const columns = [
      col('45. Pořadí', 'pos', 7), col('46. Režim', 'rezim', 8), col('46. Zem. reg.', 'zem', 8), col('46. Číslo', 'cislo', 11),
      col('46. K. č.', 'kc', 6), col('47. Počet náprav', 'axles'), col('48. Délka přes nárazníky [m]', 'length', 12),
      col('49. Hmotnost nákladu [kg]', 'cargo', 12), col('50. Hmotnost prázdného vozu [kg]', 'tare', 13),
      col('51. Druh brzdových špalíků', 'blocks'), col('52. Brzdicí váha P [t]', 'bwP'), col('52. Brzdicí váha G [t]', 'bwG'),
      col('53. Zajišťovací síla [kN]', 'force', 11), col('54. RID UN', 'un', 8), col('54. RID IČN', 'icn', 8),
      col('55. Mimořádná zásilka', 'exceptional'), col('56. Stanice určení', 'destination', 22),
      col('57. Nejv. dovolená rychlost [km/h]', 'speed', 12), col('58. Traťová třída', 'track', 9), col('59. Poznámky', 'note', 28),
    ];
    const rows = entries.map(rowValues);
    rows.push({ cislo: 'CELKEM', axles: t.axles, length: t.length, cargo: t.cargoKg, tare: t.tareKg, bwP: t.bwP, bwG: t.bwG,
      force: t.handForce, note: `hmotnost vozů celkem ${kg(t.massKg)} kg` });
    const info = [
      ['2. Číslo vlaku', report.train], ['3. Datum odjezdu', formatDate(report.departure_date)],
      ['4a. Ze stanice', report.from_station], ['4b. Do stanice', report.to_station],
      ['60. Datum vyhotovení', formatDate(report.made_at)], ['61. Čas vyhotovení', formatTime(report.made_at)],
      ['62. Vyhotovil', report.inspector], ['63. Datum změny', formatDate(report.change_at)],
      ['64. Čas změny', formatTime(report.change_at)], ['65. Změnil', report.changed_by], ['66. Poznámka', report.change_note],
      ['Počet vozů', t.wagons], ['Vozy s vypnutou brzdou', t.brakesOff], ['Brzdicí procenta (orientačně)', t.lambda],
    ].map(([k, v]) => ({ k, v }));
    download(buildXlsx([
      { name: 'Výkaz vozidel', columns, rows },
      { name: 'Údaje vlaku', columns: [{ header: 'Kolonka', width: 30, value: (r) => r.k }, { header: 'Hodnota', width: 30, value: (r) => r.v ?? '' }], rows: info },
    ]), fileName(report, 'xlsx'));
  }

  async function share() {
    const head = [
      `Výkaz vozidel – vlak ${report.train || '?'}, odjezd ${formatDate(report.departure_date)}`,
      [report.from_station, report.to_station].filter(Boolean).join(' → '),
    ].filter(Boolean);
    const rows = entries.map((e, i) => `${i + 1}. ${formatNumber(e.number)}  ${e.axles ?? '?'} náp.  ${kg(entryMassKg(e)) || '?'} kg  `
      + `BV P ${bwCell(e, 'P') || '?'} / G ${bwCell(e, 'G') || '?'} t${e.kohout === 'vypnuta' ? '  BRZDA VYPNUTA' : ''}`
      + `${e.rid_un ? `  RID ${e.rid_icn}/${e.rid_un}` : ''}${e.destination ? `  → ${e.destination}` : ''}`);
    const sum = `Celkem: ${t.wagons} vozů, ${t.axles} náprav, ${m2(t.length)} m, ${kg(t.massKg)} kg, `
      + `BV P ${fmt(t.bwP, 2)} t / G ${fmt(t.bwG, 2)} t`;
    const text = [...head, '', ...rows, '', sum, report.inspector && `Vyhotovil: ${report.inspector}`].filter((x) => x !== false).join('\n');
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { if (e.name !== 'AbortError') toast('Sdílení se nepovedlo.'); }
    } else {
      await navigator.clipboard?.writeText(text);
      toast('Text výkazu zkopírován do schránky.');
    }
  }

  const setChange = (key) => (ev) => save({ ...report, [key]: ev.target.value });

  return html`
    <${Topbar} title="Výkaz vozidel" back=${`#/vykaz/${report.id}`} />
    <main class="output">
      <div class="card no-print"><${Stats} t=${t} />
        ${t.missing > 0 && html`<p class="hint err">U některých vozů chybí údaje – součty nejsou úplné.</p>`}
        ${entries.some((e) => wagonWarnings(e).length) && html`<p class="hint err">U některých vozů jsou neobvyklé hodnoty – zkontrolujte je v kartě vozu (označené červeně).</p>`}
        ${t.brakesOff > 0 && html`<p class="hint err">Vozy s vypnutou brzdou: ${t.brakesOff} (brzdicí váha proškrtnuta).</p>`}
        <p class="hint">Brzdicí procenta = brzdicí váha podle polohy přestavovačů G/P ÷ hmotnost vozů × 100, bez lokomotivy – jen pro kontrolu, na formuláři nejsou.</p>
      </div>

      ${Array.from({ length: pages }, (_, p) => html`<div class="sheet-scroll"><${Sheet} report=${report} t=${t}
        entries=${entries.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE)} offset=${p * ROWS_PER_PAGE} page=${p + 1} pages=${pages} /></div>`)}

      <div class="card no-print" style="margin-top:12px">
        ${showChange
          ? html`<h2>Změna výkazu (63.–66.)</h2>
              <div class="grid2">
                <label class="field"><span>63.–64. Datum a čas změny</span>
                  <input class="input" type="datetime-local" value=${toLocalInput(report.change_at)}
                    onInput=${(ev) => save({ ...report, change_at: ev.target.value ? new Date(ev.target.value).toISOString() : null })} /></label>
                <label class="field"><span>65. Změnil</span>
                  <input class="input" value=${report.changed_by} onInput=${setChange('changed_by')} /></label>
              </div>
              <label class="field"><span>66. Poznámka (důvod změny)</span>
                <input class="input" value=${report.change_note} onInput=${setChange('change_note')} /></label>`
          : html`<button class="linkbtn" onClick=${() => { setShowChange(true); if (!report.change_at) save({ ...report, change_at: new Date().toISOString() }); }}>
              Zapsat změnu výkazu (kolonky 63.–66.)</button>`}
      </div>
    </main>
    <div class="bottombar">
      <button class="btn" onClick=${share}><${Icon} name="share" /> Sdílet</button>
      <button class="btn" onClick=${() => window.print()}><${Icon} name="print" /> PDF</button>
      <button class="btn primary" onClick=${excel}><${Icon} name="download" /> Excel</button>
    </div>`;
}
