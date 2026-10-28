// Výkaz vozů – vstup aplikace: směrování podle #adresy, načtení výkazu, rozpoznávání na pozadí.
//   #/                       výkazy
//   #/vykaz/<id>             vozy ve výkazu
//   #/vykaz/<id>/skenovat    skener čísla nového vozu
//   #/vykaz/<id>/vuz/<eid>   karta vozu
//   #/vykaz/<id>/vystup      hotový výkaz (Excel, PDF, sdílení)
//   #/trenink                vedené snímání údajů vozu pro trénink sítě
//   #/data                   fotky pro trénink sítí

import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import { db, persist, migrateHandBrake } from './db.js';
import { loadOcr } from './ocr.js';
import { newEntry, uid } from './model.js';
import { seriesInfo } from './series.js';
import { HAND_BRAKE_OLD } from './fields.js';
import { Toasts, UpdateBanner, go } from './ui.js';
import { HomeView } from './views/home.js';
import { ReportView } from './views/report.js';
import { EntryView } from './views/entry.js';
import { OutputView } from './views/output.js';
import { DataView } from './views/data.js';
import { Scanner } from './views/scanner.js';
import { Trainer } from './views/trainer.js';

const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

function App() {
  const [path, setPath] = useState(parse());
  const [report, setReport] = useState(null);
  const [ocr, setOcr] = useState('loading');

  useEffect(() => {
    const onHash = () => { setPath(parse()); window.scrollTo(0, 0); };
    addEventListener('hashchange', onHash);
    // Sítě se stáhnou a připraví hned po spuštění, ať je skener připravený i bez signálu.
    loadOcr().then(() => setOcr('ready'), () => setOcr('error'));
    persist();
    migrateHandBrake(HAND_BRAKE_OLD).catch(() => {});
    // Nová verze: při návratu do aplikace (nejvýš jednou za 10 minut) se zeptat webu. Když je novější,
    // service worker ji stáhne na pozadí a ohlásí se (app-updated) – nemusí se čekat na nové spuštění.
    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 10 * 60000) return;
      lastCheck = Date.now();
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const reportId = path[0] === 'vykaz' ? path[1] : null;
  useEffect(() => {
    if (!reportId) return setReport(null);
    if (report?.id !== reportId) db.report(reportId).then((r) => setReport(r ?? false));
    return undefined;
  }, [reportId]);

  const save = async (r) => {
    setReport(r);
    await db.saveReport(r);
  };

  if (path[0] === 'data') return html`<${DataView} />`;
  if (path[0] === 'trenink') return html`<${Trainer} onClose=${() => go('#/data', true)} />`;
  if (!reportId) return html`<${HomeView} ocr=${ocr} />`;
  if (report === false) { go('#/', true); return null; }
  if (!report || report.id !== reportId) return null;

  const view = path[2];
  if (view === 'vuz') return html`<${EntryView} key=${path[3]} report=${report} entryId=${path[3]} save=${save} />`;
  if (view === 'vystup') return html`<${OutputView} report=${report} save=${save} />`;
  if (view === 'skenovat') {
    const position = (n) => { const i = report.entries.findIndex((e) => e.number === n); return i < 0 ? null : i + 1; };
    const onDone = async ({ number, blob }) => {
      const existing = report.entries.find((e) => e.number === number);
      if (existing) return go(`#/vykaz/${report.id}/vuz/${existing.id}`, true);
      const prev = report.entries.at(-1);
      const entry = newEntry(number, await db.wagon(number), prev, report.to_station);
      const info = await seriesInfo(number);
      if (info) {
        entry.series ??= info.series;
        if (entry.axles == null && info.axles.sure) entry.axles = info.axles.value;
        if (entry.max_speed == null && info.speed) entry.max_speed = info.speed;
        entry.series_note = info.axles.sure ? null : `Podle řady ${info.series}: ${info.axles.note ?? 'počet náprav nejde určit'} – zadejte ručně.`;
      }
      if (blob) {
        const s = { id: uid(), kind: 'cislo', label: number, blob, wagon: number, created_at: new Date().toISOString() };
        await db.addSample(s);
        entry.samples.push(s.id);
      }
      await save({ ...report, entries: [...report.entries, entry] });
      go(`#/vykaz/${report.id}/vuz/${entry.id}`, true);
    };
    return html`<${Scanner} onDone=${onDone} onClose=${() => go(`#/vykaz/${report.id}`, true)} position=${position} />`;
  }
  return html`<${ReportView} report=${report} save=${save} />`;
}

render(html`<${App} /><${Toasts} /><${UpdateBanner} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  // updateViaCache: 'none' → novou verzi service workeru prohlížeč hledá vždy na serveru
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('Service worker:', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'updated') dispatchEvent(new Event('app-updated'));
  });
}
