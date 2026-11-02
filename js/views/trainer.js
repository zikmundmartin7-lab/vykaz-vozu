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
  parseRevDate, maskDate, revisionStatus, formatDay, readRevisionYears, extractHandT, valueFromLine, normalizeValue, isValidValue, displayValue, matchingLines,
  LOAD_KEYS, extractLoadBrake, loadNumbers, formatLoad, parseForce, formatForce, describeForce, forceToWagon, wagonForce, forceFromLine,
} from '../fields.js';
import { db } from '../db.js';
import { uid, formatNumber, isValidCheckDigit, digitsOnly, loadBrakeToWagon, plural } from '../model.js';
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

const dec = (v) => String(v).replace('.', ',');

// Zajišťovací síla: jeden údaj, nebo Min / Max s n/N (předpis čl. 562). Pole na obrazovce ↔ uložený text (parseForce).
const FORCE_KINDS = [['single', 'Jeden údaj'], ['min', 'Min / Max']];
const EMPTY_FORCE = { kind: 'single', a: '', b: '', nN: '' };
function forceInputs(value) {
  const f = parseForce(value);
  if (!f) return EMPTY_FORCE;
  if (f.single != null) return { ...EMPTY_FORCE, a: dec(f.single) };
  return { kind: 'min', a: f.min != null ? dec(f.min) : '', b: f.max != null ? dec(f.max) : '', nN: f.n != null && f.N != null ? `${f.n}/${f.N}` : '' };
}
function forceValue(x) {
  const n = (s) => {
    const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
    return String(s).trim() && Number.isFinite(v) ? v : null;
  };
  const a = n(x.a);
  if (a === null) return { error: x.kind === 'min' ? 'Zadejte Min v kN.' : 'Zadejte zajišťovací sílu v kN, nebo zvolte „Na voze není“.' };
  if (x.kind === 'single') return { value: formatForce({ single: a }) };
  const b = x.b.trim() ? n(x.b) : null;
  if (x.b.trim() && b === null) return { error: 'Max zadejte jako číslo v kN.' };
  const m = x.nN.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (x.nN.trim() && (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2]))) {
    return { error: 'n/N zadejte jako 2/4 (n náprav s ruční brzdou z N náprav vozu).' };
  }
  return { value: formatForce({ min: a, max: b, n: m ? Number(m[1]) : null, N: m ? Number(m[2]) : null }) };
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
// Přestavovače a špalíky ne – u nich se ukládá snímek z okamžiku volby. Od přestavovače prázdný/ložený jen
// nápis samočinného brzdění „KE-GP-A MAX: 58 t“ (bývá uprostřed podélníku u značky špalíků).
const CATCH = ['cislo', 'tare', 'hand_kn', 'length', 'speed', 'revize', 'naklad'];

// Kroky, jejichž snímek se učí síť na polohu: síť vidí celou fotku zmenšenou na 224 × 224 bodů, páka (značka
// špalíků) focená z dálky z ní je pár bodů (1. trénink 2. 11.: G i LL z dálky nepoznala) → rámeček a pokyn zblízka.
const CLOSEUP = { rezim: 'Páka', naklad: 'Páka', kohout: 'Páka', rucni: 'Páka', blocks: 'Značka špalíků' };

// Uložené pořadí kroků; nové kroky z pozdějších verzí se zařadí za krok, za kterým jsou ve výchozím pořadí,
// zrušené vypadnou. Odvozené údaje (nápravy z čísla) vlastní krok nemají.
function loadOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'); } catch {}
  const steps = FIELDS.filter((f) => !f.derived).map((f) => f.key);
  const order = Array.isArray(saved) ? saved.filter((k) => steps.includes(k)) : [];
  for (const [i, k] of steps.entries()) {
    if (order.includes(k)) continue;
    const prev = steps.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k);
  }
  return order;
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
  const [force, setForce] = useState(EMPTY_FORCE);   // zajišťovací síla: druh nápisu a pole (forceInputs)
  const [cand2, setCand2] = useState(null);
  const [frameColor, setFrameColor] = useState(null); // { value: cerveny | jiny | null, why }
  const [info, setInfo] = useState(null);            // řada vozu podle čísla
  const [axles, setAxles] = useState(null);          // počet náprav, potvrzuje se s číslem vozu
  const [axlesTouched, setAxlesTouched] = useState(false);
  const [choice, setChoice] = useState(() => FIELD[loadOrder()[0]].default ?? null);   // poloha přestavovače
  const [plate, setPlate] = useState({});            // u přestavovače prázdný/ložený: LOAD_KEYS → text v poli (t)
  const [plateTouched, setPlateTouched] = useState(false);
  const plateFocus = useRef(null);                   // pole, do kterého jde ťuknutý nápis s jedním číslem
  const [pred, setPred] = useState(null);
  const [tapped, setTapped] = useState(null);        // index řádku, na který vozmistr ťukl
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(0);
  const [flash, setFlash] = useState(null);          // právě uložený snímek: { url, text, key }
  const [caught, setCaught] = useState({});          // údaje přečtené mimo svůj krok: klíč → { value, frame, from }
  const [caughtFrom, setCaughtFrom] = useState(null); // krok, při kterém se přečetl právě zobrazený údaj
  const flow = useRef(null);                          // krok, za kterým pokračuje pořadí po potvrzení přečtených údajů
  const back = useRef(null);                          // krok, na který se vrátí po potvrzení údaje přečteného mimo něj
  const offered = useRef(new Set());                  // kroky, jejichž přečtený údaj se už sám nabídl (znovu se nenabízí)
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const light = useCameraLight();
  const vote = useRef({ main: votes(), t: votes(), color: votes() });
  const catchVote = useRef({});
  const live = useRef({});
  live.current = { key: current, frozen, touched, plateTouched, gain: light.gain, info, values };

  const field = current ? FIELD[current] : null;
  const closeup = field ? CLOSEUP[field.key] : null;
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
        // u přestavovačů se text nečte (nic v něm nehledáme), jen se snímek předá síti – dokud ale není potvrzené
        // číslo vozu, čte se i tam, aby se číslo zachytilo v kterémkoli kroku
        const needsText = FIELD[k].type !== 'switch' || FIELD[k].key === 'blocks' || live.current.values.cislo === undefined;
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
      // „Nemá“ se nepředvolí: nepřečtená hodnota v t (odlesk, useknutý nápis) neznamená, že vůz ruční brzdu nemá
      const frameValue = pick(v.color, found && t ? color?.value : null);
      setCand(found ? { ...found, stable: tare === found.value } : null);
      setCand2(t);
      setFrameColor(color);
      if (!keep()) {
        if (tare) setInput(editable(f, tare));
        if (handT) setInput2(editable(HAND_T, handT));
        if (frameValue) setChoice(frameValue);
      }
    } else if (f.type === 'loadbrake') {
      // poloha páky: natrénovaná síť (až bude), samočinný podle nápisu; brzdicí váhy a přestavná hmotnost z nápisu
      const p = await predictSwitch(f.key, canvas).catch(() => null);
      const found = extractLoadBrake(lines);
      const best = Object.fromEntries(LOAD_KEYS.map((k) => [k, pick((v[k] ??= votes()), found?.values[k])]));
      const pos = pick(v.main, p?.label ?? (found?.auto ? 'auto' : null));
      setPred(p);
      setCand(found ? { ...found, stable: LOAD_KEYS.every((k) => found.values[k] == null || best[k] === found.values[k]) } : null);
      if (pos && !keep()) setChoice(pos);
      const fill = Object.fromEntries(LOAD_KEYS.filter((k) => best[k] != null).map((k) => [k, dec(best[k])]));
      if (!live.current.plateTouched && Object.keys(fill).length) setPlate((old) => ({ ...old, ...fill }));
    } else if (f.type === 'revision') {
      const found = await readRevisionYears(extractField(f, lines, canvas), canvas, readLine);
      const best = pick(v.main, found?.value);
      setCand(found ? { ...found, stable: best === found.value } : null);
      if (best && !keep()) {
        const r = parseRevision(best);
        setRev({ years: r.years ? String(r.years) : '', date: r.date, ext: r.ext ? String(r.ext) : '' });
      }
    } else if (f.type === 'force') {
      const found = extractField(f, lines);
      const best = pick(v.main, found?.value);
      setCand(found ? { ...found, stable: best === found.value } : null);
      if (best && !keep()) setForce(forceInputs(best));
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
      let value = null;
      if (f.type === 'loadbrake') {
        const max = extractLoadBrake(fr.lines)?.values.max;
        value = max != null ? formatLoad({ max }) : null;
      } else {
        const hit = extractField(f, fr.lines, fr.canvas);
        // mimo svůj krok jen jisté: číslo s kontrolní číslicí a známým státem, délka mezi symboly nárazníků
        // (jiná „m“ na voze, např. ložná délka 10,8 m, se jinak nabídnou, když délka přes nárazníky v záběru není),
        // rychlost z řádku tabulky s nenulovou hodnotou, 100 jen když by byl vidět i řádek SS pod ním
        const strict = f.type === 'number' ? hit?.sure : key === 'length' ? hit?.buffers : key === 'speed' ? !hit?.partial : true;
        value = hit && strict ? hit.value : null;
      }
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
    if (f?.type === 'switch' || f?.type === 'loadbrake') setChoice(prev ?? f.default ?? null);
    if (f?.type === 'loadbrake') {
      const lb = vals.lb ?? {};
      setPlate(Object.fromEntries(LOAD_KEYS.filter((k) => lb[k] != null).map((k) => [k, dec(lb[k])])));
      setPlateTouched(vals.lb != null);
      plateFocus.current = null;
    }
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
    if (f?.type === 'force') setForce(prev ? forceInputs(prev) : EMPTY_FORCE);
    const c = f && prev === undefined ? caughtNow[key] : null;
    setCaughtFrom(c?.from ?? null);
    if (c) {
      offered.current.add(key);
      setFrame(c.frame);
      setFrozen(true);
      // návrh ze zapamatovaného snímku (i barva rámečku, roky revize); stav se překreslí až po tomto volání
      live.current = { ...live.current, key, frozen: true, touched: false, plateTouched: false, values: vals };
      suggest(f, c.frame.canvas, c.frame.lines, true);
    }
  }

  // Údaj přečtený mimo právě snímaný krok se nabídne k potvrzení hned (na snímku, kde se přečetl), po jeho
  // potvrzení se aplikace vrátí sem (nextKey). Ne, když vozmistr už v kroku něco zvolil nebo napsal (nabídne se
  // po potvrzení), a sám každý údaj jen jednou. Z Fotky se nenabízí hned – snímek je zastavený a ukazuje tento krok.
  useEffect(() => {
    if (!field || frozen || touched || caughtFrom) return;
    const k = order.find((x) => x !== current && values[x] === undefined && caught[x] && !offered.current.has(x));
    if (!k) return;
    back.current ??= current;
    vibrate(100);
    goTo(k);
  }, [caught]);

  // Kam po potvrzení: nejdřív další údaje přečtené mimo svůj krok, pak zpět na krok, od kterého se k nim odbočilo,
  // jinak další nevyplněný krok v pořadí za tím, který byl potvrzený před nimi (pak od začátku); vše vyplněné → souhrn.
  function nextKey(vals) {
    if (!caughtFrom || !flow.current) flow.current = current;
    const i = order.indexOf(flow.current);
    const rest = [...order.slice(i + 1), ...order.slice(0, i + 1)].filter((k) => vals[k] === undefined);
    const pending = rest.find((k) => caught[k]);
    if (pending) return pending;
    const ret = back.current;
    back.current = null;
    return ret && vals[ret] === undefined ? ret : rest[0] ?? null;
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
    if (field.type === 'loadbrake') {
      // dvě a tři čísla = brzdicí váhy zleva, jedno = do pole, kde je kurzor (jinak první prázdné), MAX = samočinné
      const n = loadNumbers(text);
      const one = plateFocus.current ?? ['empty', 'loaded', 'change'].find((k) => !plate[k]) ?? 'change';
      const fill = n.max != null ? { max: n.max } : n.length >= 3 ? { empty: n[0], half: n[1], loaded: n[2] }
        : n.length === 2 ? { empty: n[0], loaded: n[1] } : n.length === 1 ? { [one]: n[0] } : {};
      setPlateTouched(true);
      setPlate((p) => ({ ...p, ...Object.fromEntries(Object.entries(fill).map(([k, v]) => [k, dec(v)])) }));
      return;
    }
    if (field.type === 'revision') {
      const date = text.match(/\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4}/)?.[0];
      const ext = text.match(/\+\s*(\d{1,2})\s*M/i)?.[1];
      const years = text.trim().match(/^(\d{1,2})\s*[JjLlRr]?$/)?.[1];
      setRev((r) => ({ ...r, ...(date ? { date: date.replace(/\s/g, '') } : {}), ...(ext ? { ext } : {}), ...(years && !date ? { years } : {}) }));
      return;
    }
    if (field.type === 'force') {
      // „Min …“ / „Max …“ / n/N do svého pole, samotné číslo s kN do prvního
      const part = forceFromLine(frame.lines, i);
      setForce((x) => ({ ...x, ...part }));
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

  // Trénovací snímek. Uložený dřív, než je potvrzené číslo vozu (přečtený údaj nabídnutý během snímání čísla),
  // dostane číslo vozu dodatečně při jeho potvrzení (numberSamples).
  const unnumbered = useRef([]);
  async function addSample(s) {
    await db.addSample(s);
    if (!s.wagon) unnumbered.current.push(s.id);
  }
  async function numberSamples(number) {
    for (const id of unnumbered.current.splice(0)) {
      const s = await db.sample(id);
      if (s && !s.wagon) await db.updateSample({ ...s, wagon: number });
    }
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
    if (field.type === 'loadbrake') return confirmLoadBrake();
    if (field.type === 'revision') return confirmRevision();
    if (field.type === 'force') return confirmForce();
    const value = field.type === 'switch' ? choice : normalizeValue(field, input);
    if (!isValidValue(field, value)) {
      toast(field.type === 'number' ? 'Číslo vozu musí mít 12 číslic.'
        : `${field.type === 'switch' ? 'Zvolte jednu z možností' : 'Zadejte hodnotu'}${field.optional ? ', nebo zvolte „Na voze není“' : ''}.`);
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
      await addSample({
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
    if (field.type === 'number') await numberSamples(value);
    vibrate(50);
    const next = { ...values, [field.key]: value, ...(field.type === 'number' ? { axles } : {}) };
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Hmotnost a ruční brzda: jeden snímek s oběma hodnotami, k tomu výřez rámečku pro budoucí síť na barvu.
  async function confirmWeight() {
    const tare = normalizeValue(field, input);
    const handT = normalizeValue(HAND_T, input2);
    if (!tare) return toast('Zadejte vlastní hmotnost vozu.');
    if (!choice) return toast('Zvolte, odkud se ruční brzda obsluhuje (nebo že ji vůz nemá).');
    if (frame) {
      const small = shrink(frame);
      const blob = await new Promise((r) => small.canvas.toBlob(r, 'image/jpeg', 0.82));
      const tLines = cand2?.lines ?? [];
      await addSample({
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
        await addSample({
          id: uid(), kind: 'hand_frame', label: choice, blob: crop, wagon: values.cislo ?? '',
          created_at: new Date().toISOString(), source: 'trenink',
          predicted: frameColor?.value ? { label: frameColor.value } : null,
        });
      }
    }
    vibrate(50);
    const next = { ...values, tare, hand_t: choice === 'nema' ? null : handT || null, hand_brake: choice };
    // bez rámečku (vůz nemá ruční brzdu) není ani zajišťovací síla – krok se přeskočí; po změně volby se zase nabídne
    if (choice === 'nema') next.hand_kn = null;
    else if (values.hand_brake === 'nema' && values.hand_kn === null) delete next.hand_kn;
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Přečtený snímek k potvrzené hodnotě kroku jako trénovací příklad (text s rámečky a označený nápis).
  async function storeShot(value, match) {
    if (!frame) return;
    const small = shrink(frame);
    const blob = await new Promise((res) => small.canvas.toBlob(res, 'image/jpeg', 0.82));
    await addSample({
      id: uid(), kind: field.key, label: value, blob, wagon: values.cislo ?? '',
      created_at: new Date().toISOString(), source: 'trenink',
      predicted: cand ? { label: cand.value } : null,
      ocr: ocrRecord(small),
      match: tapped !== null ? [tapped] : match,
    });
    announce(blob, `${field.title}: ${displayValue(field, value)}`);
  }

  // Zajišťovací síla: jeden údaj, nebo Min / Max a n/N – uloží se, jak jsou na nápisu (kolonka 53 se z nich počítá ve výkazu).
  async function confirmForce() {
    const { value, error } = forceValue(force);
    if (error) return toast(error);
    await storeShot(value, frame ? matchingLines(field, frame.lines, value) : []);
    vibrate(50);
    const next = { ...values, hand_kn: value };
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Revize: roky z 1. rámečku, datum z posledního, případné prodloužení „+N M“; prošlou revizi hned ohlásit.
  async function confirmRevision() {
    const r = { years: Number(rev.years) || null, date: rev.date.replace(/\s/g, ''), ext: Number(rev.ext) || 0 };
    if (!parseRevDate(r.date)) return toast('Zadejte datum revize z posledního rámečku (např. 13.03.24).');
    if (!r.years) return toast('Doplňte počet let z prvního rámečku.');
    const value = formatRevision(r);
    await storeShot(value, cand?.lines ?? []);
    const st = revisionStatus(r);
    if (st.expired) {
      vibrate(400);
      toast(`Pozor: revize je prošlá – platila do ${formatDay(st.until)}.`);
    } else vibrate(50);
    const next = { ...values, revize: value };
    setValues(next);
    goTo(nextKey(next), next);
  }

  // Přestavovač prázdný/ložený: poloha páky (popisek pro síť na přestavovače) a k ní brzdicí váhy, přestavné
  // hmotnosti a MAX z nápisu (extra). Snímek je ten přečtený, aby k němu patřil text s označenými nápisy.
  async function confirmLoadBrake() {
    if (!choice) return toast('Zvolte, v jaké poloze je přestavovač.');
    const lb = {};
    for (const k of LOAD_KEYS) {
      const v = normalizeValue(HAND_T, plate[k] ?? '');
      if (v) lb[k] = Number(v);
    }
    if (lb.empty != null && lb.loaded != null && lb.loaded <= lb.empty) return toast('Brzdicí váha ložený bývá vyšší než prázdný – zkontrolujte hodnoty.');
    let shot = frame;
    const video = videoRef.current;
    if (!shot?.lines.length && !frozen && camera === 'live' && video?.readyState >= 2) {
      const c = applyGain(grabFrame(video, video.videoWidth, video.videoHeight), light.gain);
      shot = { canvas: c, lines: [], w: c.width, h: c.height };
    }
    if (shot) {
      const small = shrink(shot);
      const blob = await new Promise((r) => small.canvas.toBlob(r, 'image/jpeg', 0.82));
      // označené nápisy: ty, jejichž přečtená hodnota se shoduje s potvrzenou
      const match_extra = Object.fromEntries(LOAD_KEYS.filter((k) => lb[k] != null && cand?.values[k] === lb[k]).map((k) => [k, cand.at[k]]));
      await addSample({
        id: uid(), kind: field.key, label: choice, blob, wagon: values.cislo ?? '',
        created_at: new Date().toISOString(), source: 'trenink',
        predicted: pred ? { label: pred.label, prob: pred.prob } : cand ? { ...(cand.auto ? { label: 'auto' } : {}), values: cand.values } : null,
        extra: Object.keys(lb).length ? lb : null,
        ocr: shot.lines.length ? ocrRecord(small) : null,
        match: tapped !== null ? [tapped] : [...new Set(Object.values(match_extra).flat())],
        match_extra,
      });
      announce(blob, `${field.title}: ${[displayValue(field, choice), formatLoad(lb)].filter(Boolean).join(' · ')}`);
    }
    vibrate(50);
    const next = { ...values, naklad: choice, lb: Object.keys(lb).length ? lb : null };
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

  // „Na voze není“ – jen u kroků, které na voze opravdu chybět mohou (field.optional: zajišťovací síla, G/P)
  function skip() {
    const next = { ...values, [field.key]: null };
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
    if (values.hand_kn) Object.assign(w, forceToWagon(parseForce(values.hand_kn), w));
    if (values.naklad || values.lb) Object.assign(w, loadBrakeToWagon(values.lb, values.naklad, w));
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
    flow.current = null;
    back.current = null;
    offered.current = new Set();
    unnumbered.current = [];
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
    if (f.type === 'loadbrake') return values.naklad ? [displayValue(f, values.naklad), formatLoad(values.lb)].filter(Boolean).join(' · ') : '—';
    if (f.type !== 'weight') return values[f.key] ? displayValue(f, values[f.key]) : '—';
    if (!values.tare) return '—';
    const hb = HAND_BRAKE_MEANING[values.hand_brake] ?? '';
    return [displayValue(f, values.tare), values.hand_t && displayValue(HAND_T, values.hand_t), hb].filter(Boolean).join(' · ');
  }

  function revisionPanel() {
    const r = { years: Number(rev.years) || null, date: rev.date, ext: Number(rev.ext) || 0 };
    const st = revisionStatus(r);
    const set = (k) => (e) => {
      setTouched(true);
      setRev((x) => ({ ...x, [k]: k === 'date' ? maskDate(e.target.value, e.inputType?.startsWith('delete')) : e.target.value }));
    };
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
          : rev.date && !r.years ? 'Doplňte počet let z prvního rámečku.'
            : 'Namiřte na obdélník revize (roky · dílna · datum) – bere se jen datum v obdélníku s buňkami nebo přímo u REV.'}
      </div>
      <div class="hint">${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>${cand.stable ? '' : ' (ověřuji…)'}${
          cand.stacked ? ' · obdélník pod sebou' : cand.cells ? ` · obdélník: ${plural(cand.cells, 'buňka', 'buňky', 'buněk')}`
            : cand.byWord ? ' · u slova REV' : ''}` : ''}
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

  // Zajišťovací síla: druh nápisu, k jednomu údaji jedno pole, k Min / Max ještě Max a n/N.
  function forcePanel() {
    const minmax = force.kind === 'min';
    const set = (k) => (e) => { setTouched(true); setForce((x) => ({ ...x, [k]: e.target.value })); };
    const box = (k, label, placeholder, mode = 'decimal') => html`<label class="field"><span>${label}</span>
      <input class="input bigvalue" value=${force[k]} inputmode=${mode} placeholder=${placeholder} onFocus=${freeze} onInput=${set(k)} /></label>`;
    return html`<${Seg} value=${force.kind} options=${FORCE_KINDS} onChange=${(v) => { setTouched(true); setForce((x) => ({ ...x, kind: v })); }} />
      ${minmax
        ? html`<div class="grid3e lbgrid">${box('a', 'Min (kN)', '—')}${box('b', 'Max (kN)', '—')}${box('nN', 'n/N', '2/4', 'text')}</div>`
        : box('a', 'Zajišťovací síla (kN)', 'nenalezeno')}
      <div class="hint">${minmax ? 'n/N = náprav s ruční brzdou / všech náprav (drobně vpravo dole)' : 'starší nápis s jedním údajem v kN'}</div>
      <div class="hint">${cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>${cand.stable ? '' : ' (ověřuji…)'}`
        : 'Nic nenalezeno – přibližte se, nebo ťukněte na nápis.'}
        ${knownValue && html` · v paměti: ${knownValue}`}</div>`;
  }

  // Přestavovač prázdný/ložený: poloha páky a brzdicí váhy ze štítku (½ ložený jen u P-½L-L), přestavná hmotnost,
  // u samočinného brzdění podle nákladu MAX.
  function loadPanel() {
    const half = choice === 'polo' || Boolean(plate.half || plate.change2);
    const grid = `${half ? 'grid3e' : 'grid2'} lbgrid`;
    const box = (k, label) => html`<label class="field"><span>${label}</span>
      <input class="input bigvalue" value=${plate[k] ?? ''} inputmode="decimal" placeholder="—"
        onFocus=${() => { plateFocus.current = k; freeze(); }}
        onInput=${(e) => { setPlateTouched(true); setPlate((p) => ({ ...p, [k]: e.target.value })); }} /></label>`;
    return html`<div class="seg4"><${Seg} value=${choice} options=${field.options} onChange=${(v) => { setChoice(v); setTouched(true); }} /></div>
      <div class="field-title">Brzdicí váha (t) u poloh kliky</div>
      <div class=${grid}>${box('empty', 'prázdný')}${half && box('half', '½ ložený')}${box('loaded', 'ložený')}</div>
      <div class=${grid}>${box('change', half ? 'přestavná → ½' : 'přestavná hmotnost')}${half && box('change2', 'přestavná → lož.')}${box('max', half ? 'MAX' : 'MAX (samočinný)')}</div>
      <div class="hint">
        ${cand ? html`Aplikace čte: <b>${formatLoad(cand.values) || 'samočinné brzdění podle nákladu'}</b>${cand.stable ? '' : ' (ověřuji…)'}`
          : 'Namiřte na štítek u páky (nahoře brzdicí váhy, dole přestavná hmotnost), u samočinného na nápis „MAX … t“.'}
        ${pred && html` · síť: <b>${displayValue(field, pred.label)}</b> (${Math.round(pred.prob * 100)} %)`}
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

  const knownValue = field?.type === 'loadbrake' && known
    ? formatLoad({ empty: known.bw?.P_prazdny, half: known.bw?.P_polo, loaded: known.bw?.P_lozeny, change: known.change_t, change2: known.change2_t, max: known.bw_max }) || null
    : field?.type === 'force' && known ? describeForce(wagonForce(known)) || null
    : field?.wagonKey && known?.[field.wagonKey] != null ? displayValue(field, String(known[field.wagonKey])) : null;

  return html`<div class="scanner trainer">
    <div class="view" ref=${viewRef}>
      ${camera === 'none' && !frozen && html`<div class="msg"><p><b>Kamera není dostupná.</b></p>
        <p class="small">Snímek pořiďte tlačítkem Fotka.</p></div>`}
      <video ref=${videoRef} playsinline muted autoplay hidden=${camera !== 'live' || frozen} style=${light.filter}></video>
      <canvas ref=${stillRef} class="still" hidden=${!frozen}></canvas>
      <div class="boxes">${boxes}</div>
      ${closeup && camera === 'live' && !frozen && html`<div class="closeup" aria-hidden="true"><span>${closeup} ať vyplní rámeček</span></div>`}
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
          : caughtFrom ? html`<b>Přečteno už při kroku ${FIELD[caughtFrom].short}</b> – zkontrolujte a potvrďte${
            back.current && back.current !== current ? `, pak zpět na ${FIELD[back.current].short}` : ''}.`
          : closeup ? `${field.hint ? `${field.hint} – ` : ''}zblízka: ${closeup.toLowerCase()} ať vyplní rámeček` : field.hint}</div>
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
          ${field.type === 'weight' ? weightPanel() : field.type === 'revision' ? revisionPanel() : field.type === 'loadbrake' ? loadPanel()
            : field.type === 'force' ? forcePanel() : field.type === 'switch'
            ? html`<${Seg} value=${choice} options=${field.options} bad=${field.bad} onChange=${(v) => { setChoice(v); setTouched(true); }} />
                <div class="hint">${pred ? html`Síť odhaduje <b>${displayValue(field, pred.label)}</b> (${Math.round(pred.prob * 100)} %).`
                  : cand ? html`Aplikace čte: <b>${displayValue(field, cand.value)}</b>.`
                  : field.key === 'rezim' || field.key === 'kohout' ? 'Namiřte na páku a zvolte, v jaké je poloze – snímek se uloží pro trénink.'
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
            ${field.optional && html`<button class="btn" onClick=${skip}>Na voze není</button>`}
            <${PhotoButton} class="btn" onPhoto=${fromPhoto} disabled=${busy}><${Icon} name="camera" /> ${busy ? 'Čtu…' : 'Fotka'}</${PhotoButton}>
            <button class="btn ok" style="flex:1" onClick=${confirm}><${Icon} name="check" /> Potvrdit</button>
          </div>`}
    </div>
  </div>`;
}
