// ONNX Runtime Web – spouští neuronové sítě přímo v telefonu (WebAssembly), bez internetu.
import * as ort from '../vendor/ort/ort.wasm.min.mjs';

export const BASE = new URL('../', import.meta.url);
ort.env.wasm.wasmPaths = new URL('vendor/ort/', BASE).href;
// Více vláken jde jen se speciálními hlavičkami serveru (GitHub Pages je neumí), jinak jedno vlákno.
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

export const SESSION_OPTS = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
export const createSession = (path) => ort.InferenceSession.create(new URL(path, BASE).href, SESSION_OPTS);
export { ort };
