// Barva rámečku u síly zajišťovací brzdy (t) pod vlastní hmotností (předpis čl. 562, 528, 529):
// červený = pořádací brzda, ovládaná ze země; jakákoli jiná barva (černá, bílá…) = ruční brzda, ovládaná z plošiny.
// Měří se na dělicí čáře mezi řádkem s kg a řádkem s t, tedy uvnitř popisového pole –
// vůz sám bývá natřený červeně, takže okolí rámečku o barvě nic neříká.

const isRed = (r, g, b) => r > 110 && r - g > 50 && r - b > 40;
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// obálka několika řádků (hodnota bývá rozdělená do více rámečků, „41500“ + „kg“)
export function hull(lines) {
  const x = Math.min(...lines.map((l) => l.x));
  const y = Math.min(...lines.map((l) => l.y));
  return {
    x, y,
    w: Math.max(...lines.map((l) => l.x + l.w)) - x,
    h: Math.max(...lines.map((l) => l.y + l.h)) - y,
  };
}

/**
 * kg a t: obálky řádků (souřadnice v plátně). Vrací { value: 'cerveny' | 'jiny' | null, why }.
 * null = nedá se rozhodnout (např. celé pole je červené a dělicí čára není vidět).
 */
export function handBrakeFrame(canvas, kg, t) {
  const x0 = Math.round(Math.max(kg.x, t.x));
  const x1 = Math.round(Math.min(kg.x + kg.w, t.x + t.w));
  // pás mezi písmem obou řádků (rámečky z rozpoznávání jsou o kus větší než písmo)
  let y0 = Math.round(kg.y + kg.h * 0.62);
  let y1 = Math.round(t.y + t.h * 0.38);
  if (y1 - y0 < 4) {
    const mid = (kg.y + kg.h / 2 + t.y + t.h / 2) / 2;
    y0 = Math.round(mid - 3);
    y1 = Math.round(mid + 3);
  }
  y0 = Math.max(0, y0);
  y1 = Math.min(canvas.height, y1);
  if (x1 - x0 < 6 || y1 <= y0) return { value: null, why: 'řádky se nepřekrývají' };
  const w = x1 - x0;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, y1 - y0).data;
  const redRows = [];
  const lumRows = [];
  for (let y = 0; y < y1 - y0; y++) {
    let red = 0;
    let lum = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isRed(px[i], px[i + 1], px[i + 2])) red++;
      lum += luma(px[i], px[i + 1], px[i + 2]);
    }
    redRows.push(red / w);
    lumRows.push(lum / w);
  }
  const lined = redRows.filter((f) => f > 0.45).length;
  const reddish = redRows.filter((f) => f > 0.3).length;
  // Celé pole červené (nápis přímo na červeném voze) → podle červené nejde rozhodnout. Nečervený rámeček
  // bývá v kontrastní barvě k nátěru: tmavá nebo světlá čára znamená jinou barvu, tedy obsluhu z plošiny.
  if (reddish >= redRows.length * 0.8) {
    const mean = lumRows.reduce((a, b) => a + b, 0) / lumRows.length;
    const line = lumRows.some((l) => l < mean * 0.55 || l > mean * 1.35);
    return line ? { value: 'jiny', why: 'nečervená čára na červeném poli' } : { value: null, why: 'celé pole je červené' };
  }
  if (lined >= 1) return { value: 'cerveny', why: 'červená dělicí čára' };
  return { value: 'jiny', why: 'dělicí čára není červená' };
}

/**
 * Leží nápis (obálka řádků) mezi symboly nárazníků? Délka přes nárazníky se píše „⊢— 12,04 m —⊣“:
 * na každé straně krátká vodorovná čára ve výšce středu písma a na jejím vnějším konci deska nárazníku –
 * svislá (rovná nebo oblá) čárka, která sahá nad i pod čáru. Šipky („→ 7,00 m ←“, otočné čepy) mají na
 * vnějším konci jen konec čáry, kóta ložné délky („|_10,8 m_|“) je pod písmem. Rozpoznávání textu symboly
 * nečte spolehlivě (z ⊢ udělá T, t, nebo nic), proto se hledají přímo v obraze.
 * Vrací { left, right } (nalezené symboly) – mezi nárazníky je nápis, když jsou oba;
 * debug = i mezivýsledky (výška písma, úseky čar, maska písma) pro ladění na test/img.
 */
export function buffersAround(canvas, box, debug = false) {
  // Šikmý řádek (box.angle z ocr.js, telefon nakřivo) se nejdřív narovná – čára symbolu by jinak vlevo a vpravo
  // ležela v jiné výšce. b = obdélník řádku v narovnaných souřadnicích (otočených kolem středu řádku).
  const a = Math.abs(box.angle ?? 0) > 0.02 ? box.angle : 0;
  const co = Math.cos(a);
  const si = Math.abs(Math.sin(a));
  const thick = a ? Math.max(box.h * 0.3, box.th ?? box.h * co - box.w * si) : box.h;
  const len = a ? Math.max(thick, (box.w - thick * si) / co) : box.w;
  const ccx = box.x + box.w / 2;
  const ccy = box.y + box.h / 2;
  const b = { x: ccx - len / 2, y: ccy - thick / 2, w: len, h: thick };
  const k = Math.min(1, 40 / b.h);   // výška rámečku řádku ~40 bodů
  let x0 = Math.floor(b.x - 2.5 * b.h);
  let x1 = Math.ceil(b.x + b.w + 2.5 * b.h);
  let y0 = Math.floor(b.y - 0.5 * b.h);
  let y1 = Math.ceil(b.y + 1.5 * b.h);
  if (!a) {
    x0 = Math.max(0, x0);
    x1 = Math.min(canvas.width, x1);
    y0 = Math.max(0, y0);
    y1 = Math.min(canvas.height, y1);
  }
  const W = Math.round((x1 - x0) * k);
  const H = Math.round((y1 - y0) * k);
  if (W < 10 || H < 10) return { left: false, right: false };
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (a) {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
  }
  g.scale(k, k);
  g.translate(-x0, -y0);
  g.translate(ccx, ccy);
  g.rotate(-a);
  g.translate(-ccx, -ccy);
  // kreslí se jen okolí výřezu, ne celý snímek
  const rr = Math.hypot(x1 - x0, y1 - y0) / 2 + 2;
  const mx = (x0 + x1) / 2 - ccx;
  const my = (y0 + y1) / 2 - ccy;
  const scx = ccx + mx * Math.cos(a) - my * Math.sin(a);
  const scy = ccy + mx * Math.sin(a) + my * Math.cos(a);
  const sx0 = Math.max(0, Math.floor(scx - rr));
  const sy0 = Math.max(0, Math.floor(scy - rr));
  const sx1 = Math.min(canvas.width, Math.ceil(scx + rr));
  const sy1 = Math.min(canvas.height, Math.ceil(scy + rr));
  if (sx1 <= sx0 || sy1 <= sy0) return { left: false, right: false };
  g.drawImage(canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0);
  const px = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  const bx0 = Math.max(0, Math.round((b.x - x0) * k));
  const bx1 = Math.min(W, Math.round((b.x + b.w - x0) * k));
  const by0 = Math.max(0, Math.round((b.y - y0) * k));
  const by1 = Math.min(H, Math.round((b.y + b.h - y0) * k));

  // písmo proti pozadí: práh (Otsu) z rámečku řádku, písmo je ta menšinová třída
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) { hist[Math.min(255, L[y * W + x] | 0)]++; n++; }
  if (!n) return { left: false, right: false };
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, t = 128, m0 = 0, m1 = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB || wB === n) continue;
    sumB += i * hist[i];
    const a = sumB / wB;
    const b = (sum - sumB) / (n - wB);
    const v = wB * (n - wB) * (a - b) ** 2;
    if (v > best) { best = v; t = i; m0 = a; m1 = b; }
  }
  const above = hist.slice(t + 1).reduce((s, x) => s + x, 0);
  const bright = above < n / 2;
  // místní práh (světlo baterky bývá nerovnoměrné): písmo = o kus světlejší/tmavší než okolí
  const d = Math.max(10, (m1 - m0) * 0.3);
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += L[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const r = Math.max(4, Math.round(0.6 * b.h * k));
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1);
      const mean = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
      const v = L[y * W + x];
      ink[y * W + x] = bright ? v - mean > d : mean - v > d;
    }
  }

  // svislé úseky písma v každém sloupci
  const runs = [];
  for (let x = 0; x < W; x++) {
    const col = [];
    let s = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && ink[y * W + x];
      if (on && s < 0) s = y;
      if (!on && s >= 0) { col.push([s, y - 1]); s = -1; }
    }
    runs.push(col);
  }
  // Výška a střed písma: nejdelší svislý úsek ve sloupcích rámečku, z nich ty dlouhé (dříky číslic).
  // Rámeček z rozpoznávání bývá vyšší než písmo a zasahují do něj čáry okolních rámečků, řádky proto nestačí.
  const longest = [];
  for (let x = bx0; x < bx1; x++) {
    let best = null;
    for (const [a, b] of runs[x]) if (b >= by0 && a <= by1 && (!best || b - a > best[1] - best[0])) best = [a, b];
    if (best) longest.push(best);
  }
  if (longest.length < 3) return { left: false, right: false };
  longest.sort((p, q) => p[1] - p[0] - (q[1] - q[0]));
  const ref = longest[Math.floor(longest.length * 0.9)];
  const th = ref[1] - ref[0] + 1;   // výška písma
  const stems = longest.filter(([a, b]) => b - a + 1 >= th * 0.8).map(([a, b]) => (a + b) / 2).sort((p, q) => p - q);
  const cy = stems[Math.floor(stems.length / 2)];   // střed písma
  if (th < 6) return { left: false, right: false };

  // tenká vodorovná čára zhruba ve výšce středu písma (bývá o kus výš, desetinná místa jsou menší, telefon nakloněný);
  // kóta ložné délky pod písmem je níž než 0,6 výšky písma od středu
  const lineY = runs.map((col) => {
    const hit = col.find(([s, e]) => e - s + 1 <= 0.4 * th && Math.abs((s + e) / 2 - cy) <= 0.3 * th);
    return hit ? (hit[0] + hit[1]) / 2 : null;
  });
  // deska nárazníku: úsek, který sahá aspoň 0,3 výšky písma nad i pod čáru (svislice kóty „|_“ pod čáru nesahá)
  const bar = (x, y) => x >= 0 && x < W && runs[x].some(([s, e]) => s <= y - 0.3 * th && e >= y + 0.3 * th);
  const near = (xa, xb, y) => { for (let x = Math.round(xa); x <= Math.round(xb); x++) if (bar(x, y)) return true; return false; };

  const center = (bx0 + bx1) / 2;
  const found = { left: false, right: false };
  const segs = [];
  for (let x = 0; x < W;) {
    if (lineY[x] === null) { x++; continue; }
    let e = x;
    while (e + 1 < W && (lineY[e + 1] !== null || (e + 2 < W && lineY[e + 2] !== null))) e++;
    const len = e - x + 1;
    // výška čáry = medián přes sloupce (krajní sloupce můžou patřit oblé desce nárazníku)
    const ys = lineY.slice(x, e + 1).filter((v) => v !== null).sort((p, q) => p - q);
    const y = ys[Math.floor(ys.length / 2)];
    if (debug) segs.push([x, e, Math.round(y), near(x - 0.25 * th, x + 0.1 * th, y), near(e - 0.1 * th, e + 0.25 * th, y)]);
    if (len >= 0.5 * th) {
      // vlevo od nápisu „⊢—“ (deska na levém konci), vpravo „—⊣“ (deska na pravém konci)
      if (e < center && near(x - 0.25 * th, x + 0.1 * th, y)) found.left = true;
      if (x > center && near(e - 0.1 * th, e + 0.25 * th, y)) found.right = true;
    }
    x = e + 1;
  }
  return debug ? { ...found, th, cy, k, center, segs, ink, W, H } : found;
}
