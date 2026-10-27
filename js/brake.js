// Rozpoznání polohy přestavovačů z fotky vlastní natrénovanou sítí (sešit training/trenink_prestavovacu.ipynb).
// models/brzdy.json říká, pro které přestavovače už síť existuje:
//   { "rezim": { "file": "rezim.onnx", "classes": ["G", "P"], "size": 224 }, ... }
// Dokud síť není, vozmistr polohu ťukne a fotka se uloží jako trénovací příklad.

import { ort, BASE, createSession } from './ort.js';

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let config = null;
const sessions = {};

export async function brakeModels() {
  config ??= await fetch(new URL('models/brzdy.json', BASE))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return config;
}

/**
 * Odhad polohy přestavovače z fotky. Vrací { label, prob } nebo null, když síť pro tento druh ještě není.
 * Fotka se zmenší na čtverec size × size celá (bez ořezu) – stejně jako při tréninku.
 */
export async function predictSwitch(kind, src) {
  const cfg = (await brakeModels())[kind];
  if (!cfg) return null;
  sessions[kind] ??= createSession(`models/${cfg.file}`);
  const session = await sessions[kind];
  const size = cfg.size ?? 224;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const logits = Array.from(out[session.outputNames[0]].data);
  const max = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const best = exp.indexOf(Math.max(...exp));
  return { label: cfg.classes[best], prob: exp[best] / sum };
}
