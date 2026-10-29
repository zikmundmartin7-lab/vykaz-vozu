// Čtení textu z fotky přímo v telefonu, bez internetu: neuronové sítě PaddleOCR (PP-OCRv5 mobile)
// přes ONNX Runtime Web. det.onnx najde na fotce řádky textu, rec_latin.onnx každý řádek přečte
// (model pro latinku včetně české diakritiky; na snímcích uživatele čte číslice stejně dobře jako anglický).
// Modely (asi 13 MB) a runtime (11 MB) se stáhnou jednou, pak je drží service worker v cache.

import { ort, BASE, createSession } from './ort.js';

// Čtecí síť a její slovník (pořadí znaků = třídy sítě). configureOcr jen pro porovnávání modelů v test/.
const REC = { model: 'models/rec_latin.onnx', dict: 'models/rec_latin_dict.txt' };
export function configureOcr(opts) { Object.assign(REC, opts); }

let loading = null;
let models = null;

/** Načte obě sítě (jen poprvé); vrací Promise, kterou lze volat opakovaně. */
export function loadOcr() {
  loading ??= (async () => {
    const [det, rec, dictText] = await Promise.all([
      createSession('models/det.onnx'),
      createSession(REC.model),
      fetch(new URL(REC.dict, BASE)).then((r) => r.text()),
    ]);
    const lines = dictText.replace(/\r/g, '').split('\n');
    if (lines[0] === '') lines.shift();   // některé kopie slovníků mají navíc prázdný první řádek
    if (lines.at(-1) === '') lines.pop();
    // Třída 0 = „prázdno“ (CTC blank), za slovníkem ještě mezera.
    models = { det, rec, chars: ['', ...lines, ' '] };
    return models;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

export const ocrReady = () => models !== null;

// ───── pomocné funkce pro obrázky ─────

/** Výřez zdroje (img, video, canvas, ImageBitmap) zmenšený na w × h → ImageData. */
function pixels(src, sx, sy, sw, sh, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export function sourceSize(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width,
    h: src.videoHeight || src.naturalHeight || src.height,
  };
}

// ───── detekce řádků textu (DB) ─────

const DET = { maxSide: 960, thresh: 0.3, boxThresh: 0.5, unclip: 1.6, minArea: 12 };
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

async function detect(src, region, maxSide) {
  const { det } = models;
  const scale = Math.min(1, maxSide / Math.max(region.w, region.h));
  const w = Math.max(32, Math.round((region.w * scale) / 32) * 32);
  const h = Math.max(32, Math.round((region.h * scale) / 32) * 32);
  const px = pixels(src, region.x, region.y, region.w, region.h, w, h);
  const n = w * h;
  const input = new Float32Array(3 * n);
  // PaddleOCR čte obrázky v pořadí kanálů BGR – síť je tak natrénovaná.
  for (let i = 0; i < n; i++) {
    input[i] = (px[i * 4 + 2] / 255 - MEAN[0]) / STD[0];
    input[n + i] = (px[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
    input[2 * n + i] = (px[i * 4] / 255 - MEAN[2]) / STD[2];
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
  const prob = out[det.outputNames[0]].data;
  const sx = region.w / w;
  const sy = region.h / h;
  return findBoxes(prob, w, h).map((b) => {
    const x = Math.max(0, b.x) * sx + region.x;
    const y = Math.max(0, b.y) * sy + region.y;
    const box = {
      x, y,
      w: Math.min(b.x + b.w, w) * sx + region.x - x,
      h: Math.min(b.y + b.h, h) * sy + region.y - y,
      score: b.score,
    };
    if (b.rot) {
      // natočený obdélník řádku v souřadnicích zdroje (měřítko detekce se v osách může nepatrně lišit)
      const { cx, cy, len, thick, angle } = b.rot;
      const c = Math.cos(angle);
      const si = Math.sin(angle);
      box.rot = {
        cx: cx * sx + region.x, cy: cy * sy + region.y, angle: Math.atan2(si * sy, c * sx),
        len: len * Math.hypot(c * sx, si * sy), thick: thick * Math.hypot(si * sx, c * sy),
      };
      box.angle = box.rot.angle;
    }
    return box;
  });
}

// Natočení řádku se bere v úvahu od 2° do 30° (víc = svislý text nebo samotný znak, ne náklon telefonu).
const ROT_MIN = (2 * Math.PI) / 180;
const ROT_MAX = (30 * Math.PI) / 180;

// Souvislé oblasti nad prahem → obdélníky. DB síť text „smrští“, proto se obdélník zase rozšíří (unclip).
// U protáhlé oblasti se z momentů spočítá i sklon (telefon držený nakřivo, pohled zespodu); takový řádek
// má navíc rot = natočený obdélník a čte se z narovnaného výřezu – ze šikmého vodorovného výřezu
// čtecí síť ztrácí znaky na koncích („914-4“ → „14-4“, „18.12.20“ → „18.12.0“).
function findBoxes(prob, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const pts = new Int32Array(w * h);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || prob[start] <= DET.thresh) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, count = 0;
    let mx = 0, my = 0, mxx = 0, myy = 0, mxy = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      pts[count] = p;
      mx += x; my += y; mxx += x * x; myy += y * y; mxy += x * y;
      sum += prob[p];
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !seen[p - 1] && prob[p - 1] > DET.thresh) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && prob[p + 1] > DET.thresh) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !seen[p - w] && prob[p - w] > DET.thresh) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !seen[p + w] && prob[p + w] > DET.thresh) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (count < DET.minArea || bh < 3 || sum / count < DET.boxThresh) continue;
    const d = (bw * bh * DET.unclip) / (2 * (bw + bh));
    const box = { x: x0 - d, y: y0 - d, w: bw + 2 * d, h: bh + 2 * d, score: sum / count };
    // sklon hlavní osy oblasti; jen u protáhlých oblastí (řádek textu, ne samotný znak)
    mx /= count;
    my /= count;
    const a = mxx / count - mx * mx;
    const b = myy / count - my * my;
    const c = mxy / count - mx * my;
    const angle = 0.5 * Math.atan2(2 * c, a - b);
    const l1 = (a + b) / 2 + Math.sqrt(((a - b) / 2) ** 2 + c * c);
    const l2 = (a + b) / 2 - Math.sqrt(((a - b) / 2) ** 2 + c * c);
    if (l1 > l2 * 9 && Math.abs(angle) <= ROT_MAX) {
      box.angle = angle;
      if (Math.abs(angle) >= ROT_MIN) {
        const co = Math.cos(angle);
        const si = Math.sin(angle);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (let i = 0; i < count; i++) {
          const px = pts[i] % w - mx;
          const py = (pts[i] - (pts[i] % w)) / w - my;
          const u = px * co + py * si;
          const v = -px * si + py * co;
          if (u < u0) u0 = u;
          if (u > u1) u1 = u;
          if (v < v0) v0 = v;
          if (v > v1) v1 = v;
        }
        const len = u1 - u0 + 1;
        const thick = v1 - v0 + 1;
        const e = (len * thick * DET.unclip) / (2 * (len + thick));
        const uc = (u0 + u1) / 2;
        const vc = (v0 + v1) / 2;
        box.rot = { cx: mx + uc * co - vc * si + 0.5, cy: my + uc * si + vc * co + 0.5, len: len + 2 * e, thick: thick + 2 * e, angle };
      }
    }
    boxes.push(box);
  }
  return boxes;
}

// ───── čtení řádku (CRNN + CTC) ─────

const REC_H = 48;
const REC_MIN_W = 320;
const REC_MAX_W = 1600;

// Narovnaný výřez natočeného řádku (rot z findBoxes) zmenšený na w × h → ImageData.
function rotatedPixels(src, rot, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.translate(w / 2, h / 2);
  g.scale(w / rot.len, h / rot.thick);
  g.rotate(-rot.angle);
  g.translate(-rot.cx, -rot.cy);
  // kreslí se jen okolí řádku, ne celý snímek
  const r = Math.hypot(rot.len, rot.thick) / 2 + 2;
  const { w: sw, h: sh } = sourceSize(src);
  const x0 = Math.max(0, Math.floor(rot.cx - r));
  const y0 = Math.max(0, Math.floor(rot.cy - r));
  const x1 = Math.min(sw, Math.ceil(rot.cx + r));
  const y1 = Math.min(sh, Math.ceil(rot.cy + r));
  if (x1 > x0 && y1 > y0) g.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  return g.getImageData(0, 0, w, h).data;
}

async function recognize(src, box) {
  const { rec, chars } = models;
  const bw = box.rot?.len ?? box.w;
  const bh = box.rot?.thick ?? box.h;
  const w = Math.round(Math.min(REC_MAX_W, Math.max(8, (REC_H * bw) / bh)));
  const padW = Math.max(REC_MIN_W, Math.ceil(w / 8) * 8);
  const px = box.rot ? rotatedPixels(src, box.rot, w, REC_H) : pixels(src, box.x, box.y, box.w, box.h, w, REC_H);
  const plane = REC_H * padW;
  const input = new Float32Array(3 * plane); // zbytek do šířky padW zůstane 0 = šedá jako při tréninku
  for (let y = 0; y < REC_H; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const t = y * padW + x;
      input[t] = px[s + 2] / 127.5 - 1;
      input[plane + t] = px[s + 1] / 127.5 - 1;
      input[2 * plane + t] = px[s] / 127.5 - 1;
    }
  }
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, REC_H, padW]) });
  const res = out[rec.outputNames[0]];
  const [, steps, classes] = res.dims;
  if (classes !== chars.length) console.warn(`OCR: síť má ${classes} tříd, slovník ${chars.length} znaků`);
  const p = res.data;
  let text = '';
  const confs = [];
  let prev = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = p[t * classes + c];
      if (v > bestP) { bestP = v; best = c; }
    }
    if (best !== 0 && best !== prev) {
      text += chars[best] ?? '';
      confs.push(bestP);
    }
    prev = best;
  }
  const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: text.trim(), conf };
}

/**
 * Přečte veškerý text ve zdroji (nebo jen v oblasti region).
 * Vrací řádky seřazené shora dolů a zleva doprava: [{ text, conf, x, y, w, h }].
 */
export async function readText(src, { region, maxSide = DET.maxSide } = {}) {
  await loadOcr();
  const size = sourceSize(src);
  const r = region ?? { x: 0, y: 0, w: size.w, h: size.h };
  const boxes = await detect(src, r, maxSide);
  const lines = [];
  for (const b of boxes) {
    if (b.w < 4 || b.h < 4) continue;
    const { text, conf } = await recognize(src, b);
    if (text) lines.push({ text, conf, x: b.x, y: b.y, w: b.w, h: b.h, ...(b.angle != null ? { angle: b.angle } : {}), ...(b.rot ? { th: b.rot.thick } : {}) });
  }
  return sortLines(lines);
}

/** Přečte jeden řádek textu přesně v daném výřezu (bez hledání řádků). */
export async function readLine(src, box) {
  await loadOcr();
  return recognize(src, box);
}

// Seskupení do řádků: obdélníky se svisle překrývají aspoň z poloviny menší výšky. Na nakloněném snímku
// se svislá poloha i pořadí v řádku měří kolmo na převažující sklon řádků (jinak se řádky pod sebou slijí).
export function sortLines(lines) {
  const angles = lines.map((l) => l.angle).filter((a) => a != null).sort((a, b) => a - b);
  const tilt = angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  const co = Math.cos(tilt);
  const si = Math.sin(tilt);
  const at = lines.map((l) => {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    // výška písma: u narovnaného řádku jeho tloušťka, jinak výška obdélníku zmenšená o vliv sklonu
    const h = l.th ?? Math.max(4, l.h * co - l.w * Math.abs(si));
    const v = -cx * si + cy * co;
    return { l, u: l.x * co + cy * si, y: v - h / 2, h };   // u = levý okraj podél řádku
  });
  const sorted = at.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows = [];
  for (const t of sorted) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y);
      return overlap > Math.min(r.h, t.h) * 0.5;
    });
    if (row) {
      row.items.push(t);
      const y0 = Math.min(row.y, t.y);
      row.h = Math.max(row.y + row.h, t.y + t.h) - y0;
      row.y = y0;
    } else rows.push({ y: t.y, h: t.h, items: [t] });
  }
  return rows.flatMap((r, i) => r.items.sort((a, b) => a.u - b.u).map((t) => ({ ...t.l, row: i })));
}
