// Trénink: vozmistr obchází vůz s kamerou a aplikace ho vede po údajích v pořadí obchůzky
// (seznam kroků vpravo; ťuknutí = přejít na krok, přetažení = změnit pořadí, pamatuje se v telefonu).
// Kamera čte text v celém záběru, kolem přečtených nápisů kreslí rámečky a navrhne hodnotu.
// Vozmistr ji potvrdí, opraví, nebo ťukne na správný nápis. Každé potvrzení uloží snímek, přečtený text
// a označený nápis jako trénovací příklad; po posledním kroku se údaje uloží k vozu.

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { loadOcr, readText, readLine } from '../ocr.js';
import { predictSwitch } from '../brake.js';
import {
  FIELDS, FIELD, HAND_T, HAND_BRAKE, HAND_BRAKE_MEANING, extractField, parseRevision, formatRevision,
  parseRevDate, revisionStatus, formatDay, readRevisionYears, extractHandT, valueFromLine, normalizeValue, isValidValue, displayValue, matchingLines,
} from '../fields.js';
import { db } from '../db.js';
import { uid, formatNumber, isValidCheckDigit, digitsOnly } from '../model.js';
import { Icon, Seg, PhotoButton, vibrate, toast } from '../ui.js';
import { useCameraLight, LightButtons, BrightnessSlider, applyGain } from '../light.js';
import { handBrakeFrame, hull } from '../frame.js';
import { seriesInfo, axlesText } from '../series.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SIDE = 1280;    // ukládaný snímek pro trénink
const READ_SIDE = 3024;   // snímek pro čtení: písmo se čte z plného rozlišení kamery / fotky (12 Mpx → ~7 Mpx)

function grabFrame(src, w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Hlasování přes snímky: hodnota se nabídne, až ji síť přečte stejně aspoň ve dvou snímcích po sobě
// (starší hlasy slábnou). Jednorázové chyby čtení („20.ot“, useknuté číslo) tak návrh nerozhodí.
function votes() {
  const m = new Map();
  return {
    add(v) {
      for (const [k, x] of m) m.set(k, x * 0.6);
      if (v != null && v !== '') m.set(v, (m.get(v) ?? 0) + 1);
    },
    best(min = 1.5) {
      let best = null;
      let score = 0;
      for (const [k, x] of m) if (x > score) { best = k; score = x; }
      return score >= min ? best : null;
    },
    clear() { m.clear(); },
  };
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

// Zmenšená kopie přečteného snímku k uložení (rámečky řádků přepočtené na jeho velikost).
function shrink(f) {
  const k = Math.min(1, MAX_SIDE / Math.max(f.w, f.h));
  if (k === 1) return f;
  const canvas = grabFrame(f.canvas, f.w, f.h);
  return {
    canvas, w: canvas.width, h: canvas.height,
    lines: f.lines.map((l) => ({ ...l, x: l.x * k, y: l.y * k, w: l.w * k, h: l.h * k })),
  };
}

const round = (v) => Math.round(v);
const ocrRecord = (f) => ({
  w: f.w, h: f.h,
  lines: f.lines.map((l) => ({ text: l.text, conf: Math.round(l.conf * 1000) / 1000, x: round(l.x), y: round(l.y), w: round(l.w), h: round(l.h) })),
});

const ORDER_KEY = 'vykaz:trenink-poradi';

// Nápisy, které se sbírají i mimo svůj krok (kamera čte celý záběr a na levém konci vozu bývají u sebe).
// Přestavovače a špalíky ne – u nich se ukládá snímek z okamžiku volby.
const CATCH = ['cislo', 'tare', 'hand_kn', 'length', 'speed', 'revize'];

// Uložené pořadí kroků; nové kroky z pozdějších verzí se přidají na konec, zrušené vypadnou.
// Odvozené údaje (nápravy z čísla) vlastní krok nemají.
function loadOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'); } catch {}
  const steps = FIELDS.filter((f) => !f.derived).map((f) => f.key);
  const known = Array.isArray(saved) ? saved.filter((k) => steps.includes(k)) : [];
  return [...known, ...steps.filter((k) => !known.includes(k))];
}

function saveOrder(order) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch {}
}

/**
 * Kroky vpravo pod sebou. Ťuknutí = přejít na krok, tah nahoru/dolů = přesunout krok jinam.
 * Všechny položky mají stejnou výšku, cílové místo se tak spočítá z polohy prstu.
 */
function StepList({ order, current, values, caught, onPick, onReorder }) {
  const listRef = useRef();
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);
  const items = preview ?? order;

  function down(e, key) {
    drag.current = { key, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    const d = drag.current;
    if (!d || (!d.moved && Math.abs(e.clientY - d.startY) < 10)) return;
    d.moved = true;
    const els = listRef.current.children;
    const top = els[0].getBoundingClientRect().top;
    const pitch = els.length > 1 ? els[1].getBoundingClientRect().top - top : els[0].offsetHeight;
    const to = Math.max(0, Math.min(order.length - 1, Math.floor((e.clientY - top) / pitch)));
    const rest = order.filter((k) => k !== d.key);
    setPreview([...rest.slice(0, to), d.key, ...rest.slice(to)]);
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && preview) onReorder(preview);
    else if (d) onPick(d.key);
    setPreview(null);
  }
  function cancel() {
    drag.current = null;
    setPreview(null);
  }

  return html`<div class="steplist" ref=${listRef}>
    ${items.map((key) => {
      const v = values[key];
      const c = v === undefined && key !== current ? caught[key] : null;   // přečteno už při jiném kroku
      const state = key === current ? 'on' : v === null ? 'skip' : v !== undefined ? 'ok' : c ? 'caught' : '';
      return html`<button type="button" key=${key}
        class=${`stepitem ${state} ${preview && drag.current?.key === key ? 'dragging' : ''}`}
        title=${c ? `Přečteno: ${displayValue(FIELD[key], c.value)}` : null}
        onPointerDown=${(e) => down(e, key)} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel}>
        <span class="steplabel">${v !== undefined && v !== null && key !== current ? '✓ ' : c ? '● ' : ''}${FIELD[key].short}</span>
        <span class="grip" aria-hidden="true">⋮⋮</span>
      </button>`;
    })}
  </div>`;
}

export function Trainer({ onClose }) {
  const videoRef = useRef();
  const stillRef = useRef();
  const viewRef = useRef();
  const [camera, setCamera] = useState('start');   // start | live | none
  const [ready, setReady] = useState(false);
  const [order, setOrder] = useState(loadOrder);
  const [current, setCurrent] = useState(() => loadOrder()[0]);   // klíč kroku; null = vůz hotový
  const [values, setValues] = useState({});
  const [known, setKnown] = useState(null);          // údaje vozu z paměti
  const [frame, setFrame] = useState(null);          // { canvas, lines, w, h }
  const [frozen, setFrozen] = useState(false);
  const [cand, setCand] = useState(null);
  const [input, setInput] = useState('');
  const [input2, setInput2] = useState('');          // síla zajišťovací brzdy (t) v kroku s hmotností
  const [rev, setRev] = useState({ years: '', date: '', ext: '' }); // revize: roky, datum, prodloužení (měsíce)
  const [cand2, setCand2] = useState(null);
  const [frameColor, setFrameColor] = useState(null); // { value: cerveny | jiny | null, why }
  const [info, setInfo] = useState(null);            // řada vozu podle čísla
  const [axles, setAxles] = useState(null);          // počet náprav, potvrzuje se s číslem vozu
  const [axlesTouched, setAxlesTouched] = useState(false);
  const [choice, setChoice] = useState(null);        // poloha přestavovače
  const [pred, setPred] = useState(null);
  const [tapped, setTapped] = useState(null);        // index řádku, na který vozmistr ťukl
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(0);
  const [flash, setFlash] = useState(null);          // právě uložený snímek: { url, text, key }
  const [caught, setCaught] = useState({});          // údaje přečtené mimo svůj krok: klíč → { value, frame, from }
  const [caughtFrom, setCaughtFrom] = useState(null); // krok, při kterém se přečetl právě zobrazený údaj
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const light = useCameraLight();
  const vote = useRef({ main: votes(), t: votes(), color: votes() });
  const catchVote = useRef({});
  const live = useRef({});
  live.current = { key: current, frozen, touched, gain: light.gain, info, values };

  const field = current ? FIELD[current] : null;
  const done = !field;

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
      light.attach(stream.getVideoTracks()[0]);
      setCamera('live');
      await loadOcr().catch(() => {});
      while (!stopped) {
        const { key: k, frozen: fz } = live.current;
        if (fz || !k || video.readyState < 2) { await sleep(150); continue; }
        const c = applyGain(grabFrame(video, video.videoWidth, video.videoHeight, READ_SIDE), live.current.gain);
        // u přestavovačů se text nečte (nic v něm nehledáme), jen se snímek předá síti
        const needsText = FIELD[k].type !== 'switch' || FIELD[k].key === 'blocks';
        const lines = needsText ? await readText(c).catch(() => []) : [];
        if (stopped || live.current.frozen || live.current.key !== k) continue;
        const fr = { canvas: c, lines, w: c.width, h: c.height };
        setFrame(fr);
        await suggest(FIELD[k], c, lines);
        if (lines.length) collect(k, fr);
        await sleep(needsText ? 60 : 400);
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

  // údaje vozu z paměti (jen jako nápověda)
  useEffect(() => {
    if (values.cislo) db.wagon(values.cislo).then((w) => setKnown(w ?? null));
  }, [values.cislo]);

  // Řada podle čísla: v kroku čísla z toho, co je právě v poli (nápravy se potvrzují s číslem), jinak
  // z potvrzeného čísla. Řada závisí jen na 1. a 5.–8. číslici.
  const number = current === 'cislo' ? digitsOnly(input) : values.cislo ?? '';
  useEffect(() => {
    let off = false;
    if (number.length >= 8) seriesInfo(number).then((x) => { if (!off) setInfo(x); });
    else setInfo(null);
    return () => { off = true; };
  }, [number.slice(0, 8)]);

  // počet náprav: jistý údaj z řady se předvyplní, 8, „6 a více“ a nejasné případy zvolí vozmistr sám
  useEffect(() => {
    if (current === 'cislo' && !axlesTouched) setAxles(info?.axles?.sure ? String(info.axles.value) : null);
  }, [info, current]);

  // Návrh hodnoty kroku: u voleb natrénovaná síť (pokud už je), jinak pravidlo nad přečteným textem.
  // Z živé kamery až po shodě ve více snímcích (hlasování), z fotky hned (single).
  // Co vozmistr už sám zvolil nebo napsal, se nepřepíše.
  async function suggest(f, canvas, lines, single = false) {
    const v = vote.current;
    const pick = (box, value) => {
      if (single) return value ?? null;
      box.add(value);
      return box.best();
    };
    const keep = () => live.current.touched;
    if (f.type === 'switch') {
      const p = await predictSwitch(f.key, canvas).catch(() => null);
      const found = p ? null : extractField(f, lines);
      const best = pick(v.main, p?.label ?? found?.value);
      setPred(p);
      setCand(found ? { ...found, stable: best === found.value } : null);
      if (best && !keep()) setChoice(best);
    } else if (f.type === 'weight') {
      // hmotnost, pod ní síla zajišťovací brzdy (t) a barva jejího rámečku
      const found = extractField(f, lines);
      const t = extractHandT(lines, found);
      const color = found && t?.below
        ? handBrakeFrame(canvas, hull(found.lines.map((i) => lines[i])), hull(t.lines.map((i) => lines[i])))
        : null;
      const tare = pick(v.main, found?.value);
      const handT = pick(v.t, t?.value);
      const frameValue = pick(v.color, found ? (t ? color?.value : 'nema') : null);
      setCand(found ? { ...found, stable: tare === found.value } : null);
      setCand2(t);
      setFrameColor(color);
      if (!keep()) {
        if (tare) setInput(editable(f, tare));
        if (handT) setInput2(editable(HAND_T, handT));
        if (frameValue) setChoice(frameValue);
      }
    } else if (f.type === 'revision') {
      const found = await readRevisionYears(extractField(f, lines), canvas, readLine);
      const best = pick(v.main, found?.value);
      setCand(found ? { ...found, stable: best === found.value } : null);
      if (best && !keep()) {
        const r = parseRevision(best);
        setRev({ years: r.years ? String(r.years) : '', date: r.date, ext: r.ext ? String(r.ext) : '' });
      }
    } else {
      // rychlost, kterou z nápisů nejde přečíst, se navrhne podle řady (s = 100 km/h, ss = 120 km/h)
      const seriesSpeed = f.key === 'speed' && live.current.info?.speed;
      const found = extractField(f, lines, canvas) ?? (seriesSpeed ? { value: String(seriesSpeed), lines: [], series: true } : null);
      const best = pick(v.main, found?.value);
      setCand(found ? { ...found, stable: best === found.value } : null);
      if (best && !keep()) setInput(editable(f, best));
    }
  }

  // Ostatní nepotvrzené údaje ve stejném snímku: z živé kamery po shodě ve dvou snímcích po sobě, z fotky hned.
  // Zapamatuje se hodnota i snímek, na kterém je; vozmistr ji potvrdí, až na ni přijde řada (nic se neuloží samo).
  function collect(stepKey, fr, single = false) {
    const vals = live.current.values;
    for (const key of CATCH) {
      if (key === stepKey || vals[key] !== undefined) continue;
      const f = FIELD[key];
      const hit = extractField(f, fr.lines, fr.canvas);
      // mimo svůj krok jen jisté: číslo s kontrolní číslicí a známým státem, délka mezi symboly nárazníků
      // (jiná „m“ na voze, např. ložná délka 10,8 m, se jinak nabídnou, když délka přes nárazníky v záběru není)
      const strict = f.type === 'number' ? hit?.sure : key === 'length' ? hit?.buffers : true;
      const value = hit && strict ? hit.value : null;
      const box = (catchVote.current[key] ??= votes());
      box.add(value);
      if (value && (single || box.best() === value)) setCaught((old) => ({ ...old, [key]: { value, frame: fr, from: stepKey } }));
    }
  }

  // Přechod na krok (klíč; null = souhrn vozu). Na už potvrzeném kroku zůstane potvrzená hodnota.
  // Údaj přečtený už při jiném kroku se ukáže na zastaveném snímku, kde byl, a čeká na potvrzení.
  function goTo(key, vals = values, caughtNow = caught) {
    for (const b of Object.values(vote.current)) b.clear();
    setCurrent(key);
    setFrozen(false);
    setCand(null);
    setCand2(null);
    setFrameColor(null);
    setTapped(null);
    setPred(null);
    const f = key ? FIELD[key] : null;
    const prev = f ? vals[f.key] : null;
    setInput(f && prev ? editable(f, prev) : '');
    setInput2(vals.hand_t ? editable(HAND_T, vals.hand_t) : '');
    setTouched(prev !== undefined && prev !== null);
    if (f?.type === 'switch') setChoice(prev ?? f.default ?? null);
    if (f?.type === 'number') {
      // potvrzený počet, který jen převzal údaj z řady, se dál řídí číslem (oprava čísla → nová řada)
      setAxles(vals.axles ?? null);
      setAxlesTouched(vals.axles != null && !(info?.axles?.sure && String(info.axles.value) === vals.axles));
    }
    if (f?.type === 'weight') setChoice(vals.hand_brake ?? null);
    if (f?.type === 'revision') {
      const r = prev ? parseRevision(prev) : null;
      setRev({ years: r?.years ? String(r.years) : '', date: r?.date ?? '', ext: r?.ext ? String(r.ext) : '' });
    }
    const c = f && prev === undefined ? caughtNow[key] : null;
    setCaughtFrom(c?.from ?? null);
    if (c) {
      setFrame(c.frame);
      setFrozen(true);
      // návrh ze zapamatovaného snímku (i barva rámečku, roky revize); stav se překreslí až po tomto volání
      live.current = { ...live.current, key, frozen: true, touched: false, values: vals };
      suggest(f, c.frame.canvas, c.frame.lines, true);
    }
  }

  // další nevyplněný krok v pořadí za tím současným (pak od začátku); vše vyplněné → souhrn
  function nextKey(vals) {
    const i = order.indexOf(current);
    const rest = [...order.slice(i + 1), ...order.slice(0, i)];
    return rest.find((k) => vals[k] === undefined) ?? null;
  }

  function reorder(next) {
    setOrder(next);
    saveOrder(next);
  }

  function freeze() {
    if (frame) setFrozen(true);
  }

  function tapLine(i) {
    if (field.type === 'switch') return;
    setFrozen(true);
    setTapped(i);
    setTouched(true);
    const text = frame.lines[i].text;
    if (field.type === 'revision') {
      const date = text.match(/\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4}/)?.[0];
      const ext = text.match(/\+\s*(\d{1,2})\s*M/i)?.[1];
      const years = text.trim().match(/^(\d{1,2})\s*[JjLlRr]?$/)?.[1];
      setRev((r) => ({ ...r, ...(date ? { date: date.replace(/\s/g, '') } : {}), ...(ext ? { ext } : {}), ...(years && !date ? { years } : {}) }));
      return;
    }
    if (field.type === 'weight' && !/kg/i.test(text) && /\d\s*[.,]?\s*[0oO]?\s*t\b/i.test(text)) {
      setInput2(editable(HAND_T, valueFromLine(HAND_T, frame.lines, i)));
    } else setInput(editable(field, valueFromLine(field, frame.lines, i)));
  }

  async function fromPhoto(file) {
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const c = grabFrame(bmp, bmp.width, bmp.height, READ_SIDE);
      const lines = await readText(c, { maxSide: 1600 });
      const fr = { canvas: c, lines, w: c.width, h: c.height };
      setFrame(fr);
      setFrozen(true);
      await suggest(field, c, lines, true);
      collect(field.key, fr, true);
    } catch (e) {
      toast(`Fotku se nepodařilo přečíst: ${e.message}`);
    }
    setBusy(false);
  }

  // Uložený trénovací snímek: obrazovka problikne a v rohu se na chvíli ukáže, co přesně se uložilo.
  function announce(blob, text) {
    setSaved((n) => n + 1);
    const url = URL.createObjectURL(blob);
    const key = Date.now();
    setFlash((old) => { if (old) URL.revokeObjectURL(old.url); return { url, text, key }; });
    setTimeout(() => setFlash((f) => { if (f?.key !== key) return f; URL.revokeObjectURL(f.url); return null; }), 2600);
  }

  // dvojité ťuknutí na Potvrdit nesmí uložit snímek dvakrát
  const saving = useRef(false);
  async function confirm() {
    if (saving.current) return;
    saving.current = true;
    try { await confirmStep(); } finally { saving.current = false; }
  }

  async function confirmStep() {
    if (field.type === 'weight') return confirmWeight();
    if (field.type === 'revision') return confirmRevision();
    const value = field.type === 'switch' ? choice : normalizeValue(field, input);
    if (!isValidValue(field, value)) {
      toast(field.type === 'number' ? 'Číslo vozu musí mít 12 číslic.' : 'Zadejte hodnotu, nebo zvolte „Na voze není“.');
      return;
    }
    if (field.type === 'number' && !isValidCheckDigit(value) && !confirmCheck(value)) return;
    if (field.type === 'number' && !axles) {
      vibrate(200);
      toast('Spočítejte nápravy (dvojkolí) na voze a zvolte jejich počet.');
      return;
    }
    // U voleb (přestavovače, špalíky) se uloží snímek z okamžiku potvrzení – přesně to, co je na
    // displeji. Poslední přečtený snímek může být kvůli čtení textu až sekundu starý a ukazovat jiné místo.
    let shot = frame;
    const video = videoRef.current;
    if (field.type === 'switch' && !frozen && camera === 'live' && video?.readyState >= 2) {
      const c = applyGain(grabFrame(video, video.videoWidth, video.videoHeight), light.gain);
      shot = { canvas: c, lines: [], w: c.width, h: c.height };
    }
    if (shot) {
      const small = shrink(shot);
      const blob = await new Promise((r) => small.canvas.toBlob(r, 'image/jpeg', 0.82));
      await db.addSample({
        id: uid(),
        kind: field.key,
        label: value,
        blob,
        wagon: field.key === 'cislo' ? value : values.cislo ?? '',
        created_at: new Date().toISOString(),
        source: 'trenink',
        predicted: pred ? { label: pred.label, prob: pred.prob } : cand ? { label: cand.value } : null,
        ocr: shot.lines.length ? ocrRecord(small) : null,
        match: tapped !== null ? [tapped] : shot === frame ? matchedLines(value) : [],
      });
      announce(blob, `${field.title}: ${displayValue(field, value)}${field.type === 'number' ? ` · ${axlesText(Number(axles))}` : ''}`);
    }
    vibrate(50);
    const next = { ...values, [field.key]: value, ...(field.type === 'number' ? { axles } : {}) };
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Hmotnost a ruční brzda: jeden snímek s oběma hodnotami, k tomu výřez rámečku pro budoucí síť na barvu.
  async function confirmWeight() {
    const tare = normalizeValue(field, input);
    const handT = normalizeValue(HAND_T, input2);
    if (!tare) return toast('Zadejte vlastní hmotnost, nebo zvolte „Na voze není“.');
    if (!choice) return toast('Zvolte, odkud se ruční brzda obsluhuje (nebo že ji vůz nemá).');
    if (frame) {
      const small = shrink(frame);
      const blob = await new Promise((r) => small.canvas.toBlob(r, 'image/jpeg', 0.82));
      const tLines = cand2?.lines ?? [];
      await db.addSample({
        id: uid(), kind: 'tare', label: tare, blob,
        wagon: values.cislo ?? '', created_at: new Date().toISOString(), source: 'trenink',
        predicted: cand ? { label: cand.value, hand_t: cand2?.value, hand_brake: frameColor?.value } : null,
        extra: { hand_t: choice === 'nema' ? null : handT || null, hand_brake: choice },
        ocr: ocrRecord(small),
        match: tapped !== null ? [tapped] : matchingLines(field, frame.lines, tare),
        match_extra: { hand_t: handT ? matchingLines(HAND_T, frame.lines, handT) : [] },
      });
      announce(blob, `${field.title}: ${[displayValue(field, tare), handT && displayValue(HAND_T, handT), HAND_BRAKE.find(([v]) => v === choice)?.[1]].filter(Boolean).join(' · ')}`);
      // výřez obou řádků s rámečkem – z těchto výřezů se později naučí síť poznat barvu rámečku
      if (choice !== 'nema' && cand?.lines?.length && tLines.length) {
        const box = hull([...cand.lines, ...tLines].map((i) => frame.lines[i]));
        const pad = box.h * 0.4;
        const x = Math.max(0, box.x - pad);
        const y = Math.max(0, box.y - pad);
        const w = Math.min(frame.w - x, box.w + 2 * pad);
        const h = Math.min(frame.h - y, box.h + 2 * pad);
        const c = document.createElement('canvas');
        const k = Math.min(1, 480 / Math.max(w, h));   // výřez z plného rozlišení, nejvýš 480 bodů
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        c.getContext('2d').drawImage(frame.canvas, x, y, w, h, 0, 0, c.width, c.height);
        const crop = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        await db.addSample({
          id: uid(), kind: 'hand_frame', label: choice, blob: crop, wagon: values.cislo ?? '',
          created_at: new Date().toISOString(), source: 'trenink',
          predicted: frameColor?.value ? { label: frameColor.value } : null,
        });
      }
    }
    vibrate(50);
    const next = { ...values, tare, hand_t: choice === 'nema' ? null : handT || null, hand_brake: choice };
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Revize: roky z 1. rámečku, datum z posledního, případné prodloužení „+N M“; prošlou revizi hned ohlásit.
  async function confirmRevision() {
    const r = { years: Number(rev.years) || null, date: rev.date.replace(/\s/g, ''), ext: Number(rev.ext) || 0 };
    if (!parseRevDate(r.date)) return toast('Zadejte datum revize z posledního rámečku (např. 13.03.24).');
    if (!r.years) return toast('Doplňte počet let z prvního rámečku.');
    const value = formatRevision(r);
    if (frame) {
      const small = shrink(frame);
      const blob = await new Promise((res) => small.canvas.toBlob(res, 'image/jpeg', 0.82));
      await db.addSample({
        id: uid(), kind: field.key, label: value, blob, wagon: values.cislo ?? '',
        created_at: new Date().toISOString(), source: 'trenink',
        predicted: cand ? { label: cand.value } : null,
        ocr: ocrRecord(small),
        match: tapped !== null ? [tapped] : cand?.lines ?? [],
      });
      announce(blob, `${field.title}: ${displayValue(field, value)}`);
    }
    const st = revisionStatus(r);
    if (st.expired) {
      vibrate(400);
      toast(`Pozor: revize je prošlá – platila do ${formatDay(st.until)}.`);
    } else vibrate(50);
    const next = { ...values, revize: value };
    setValues(next);
    goTo(nextKey(next), next);
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
    const next = { ...values, [field.key]: null, ...(field.type === 'weight' ? { hand_t: null, hand_brake: null } : {}) };
    setValues(next);
    goTo(nextKey(next), next);
  }

  async function saveWagon() {
    if (!values.cislo) { toast('Bez čísla vozu se údaje k vozu neuloží.'); return newWagon(); }
    const w = { ...(await db.wagon(values.cislo)), number: values.cislo, updated_at: new Date().toISOString() };
    for (const f of [...FIELDS, HAND_T]) {
      if (f.wagonKey && values[f.key] != null) w[f.wagonKey] = f.type === 'qty' || f.type === 'weight' || f.numeric ? Number(values[f.key]) : values[f.key];
    }
    if (values.hand_brake) w.hand_brake = values.hand_brake;
    if (info?.series) w.series = info.series;
    await db.saveWagon(w);
    toast(`Vůz ${formatNumber(values.cislo)} uložen.`);
    newWagon();
  }

  function newWagon() {
    setValues({});
    setKnown(null);
    setCaught({});
    catchVote.current = {};
    goTo(order[0], {}, {});
  }

  // rámečky kolem přečtených řádků
  const hit = new Set(tapped !== null ? [tapped] : [...(cand?.lines ?? []), ...(field?.type === 'weight' ? cand2?.lines ?? [] : [])]);
  let boxes = null;
  // video i zastavený snímek vyplňují celou plochu .view – přepočet se dělá podle ní
  // (zastavený snímek je při prvním vykreslení ještě skrytý a měl by nulovou velikost)
  if (frame && viewRef.current && !done) {
    const { s, ox, oy } = mapping(viewRef.current, frame.w, frame.h, frozen ? 'contain' : 'cover');
    boxes = frame.lines.map((l, i) => html`<button type="button" class=${`box ${hit.has(i) ? (tapped === i ? 'tap' : 'hit') : ''}`}
      style=${`left:${ox + l.x * s}px;top:${oy + l.y * s}px;width:${l.w * s}px;height:${l.h * s}px`}
      aria-label=${l.text} onClick=${() => tapLine(i)}></button>`);
  }

  function summaryValue(f) {
    if (f.type === 'revision' && values[f.key]) {
      const text = displayValue(f, values[f.key]);
      return revisionStatus(values[f.key]).expired ? html`<span class="err">⚠ ${text}</span>` : text;
    }
    if (f.type !== 'weight') return values[f.key] ? displayValue(f, values[f.key]) : '—';
    if (!values.tare) return '—';
    const hb = HAND_BRAKE_MEANING[values.hand_brake] ?? '';
    return [displayValue(f, values.tare), values.hand_t && displayValue(HAND_T, values.hand_t), hb].filter(Boolean).join(' · ');
  }

  function revisionPanel() {
    const r = { years: Number(rev.years) || null, date: rev.date, ext: Number(rev.ext) || 0 };
    const st = revisionStatus(r);
    const set = (k) => (e) => { setTouched(true); setRev((x) => ({ ...x, [k]: e.target.value })); };
    return html`<div class="grid3">
        <label class="field"><span>Roky (1. rámeček)</span>
          <input class="input bigvalue" value=${rev.years} inputmode="numeric" placeholder="?" onFocus=${freeze} onInput=${set('years')} /></label>
        <label class="field"><span>Datum (poslední)</span>
          <input class="input bigvalue" value=${rev.date} inputmode="decimal" placeholder="13.03.24" onFocus=${freeze} onInput=${set('date')} /></label>
        <label class="field"><span>+ měsíců</span>
          <input class="input bigvalue" value=${rev.ext} inputmode="numeric" placeholder="0" onFocus=${freeze} onInput=${set('ext')} /></label>
      </div>
      <div class=${`hint ${st.expired ? 'err' : ''}`}>
        ${st.until
          ? st.expired ? html`<b>⚠ Revize je prošlá – platila do ${formatDay(st.until)}.</b>`
            : html`Platí do <b>${formatDay(st.until)}</b>${st.soon ? ' – brzy vyprší' : ''}.`
          : rev.date && !r.years ? 'Doplňte počet let z prvního rámečku.' : 'Namiřte na nápis revize.'}
      </div>
      <div class="hint">${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>${cand.stable ? '' : ' (ověřuji…)'}` : ''}
        ${knownValue && html` · v paměti: ${knownValue}`}</div>`;
  }

  function weightPanel() {
    const why = frameColor?.why;
    return html`<div class="grid2">
        <label class="field"><span>Hmotnost vozu (kg)</span>
          <input class="input bigvalue" value=${input} inputmode="decimal" placeholder="nenalezeno" onFocus=${freeze}
            onInput=${(e) => { setTouched(true); setInput(e.target.value); }} /></label>
        <label class="field"><span>Síla zaj. brzdy (t)</span>
          <input class="input bigvalue" value=${input2} inputmode="decimal" placeholder="—" onFocus=${freeze}
            onInput=${(e) => { setTouched(true); setInput2(e.target.value); }} /></label>
      </div>
      <div class="field-title">Rámeček u síly zajišťovací brzdy</div>
      <${Seg} value=${choice} options=${HAND_BRAKE} bad=${['cerveny']} onChange=${(v) => { setChoice(v); setTouched(true); }} />
      <div class="hint">${choice ? html`→ <b>${HAND_BRAKE_MEANING[choice]}</b>` : 'červený = pořádací brzda ze země · jiná barva (černá, bílá…) = ruční brzda z plošiny'}</div>
      <div class="hint">
        ${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>${cand2 ? html` · <b>${displayValue(HAND_T, cand2.value)}</b>` : ''}${why ? ` · ${why}` : ''}${cand.stable ? '' : ' (ověřuji…)'}`
          : 'Nic nenalezeno – přibližte se, nebo ťukněte na nápis.'}
        ${knownValue && html` · v paměti: ${knownValue}`}
      </div>`;
  }

  // Počet náprav v kroku čísla: předvolený podle řady, vozmistr ho potvrdí s číslem nebo zvolí jiný.
  // U 8 náprav, „6 a více“, kloubových vozů a neznámé řady nic předvolené není – musí ho spočítat na voze.
  function axlesRow() {
    const opts = FIELD.axles.options;
    const pick = (v) => { setAxles(v); setAxlesTouched(true); };
    const a = info?.axles;
    const fromSeries = a?.sure && axles === String(a.value);
    return html`<div class="axles-row">
        <span>Nápravy</span>
        <${Seg} value=${axles} options=${opts} onChange=${pick} />
        <input class="input" inputmode="numeric" placeholder="jiný" aria-label="Jiný počet náprav" onFocus=${freeze}
          value=${axles && !opts.some(([v]) => v === axles) ? axles : ''} onInput=${(e) => pick(e.target.value.replace(/\D/g, '') || null)} />
      </div>
      <div class=${`hint ${a && !a.sure && !axles ? 'err' : ''}`}>
        ${!info ? (number.length >= 8 ? 'Řada podle čísla není v tabulkách – spočítejte nápravy a zvolte.' : 'Počet náprav se předvolí podle řady z čísla vozu.')
          : html`Podle řady <b>${info.series}</b>: ${a.value ? axlesText(a.value) : 'počet nejde určit'}${a.note ? ` (${a.note})` : ''}${
            a.sure ? (fromSeries ? ' – potvrďte s číslem.' : ' – zvoleno jinak.')
              : axles ? '.' : html` – <b>spočítejte nápravy na voze a zvolte.</b>`}`}
      </div>`;
  }

  const knownValue = field?.wagonKey && known?.[field.wagonKey] != null ? displayValue(field, String(known[field.wagonKey])) : null;

  return html`<div class="scanner trainer">
    <div class="view" ref=${viewRef}>
      ${camera === 'none' && !frozen && html`<div class="msg"><p><b>Kamera není dostupná.</b></p>
        <p class="small">Snímek pořiďte tlačítkem Fotka.</p></div>`}
      <video ref=${videoRef} playsinline muted autoplay hidden=${camera !== 'live' || frozen} style=${light.filter}></video>
      <canvas ref=${stillRef} class="still" hidden=${!frozen}></canvas>
      <div class="boxes">${boxes}</div>
      ${flash && html`<div class="flash" key=${flash.key}></div>
        <div class="saved-shot" key=${`s${flash.key}`}><img src=${flash.url} alt="" />
          <div><b>Uloženo pro trénink</b><span>${flash.text}</span></div></div>`}
      <div class="top">
        <button class="iconbtn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="close" /></button>
        ${frozen && !done && camera === 'live' && html`<button class="btn small" onClick=${() => { setFrozen(false); setTapped(null); setCaughtFrom(null); }}>
          <${Icon} name="camera" size=${18} /> Zpět ke kameře</button>`}
        <span class="spacer"></span>
        ${camera === 'live' && html`<${LightButtons} light=${light} />`}
      </div>
      <${BrightnessSlider} light=${light} />
      <${StepList} order=${order} current=${current} values=${values} caught=${caught} onPick=${(k) => goTo(k)} onReorder=${reorder} />
      ${!done && html`<div class="ask">
        <div class="ask-n">${order.indexOf(current) + 1} / ${order.length} · uloženo snímků: ${saved}${info ? ` · řada ${info.series}` : ''}</div>
        <div class="ask-title">${field.title}</div>
        <div class="ask-hint">${!ready ? 'Načítám rozpoznávání…'
          : caughtFrom ? html`<b>Přečteno už při kroku ${FIELD[caughtFrom].short}</b> – zkontrolujte a potvrďte.` : field.hint}</div>
      </div>`}
    </div>

    <div class="panel">
      ${done
        ? html`<h2 style="margin-bottom:.5rem">Vůz hotový</h2>
            <ul class="summary">
              ${info && html`<li><span>Řada (podle čísla)</span><b>${info.series}</b></li>`}
              ${order.flatMap((k) => [FIELD[k], ...FIELDS.filter((f) => f.derived === k)])
                .map((f) => html`<li><span>${f.title}</span><b>${summaryValue(f)}</b></li>`)}
            </ul>
            <div class="row" style="margin-top:.6rem">
              <button class="btn" style="flex:1" onClick=${() => goTo(order.at(-1))}>Zpět</button>
              <button class="btn ok big" style="flex:2" onClick=${saveWagon}><${Icon} name="check" /> Uložit a další vůz</button>
            </div>`
        : html`
          ${field.type === 'weight' ? weightPanel() : field.type === 'revision' ? revisionPanel() : field.type === 'switch'
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
                  ${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>${cand.buffers ? ' mezi symboly nárazníků' : field.key === 'length' ? ' (symboly nárazníků nevidím)' : ''}${cand.stable ? '' : ' (ověřuji…)'}` : 'Nic nenalezeno – přibližte se, nebo ťukněte na správný nápis v obraze.'}
                  ${knownValue && html` · v paměti: ${knownValue}`}
                </div>
                ${field.type === 'number' && axlesRow()}`}
          <div class="row" style="margin-top:.6rem">
            <button class="btn" onClick=${skip}>Na voze není</button>
            <${PhotoButton} class="btn" onPhoto=${fromPhoto} disabled=${busy}><${Icon} name="camera" /> ${busy ? 'Čtu…' : 'Fotka'}</${PhotoButton}>
            <button class="btn ok" style="flex:1" onClick=${confirm}><${Icon} name="check" /> Potvrdit</button>
          </div>`}
    </div>
  </div>`;
}
