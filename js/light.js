// Světlo pro kameru: svítilna a jas obrazu.
// Webová aplikace smí svítilnu jen zapnout a vypnout – sílu světla iPhone ani Android webu nedovolí nastavit.
// Místo úrovně svícení je proto „Jas obrazu“: kde to kamera umí, korekce expozice (ztlumí i odlesky
// reflexních nápisů), jinak softwarové zesvětlení/ztmavení náhledu i snímku, který se čte a ukládá.

import { html, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, toast } from './ui.js';

const LEVEL_KEY = 'vykaz:jas';

function loadLevel() {
  try {
    const v = Number(localStorage.getItem(LEVEL_KEY) ?? 0);
    return Number.isFinite(v) ? Math.max(-2, Math.min(2, v)) : 0;
  } catch {
    return 0;
  }
}

export function useCameraLight() {
  const track = useRef(null);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [exposure, setExposure] = useState(null);   // { min, max } – kamera umí korekci expozice
  const [level, setLevelState] = useState(loadLevel);
  const [open, setOpen] = useState(false);

  function applyExposure(v, exp) {
    // −2 … +2 → rozsah kamery (min je záporné, max kladné)
    const value = (v / 2) * (v >= 0 ? exp.max : -exp.min);
    track.current?.applyConstraints({ advanced: [{ exposureCompensation: value }] }).catch(() => {});
  }

  /** Předá světlu stopu z kamery (po getUserMedia). */
  function attach(t) {
    track.current = t;
    // iPhone svítilnu v getCapabilities často neuvádí, a přesto ji zapne – tlačítko je proto vidět vždy
    setTorchOk(true);
    const ec = t.getCapabilities?.().exposureCompensation;
    if (ec && ec.max > ec.min) {
      const exp = { min: ec.min, max: ec.max };
      setExposure(exp);
      if (level !== 0) applyExposure(level, exp);
    }
  }

  async function toggleTorch() {
    const on = !torch;
    try {
      await track.current.applyConstraints({ advanced: [{ torch: on }] });
      setTorch(on);
    } catch {
      setTorchOk(false);
      toast('Svítilnu tento telefon webové aplikaci nedovolí zapnout.');
    }
  }

  function setLevel(v) {
    setLevelState(v);
    try { localStorage.setItem(LEVEL_KEY, String(v)); } catch {}
    if (exposure) applyExposure(v, exposure);
  }

  // softwarově jen tam, kde kamera expozici nastavit neumí
  const gain = exposure ? 1 : 2 ** (level / 2);
  return { attach, torch, torchOk, toggleTorch, level, setLevel, gain, exposure, open, setOpen,
    filter: gain === 1 ? '' : `filter: brightness(${gain})` };
}

/** Tlačítka do horní lišty kamery: svítilna a jas obrazu. */
export function LightButtons({ light }) {
  return html`
    ${light.torchOk && html`<button type="button" class=${`iconbtn lightbtn ${light.torch ? 'on' : ''}`}
      onClick=${light.toggleTorch} aria-label=${light.torch ? 'Vypnout svítilnu' : 'Zapnout svítilnu'}><${Icon} name="light" /></button>`}
    <button type="button" class=${`iconbtn lightbtn ${light.open ? 'on' : ''}`}
      onClick=${() => light.setOpen(!light.open)} aria-label="Jas obrazu"><${Icon} name="sun" /></button>`;
}

/** Posuvník jasu obrazu (−2 … +2), ukáže se po ťuknutí na sluníčko. */
export function BrightnessSlider({ light, wide }) {
  if (!light.open) return null;
  return html`<div class=${`jas ${wide ? 'wide' : ''}`}>
    <span>Jas</span>
    <input type="range" min="-2" max="2" step="0.5" value=${light.level}
      onInput=${(e) => light.setLevel(Number(e.target.value))} aria-label="Jas obrazu" />
    <b>${light.level > 0 ? '+' : ''}${String(light.level).replace('.', ',')}</b>
  </div>`;
}

/** Softwarové zesvětlení/ztmavení snímku (stejně jako náhled), aby se četlo a uložilo, co vozmistr vidí. */
export function applyGain(canvas, gain) {
  if (gain === 1) return canvas;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;   // Uint8ClampedArray: násobení se samo ořízne na 0–255
  for (let i = 0; i < d.length; i += 4) {
    d[i] *= gain;
    d[i + 1] *= gain;
    d[i + 2] *= gain;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
