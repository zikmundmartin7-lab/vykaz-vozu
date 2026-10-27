// Úvodní obrazovka: seznam výkazů, nový výkaz, stav rozpoznávání, data pro trénink.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { totals, formatDateTime, plural, uid } from '../model.js';
import { db } from '../db.js';
import { Topbar, Icon, go } from '../ui.js';
import { recall } from './report.js';

export async function createReport() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const r = {
    id: uid(),
    created_at: now.toISOString(),
    made_at: now.toISOString(),
    train: '',
    departure_date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    from_station: recall('from_station'),
    to_station: '',
    inspector: recall('inspector'),
    change_at: null, changed_by: '', change_note: '',
    entries: [],
  };
  await db.saveReport(r);
  go(`#/vykaz/${r.id}`);
}

const OCR_TEXT = {
  loading: ['info', 'Stahuji rozpoznávání do telefonu (asi 25 MB, jen poprvé)…'],
  ready: ['ok', 'Rozpoznávání je v telefonu – funguje i bez signálu.'],
  error: ['warn', 'Rozpoznávání se nenačetlo. Čísla jde zadat ručně; zkuste aplikaci otevřít znovu se signálem.'],
};

export function HomeView({ ocr }) {
  const [reports, setReports] = useState(null);
  const load = () => db.reports().then(setReports);
  useEffect(() => { load(); }, []);

  async function remove(ev, r) {
    ev.preventDefault();
    if (!confirm(`Smazat výkaz${r.train ? ` vlaku ${r.train}` : ''} (${plural(r.entries.length, 'vůz', 'vozy', 'vozů')})?`)) return;
    await db.deleteReport(r.id);
    load();
  }

  const [kind, text] = OCR_TEXT[ocr] ?? OCR_TEXT.loading;
  return html`
    <${Topbar} title="Výkaz vozů" />
    <main>
      <div class=${`notice ${kind}`}>${text}</div>
      ${reports?.length === 0 && html`<div class="card">
        <h2>Jak to funguje</h2>
        <p class="small">1. Založte výkaz a ťukněte na <b>Přidat vůz</b>.<br />
          2. Namiřte kameru na číslo vozu – přečte se samo.<br />
          3. Nastavte polohu přestavovačů (nebo je vyfoťte) a doplňte údaje z nápisů.<br />
          4. Výkaz s brzdicími procenty vyexportujte do Excelu nebo PDF.</p>
      </div>`}
      <div class="section-title">Výkazy</div>
      <ul class="list">
        ${reports?.map((r) => {
          const t = totals(r.entries);
          return html`<li key=${r.id}><a class="item" href=${`#/vykaz/${r.id}`}>
            <div class="main">
              <div class="title">${r.train ? `Vlak ${r.train}` : 'Výkaz bez čísla vlaku'}${r.from_station ? ` · ${r.from_station}` : ''}</div>
              <div class="sub">${formatDateTime(r.created_at)} · ${plural(r.entries.length, 'vůz', 'vozy', 'vozů')}${t.lambda !== null ? ` · ${t.lambda} %` : ''}</div>
            </div>
            <button class="iconbtn" aria-label="Smazat" onClick=${(ev) => remove(ev, r)}><${Icon} name="trash" size=${20} /></button>
          </a></li>`;
        })}
      </ul>
      <p style="text-align:center;margin-top:1.5rem">
        <a href="#/data"><${Icon} name="brain" size=${18} /> Data pro trénink sítě</a>
      </p>
    </main>
    <div class="bottombar">
      <button class="btn primary big" onClick=${createReport}><${Icon} name="plus" /> Nový výkaz</button>
    </div>`;
}
