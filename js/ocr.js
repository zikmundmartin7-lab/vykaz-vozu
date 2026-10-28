// Čtení textu z fotky přímo v telefonu, bez internetu: neuronové sítě PaddleOCR (PP-OCRv5 mobile)
// přes ONNX Runtime Web. det.onnx najde na fotce řádky textu, rec.onnx každý řádek přečte.
// Modely (asi 13 MB) a runtime (11 MB) se stáhnou jednou, pak je drží service worker v cache.

import { ort, BASE, createSession } from './ort.js';

let loading = null;
let models = null;

/** Načte obě sítě (jen poprvé); vrací Promise, kterou lze volat opakovaně. */
export function loadOcr() {
  loading ??= (async () => {
    const [det, rec, dictText] = await Promise.all([
      createSession('models/det.onnx'),
      createSession('models/rec.onnx'),
      fetch(new URL('models/rec_dict.txt', BASE)).then((r) => r.text()),
    ]);
    const lines = dictText.replace(/\r/g, '').split('\n');
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
    return {
      x, y,
      w: Math.min(b.x + b.w, w) * sx + region.x - x,
      h: Math.min(b.y + b.h, h) * sy + region.y - y,
      score: b.score,
    };
  });
}

// Souvislé oblasti nad prahem → obdélníky. DB síť text „smrští“, proto se obdélník zase rozšíří (unclip).
function findBoxes(prob, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || prob[start] <= DET.thresh) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, count = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
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
    boxes.push({ x: x0 - d, y: y0 - d, w: bw + 2 * d, h: bh + 2 * d, score: sum / count });
  }
  return boxes;
}

// ───── čtení řádku (CRNN + CTC) ─────

const REC_H = 48;
const REC_MIN_W = 320;
const REC_MAX_W = 1600;

async function recognize(src, box) {
  const { rec, chars } = models;
  const w = Math.round(Math.min(REC_MAX_W, Math.max(8, (REC_H * box.w) / box.h)));
  const padW = Math.max(REC_MIN_W, Math.ceil(w / 8) * 8);
  const px = pixels(src, box.x, box.y, box.w, box.h, w, REC_H);
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
    if (text) lines.push({ text, conf, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  return sortLines(lines);
}

/** Přečte jeden řádek textu přesně v daném výřezu (bez hledání řádků). */
export async function readLine(src, box) {
  await loadOcr();
  return recognize(src, box);
}

// Seskupení do řádků: obdélníky se svisle překrývají aspoň z poloviny menší výšky.
export function sortLines(lines) {
  const sorted = [...lines].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows = [];
  for (const l of sorted) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.y + r.h, l.y + l.h) - Math.max(r.y, l.y);
      return overlap > Math.min(r.h, l.h) * 0.5;
    });
    if (row) {
      row.items.push(l);
      const y0 = Math.min(row.y, l.y);
      row.h = Math.max(row.y + row.h, l.y + l.h) - y0;
      row.y = y0;
    } else rows.push({ y: l.y, h: l.h, items: [l] });
  }
  return rows.flatMap((r, i) => r.items.sort((a, b) => a.x - b.x).map((l) => ({ ...l, row: i })));
}
