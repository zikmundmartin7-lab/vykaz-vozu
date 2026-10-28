// Skener čísla vozu: živý obraz z kamery, síť průběžně čte text v rámečku. Číslo se přijme samo,
// když ho přečte dvakrát po sobě a sedí kontrolní číslice, kód státu i rozdělení do skupin.
// Záloha: fotka fotoaparátem telefonu nebo ruční zadání.

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { loadOcr, readText } from '../ocr.js';
import { numberCandidates, formatNumber, isCompleteNumber, toJpeg } from '../model.js';
import { Icon, NumberInput, PhotoButton, WagonNumber, vibrate } from '../ui.js';
import { useCameraLight, LightButtons, BrightnessSlider, applyGain } from '../light.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DECAY = 0.8;      // hlasy z předchozích snímků slábnou
const ACCEPT = 3.2;     // „jisté“ číslo (2 body) ve dvou snímcích po sobě
const MAYBE = 1.8;      // platná kontrolní číslice aspoň ve dvou snímcích → nabídnout

// Rámeček na obrazovce → výřez ve skutečném obrazu kamery (video je roztažené přes object-fit: cover).
function guideRegion(video, guide) {
  const vr = video.getBoundingClientRect();
  const g = guide.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * scale) / 2;
  const oy = (vr.height - vh * scale) / 2;
  const x = Math.max(0, (g.left - vr.left - ox) / scale);
  const y = Math.max(0, (g.top - vr.top - oy) / scale);
  return { x, y, w: Math.min(vw - x, g.width / scale), h: Math.min(vh - y, g.height / scale) };
}

function grab(video, r, canvas) {
  const k = Math.min(1, 1280 / r.w);
  canvas.width = Math.round(r.w * k);
  canvas.height = Math.round(r.h * k);
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * onDone({ number, blob }) – blob je fotka s číslem (uloží se pro pozdější trénink).
 * position(number) – pořadí vozu, pokud už ve výkazu je (jinak null).
 */
export function Scanner({ onDone, onClose, position }) {
  const videoRef = useRef();
  const guideRef = useRef();
  const pausedRef = useRef(false);
  const [state, setState] = useState('start'); // start | scan | nocamera
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState('');
  const [found, setFound] = useState(null);     // { number, blob }
  const [maybe, setMaybe] = useState([]);
  const [manual, setManual] = useState(null);   // rozepsané číslo při ručním zadání
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const light = useCameraLight();
  const gainRef = useRef(1);
  gainRef.current = light.gain;
  pausedRef.current = Boolean(found || manual !== null || busy);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    const votes = new Map();
    (async () => {
      loadOcr().then(() => setReady(true), (e) => setError(`Rozpoznávání se nenačetlo: ${e.message}`));
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch {
        setState('nocamera');
        return;
      }
      if (stopped) return;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      light.attach(stream.getVideoTracks()[0]);
      setState('scan');
      await loadOcr().catch(() => {});
      const canvas = document.createElement('canvas');
      while (!stopped) {
        if (pausedRef.current || video.readyState < 2 || !guideRef.current) {
          votes.clear();
          await sleep(150);
          continue;
        }
        applyGain(grab(video, guideRegion(video, guideRef.current), canvas), gainRef.current);
        const lines = await readText(canvas).catch(() => []);
        if (stopped || pausedRef.current) continue;
        setReading(lines.filter((l) => /\d/.test(l.text)).map((l) => l.text).join('  ').slice(0, 40));
        for (const [k, v] of votes) votes.set(k, { sure: v.sure * DECAY, valid: v.valid * DECAY });
        const cands = numberCandidates(lines).filter((c) => c.valid).slice(0, 3);
        for (const c of cands) {
          const v = votes.get(c.number) ?? { sure: 0, valid: 0 };
          votes.set(c.number, { sure: v.sure + (c.sure ? 2 : 0), valid: v.valid + 1 });
        }
        // Samo se přijme jen „jisté“ číslo; s pouhou platnou kontrolní číslicí se jen nabídne k ťuknutí.
        const best = [...votes].sort((a, b) => b[1].sure - a[1].sure)[0];
        if (best && best[1].sure >= ACCEPT) {
          vibrate(80);
          setFound({ number: best[0], blob: await toJpeg(canvas) });
        } else {
          setMaybe([...votes].filter(([, v]) => v.valid >= MAYBE).map(([n]) => n));
        }
        await sleep(60);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function fromPhoto(file) {
    setBusy(true);
    setError(null);
    try {
      const bmp = await createImageBitmap(file);
      const lines = await readText(bmp, { maxSide: 1600 });
      const cands = numberCandidates(lines);
      const blob = await toJpeg(bmp);
      if (cands[0]?.valid) setFound({ number: cands[0].number, blob });
      else {
        setMaybe(cands.filter((c) => c.valid).slice(0, 3).map((c) => c.number));
        setError('Číslo se z fotky nepodařilo spolehlivě přečíst. Vyfoťte ho zblízka, nebo ho zadejte ručně.');
      }
    } catch (e) {
      setError(`Fotku se nepodařilo přečíst: ${e.message}`);
    }
    setBusy(false);
  }

  const pos = found && position(found.number);
  const tip = !ready ? 'Načítám rozpoznávání…' : 'Namiřte na číslo vozu, ať je celé v rámečku';

  return html`<div class="scanner">
    <div class="view">
      ${state === 'nocamera'
        ? html`<div class="msg">
            <p><b>Kamera není dostupná.</b></p>
            <p class="small">Povolte aplikaci přístup ke kameře, nebo číslo vyfoťte fotoaparátem či zadejte ručně.</p>
          </div>`
        : html`<video ref=${videoRef} playsinline muted autoplay style=${light.filter}></video>
            <div ref=${guideRef} class=${`guide ${found ? 'hit' : ''}`}></div>
            <div class="tip">${busy ? 'Čtu fotku…' : tip}</div>
            <div class="reading">${!found && reading}</div>`}
      <div class="top">
        <button class="iconbtn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="close" /></button>
        <span class="spacer"></span>
        ${state === 'scan' && html`<${LightButtons} light=${light} />`}
      </div>
      <${BrightnessSlider} light=${light} wide />
    </div>

    <div class="panel">
      ${error && html`<div class="notice warn">${error}</div>`}
      ${found
        ? html`<div class="found"><${WagonNumber} number=${found.number} /></div>
            <p class="small muted" style="text-align:center">
              ${pos ? html`<b class="err">Vůz už ve výkazu je (${pos}. vůz).</b>` : 'Kontrolní číslice sedí. Zkontrolujte číslo s vozem.'}
            </p>
            <div class="row">
              <button class="btn" style="flex:1" onClick=${() => setFound(null)}>Znovu</button>
              <button class="btn" style="flex:1" onClick=${() => { setManual(found.number); setFound(null); }}>Opravit</button>
              <button class="btn ok big" style="flex:2" onClick=${() => onDone(found)}>
                <${Icon} name="check" /> ${pos ? 'Otevřít' : 'Použít'}</button>
            </div>`
        : manual !== null
          ? html`<${NumberInput} value=${manual} onChange=${setManual} autoFocus />
              <div class="row">
                <button class="btn" style="flex:1" onClick=${() => setManual(null)}>Zpět ke kameře</button>
                <button class="btn primary" style="flex:1" disabled=${!isCompleteNumber(manual)}
                  onClick=${() => onDone({ number: manual, blob: null })}>Použít</button>
              </div>`
          : html`${maybe.length > 0 && html`<p class="small muted" style="margin-top:0">Možná je to:</p>
                <div class="chips" style="margin-bottom:.8rem">
                  ${maybe.map((n) => html`<button class="chip" onClick=${() => setFound({ number: n, blob: null })}>${formatNumber(n)}</button>`)}
                </div>`}
              <div class="row">
                <button class="btn" style="flex:1" onClick=${() => setManual('')}>Zadat ručně</button>
                <${PhotoButton} class="btn" onPhoto=${fromPhoto} disabled=${busy}>
                  <${Icon} name="camera" /> Vyfotit</${PhotoButton}>
              </div>`}
    </div>
  </div>`;
}
