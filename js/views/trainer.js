// Trénink: vozmistr obchází vůz s kamerou a aplikace ho vede po údajích v pevném pořadí
// (číslo vozu → hmotnost → síla zajišťovací brzdy → zajišťovací síla → délka → G/P → prázdný/ložený → revize).
// Kamera čte text v celém záběru, kolem přečtených nápisů kreslí rámečky a navrhne hodnotu.
// Vozmistr ji potvrdí, opraví, nebo ťukne na správný nápis. Každé potvrzení uloží snímek, přečtený text
// a označený nápis jako trénovací příklad; po posledním kroku se údaje uloží k vozu.

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { loadOcr, readText } from '../ocr.js';
import { predictSwitch } from '../brake.js';
import {
  FIELDS, extractField, valueFromLine, normalizeValue, isValidValue, displayValue, matchingLines,
} from '../fields.js';
import { db } from '../db.js';
import { uid, formatNumber, isValidCheckDigit } from '../model.js';
import { Icon, Seg, PhotoButton, vibrate, toast } from '../ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SIDE = 1280;

function grabFrame(src, w, h) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Souřadnice snímku → souřadnice prvku na obrazovce (object-fit: cover u videa, contain u zastaveného snímku).
function mapping(el, w, h, mode) {
  const r = el.getBoundingClientRect();
  const s = mode === 'cover' ? Math.max(r.width / w, r.height / h) : Math.min(r.width / w, r.height / h);
  return { s, ox: (r.width - w * s) / 2, oy: (r.height - h * s) / 2 };
}

// Hodnota do pole k úpravě (číslo vozu s mezerami, desetinná čárka).
function editable(field, value) {
  if (!value) return '';
  if (field.type === 'number') return formatNumber(value);
  if (field.type === 'qty') return String(value).replace('.', ',');
  return value;
}

const round = (v) => Math.round(v);
const ocrRecord = (f) => ({
  w: f.w, h: f.h,
  lines: f.lines.map((l) => ({ text: l.text, conf: Math.round(l.conf * 1000) / 1000, x: round(l.x), y: round(l.y), w: round(l.w), h: round(l.h) })),
});

export function Trainer({ onClose }) {
  const videoRef = useRef();
  const stillRef = useRef();
  const viewRef = useRef();
  const [camera, setCamera] = useState('start');   // start | live | none
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({});
  const [known, setKnown] = useState(null);          // údaje vozu z paměti
  const [frame, setFrame] = useState(null);          // { canvas, lines, w, h }
  const [frozen, setFrozen] = useState(false);
  const [cand, setCand] = useState(null);
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState(null);        // poloha přestavovače
  const [pred, setPred] = useState(null);
  const [tapped, setTapped] = useState(null);        // index řádku, na který vozmistr ťukl
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const live = useRef({});
  live.current = { step, frozen, touched };

  const field = FIELDS[step];
  const done = step >= FIELDS.length;

  // kamera a průběžné čtení
  useEffect(() => {
    let stopped = false;
    let stream = null;
    (async () => {
      loadOcr().then(() => setReady(true), () => toast('Rozpoznávání se nenačetlo.'));
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
      } catch {
        setCamera('none');
        return;
      }
      if (stopped) return;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamera('live');
      await loadOcr().catch(() => {});
      while (!stopped) {
        const { step: s, frozen: fz } = live.current;
        if (fz || s >= FIELDS.length || video.readyState < 2) { await sleep(150); continue; }
        const c = grabFrame(video, video.videoWidth, video.videoHeight);
        const lines = await readText(c).catch(() => []);
        if (stopped || live.current.frozen || live.current.step !== s) continue;
        setFrame({ canvas: c, lines, w: c.width, h: c.height });
        await suggest(FIELDS[s], c, lines);
        await sleep(60);
      }
    })();
    const onResize = () => setTick((x) => x + 1);
    addEventListener('resize', onResize);
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      removeEventListener('resize', onResize);
    };
  }, []);

  // zastavený snímek se vykreslí místo videa (aby rámečky seděly na to, co se uloží)
  useEffect(() => {
    const c = stillRef.current;
    if (!frozen || !frame || !c) return;
    c.width = frame.w;
    c.height = frame.h;
    c.getContext('2d').drawImage(frame.canvas, 0, 0);
  }, [frozen, frame]);

  // údaje vozu z paměti podle čísla (jen jako nápověda)
  useEffect(() => {
    if (values.cislo) db.wagon(values.cislo).then((w) => setKnown(w ?? null));
  }, [values.cislo]);

  // Návrh hodnoty kroku: u voleb natrénovaná síť (pokud už je), jinak pravidlo nad přečteným textem.
  // Co vozmistr už sám zvolil nebo napsal, se nepřepíše.
  async function suggest(f, canvas, lines) {
    if (f.type === 'switch') {
      const p = await predictSwitch(f.key, canvas).catch(() => null);
      const found = p ? null : extractField(f, lines);
      setPred(p);
      setCand(found);
      const v = p?.label ?? found?.value;
      if (v && !live.current.touched) setChoice(v);
    } else {
      const found = extractField(f, lines);
      setCand(found);
      if (found && !live.current.touched) setInput(editable(f, found.value));
    }
  }

  function resetStep(next, vals = values) {
    setStep(next);
    setFrozen(false);
    setCand(null);
    setTapped(null);
    setPred(null);
    // při návratu na už potvrzený krok zůstane potvrzená hodnota
    const f = FIELDS[next];
    const prev = f ? vals[f.key] : null;
    setInput(f && prev ? editable(f, prev) : '');
    setTouched(Boolean(prev));
    if (f?.type === 'switch') setChoice(prev ?? f.default ?? null);
  }

  function freeze() {
    if (frame) setFrozen(true);
  }

  function tapLine(i) {
    if (field.type === 'switch') return;
    setFrozen(true);
    setTapped(i);
    setTouched(true);
    setInput(editable(field, valueFromLine(field, frame.lines, i)));
  }

  async function fromPhoto(file) {
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const c = grabFrame(bmp, bmp.width, bmp.height);
      const lines = await readText(c);
      setFrame({ canvas: c, lines, w: c.width, h: c.height });
      setFrozen(true);
      await suggest(field, c, lines);
    } catch (e) {
      toast(`Fotku se nepodařilo přečíst: ${e.message}`);
    }
    setBusy(false);
  }

  // dvojité ťuknutí na Potvrdit nesmí uložit snímek dvakrát
  const saving = useRef(false);
  async function confirm() {
    if (saving.current) return;
    saving.current = true;
    try { await confirmStep(); } finally { saving.current = false; }
  }

  async function confirmStep() {
    const value = field.type === 'switch' ? choice : normalizeValue(field, input);
    if (!isValidValue(field, value)) {
      toast(field.type === 'number' ? 'Číslo vozu musí mít 12 číslic.' : 'Zadejte hodnotu, nebo zvolte „Na voze není“.');
      return;
    }
    if (field.type === 'number' && !isValidCheckDigit(value) && !confirmCheck(value)) return;
    if (frame) {
      const blob = await new Promise((r) => frame.canvas.toBlob(r, 'image/jpeg', 0.82));
      await db.addSample({
        id: uid(),
        kind: field.key,
        label: value,
        blob,
        wagon: field.key === 'cislo' ? value : values.cislo ?? '',
        created_at: new Date().toISOString(),
        source: 'trenink',
        predicted: field.type === 'switch' ? (pred ? { label: pred.label, prob: pred.prob } : null) : (cand ? { label: cand.value } : null),
        ocr: ocrRecord(frame),
        match: tapped !== null ? [tapped] : matchedLines(value),
      });
      setSaved((n) => n + 1);
    }
    vibrate(50);
    const next = { ...values, [field.key]: value };
    setValues(next);
    resetStep(step + 1, next);
  }

  // Který nápis je potvrzený údaj: ten, na který vozmistr ťukl, jinak řádky se stejnou hodnotou;
  // u revize (opravený text se s přečteným nemusí shodovat) řádek s nápisem REV.
  function matchedLines(value) {
    const m = matchingLines(field, frame.lines, value);
    return m.length || field.type !== 'text' ? m : cand?.lines ?? [];
  }

  function confirmCheck(value) {
    return window.confirm(`U čísla ${formatNumber(value)} nesedí kontrolní číslice. Přesto uložit?`);
  }

  function skip() {
    const next = { ...values, [field.key]: null };
    setValues(next);
    resetStep(step + 1, next);
  }

  async function saveWagon() {
    if (!values.cislo) { toast('Bez čísla vozu se údaje k vozu neuloží.'); return newWagon(); }
    const w = { ...(await db.wagon(values.cislo)), number: values.cislo, updated_at: new Date().toISOString() };
    for (const f of FIELDS) if (f.wagonKey && values[f.key] != null) w[f.wagonKey] = f.type === 'qty' || f.numeric ? Number(values[f.key]) : values[f.key];
    await db.saveWagon(w);
    toast(`Vůz ${formatNumber(values.cislo)} uložen.`);
    newWagon();
  }

  function newWagon() {
    setValues({});
    setKnown(null);
    resetStep(0, {});
  }

  // rámečky kolem přečtených řádků
  const hit = new Set(tapped !== null ? [tapped] : cand?.lines ?? []);
  let boxes = null;
  // video i zastavený snímek vyplňují celou plochu .view – přepočet se dělá podle ní
  // (zastavený snímek je při prvním vykreslení ještě skrytý a měl by nulovou velikost)
  if (frame && viewRef.current && !done) {
    const { s, ox, oy } = mapping(viewRef.current, frame.w, frame.h, frozen ? 'contain' : 'cover');
    boxes = frame.lines.map((l, i) => html`<button type="button" class=${`box ${hit.has(i) ? (tapped === i ? 'tap' : 'hit') : ''}`}
      style=${`left:${ox + l.x * s}px;top:${oy + l.y * s}px;width:${l.w * s}px;height:${l.h * s}px`}
      aria-label=${l.text} onClick=${() => tapLine(i)}></button>`);
  }

  const knownValue = field?.wagonKey && known?.[field.wagonKey] != null ? displayValue(field, String(known[field.wagonKey])) : null;

  return html`<div class="scanner trainer">
    <div class="view" ref=${viewRef}>
      ${camera === 'none' && !frozen && html`<div class="msg"><p><b>Kamera není dostupná.</b></p>
        <p class="small">Snímek pořiďte tlačítkem Fotka.</p></div>`}
      <video ref=${videoRef} playsinline muted autoplay hidden=${camera !== 'live' || frozen}></video>
      <canvas ref=${stillRef} class="still" hidden=${!frozen}></canvas>
      <div class="boxes">${boxes}</div>
      <div class="top">
        <button class="iconbtn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="close" /></button>
        <div class="steps">
          ${FIELDS.map((f, i) => html`<button type="button" class=${`stepchip ${i === step ? 'on' : values[f.key] !== undefined ? 'ok' : ''}`}
            onClick=${() => resetStep(i)}>${i + 1}</button>`)}
        </div>
      </div>
      ${!done && html`<div class="ask">
        <div class="ask-n">${step + 1} / ${FIELDS.length} · uloženo snímků: ${saved}</div>
        <div class="ask-title">${field.title}</div>
        <div class="ask-hint">${!ready ? 'Načítám rozpoznávání…' : field.hint}</div>
      </div>`}
      ${frozen && !done && camera === 'live' && html`<button class="btn small resume" onClick=${() => { setFrozen(false); setTapped(null); }}>
        <${Icon} name="camera" size=${18} /> Zpět ke kameře</button>`}
    </div>

    <div class="panel">
      ${done
        ? html`<h2 style="margin-bottom:.5rem">Vůz hotový</h2>
            <ul class="summary">
              ${FIELDS.map((f) => html`<li><span>${f.title}</span><b>${values[f.key] ? displayValue(f, values[f.key]) : '—'}</b></li>`)}
            </ul>
            <div class="row" style="margin-top:.6rem">
              <button class="btn" style="flex:1" onClick=${() => resetStep(FIELDS.length - 1)}>Zpět</button>
              <button class="btn ok big" style="flex:2" onClick=${saveWagon}><${Icon} name="check" /> Uložit a další vůz</button>
            </div>`
        : html`
          ${field.type === 'switch'
            ? html`<${Seg} value=${choice} options=${field.options} onChange=${(v) => { setChoice(v); setTouched(true); }} />
                <div class="hint">${pred ? html`Síť odhaduje <b>${displayValue(field, pred.label)}</b> (${Math.round(pred.prob * 100)} %).`
                  : cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>.`
                  : field.key === 'rezim' || field.key === 'naklad' ? 'Namiřte na páku a zvolte, v jaké je poloze – snímek se uloží pro trénink.'
                  : 'Namiřte kameru a zvolte tlačítkem – snímek se uloží pro trénink.'}
                  ${knownValue && html` · v paměti: ${knownValue}`}</div>`
            : html`<input class="input bigvalue" value=${input} inputmode=${field.type === 'text' ? 'text' : 'decimal'}
                  placeholder=${field.type === 'number' ? '33 54 6955 012-3' : 'nenalezeno'}
                  onFocus=${freeze}
                  onInput=${(e) => { setTouched(true); setInput(field.type === 'number' ? formatNumber(e.target.value) : e.target.value); }} />
                <div class="hint">
                  ${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>` : 'Nic nenalezeno – přibližte se, nebo ťukněte na správný nápis v obraze.'}
                  ${knownValue && html` · v paměti: ${knownValue}`}
                </div>`}
          <div class="row" style="margin-top:.6rem">
            <button class="btn" onClick=${skip}>Na voze není</button>
            <${PhotoButton} class="btn" onPhoto=${fromPhoto} disabled=${busy}><${Icon} name="camera" /> ${busy ? 'Čtu…' : 'Fotka'}</${PhotoButton}>
            <button class="btn ok" style="flex:1" onClick=${confirm}><${Icon} name="check" /> Potvrdit</button>
          </div>`}
    </div>
  </div>`;
}
