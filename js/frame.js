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
