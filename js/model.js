// Pravidla aplikace: čísla vozů, hledání čísla v přečteném textu, přestavovače, brzdicí procenta.

// ───── Číslo vozu: 12 číslic, zobrazení "XX XX XXXX XXX-X" (stejně jako v Závadách vozů) ─────

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

export function formatNumber(n) {
  const d = digitsOnly(n).slice(0, 12);
  const head = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8), d.slice(8, 11)].filter(Boolean).join(' ');
  return d.length > 11 ? `${head}-${d[11]}` : head;
}

// Kontrolní číslice UIC (Luhnův algoritmus): číslice střídavě ×2 a ×1 zleva,
// sečtou se ciferné součty, kontrolní číslice doplní součet do násobku 10.
export function checkDigit(number) {
  const d = digitsOnly(number);
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const p = Number(d[i]) * (i % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

export const isCompleteNumber = (n) => /^\d{12}$/.test(digitsOnly(n));
export const isValidCheckDigit = (n) =>
  isCompleteNumber(n) && checkDigit(n) === Number(digitsOnly(n)[11]);

// Kódy států (3. a 4. číslice) – jen pro řazení kandidátů, neznámý stát číslo neodmítne.
const COUNTRIES = new Set([10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 41, 44, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 65, 66, 67, 68, 70, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 94]);

// Znaky, které síť u číslic plete s písmeny (jen v „převážně číselných“ slovech).
const LOOKALIKE = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2',
  S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9' };

// Přečtené řádky → číselná slova v pořadí čtení. Slovo s většinou číslic se opraví (O→0, I→1 …),
// slova z písmen (RIV, TEN, D-DB, PL-FPL …) se přeskočí – na novějších vozech bývají mezi částmi čísla.
// Desetinná čísla (tabulka zatížení „48,0“, „62.5“) nejsou části čísla vozu. Čárka v čísle vozu nebývá nikdy,
// tečka jen místo pomlčky před kontrolní číslicí (za trojčíslím) – proto se maže jen tečka za 1–2 číslicemi.
const DECIMAL = /\b\d+,\d+\b|\b\d{1,2}\.\d+\b/g;

// Kód státu bývá nalepený na značku držitele („80D-DB“, „54CZ-ČDC“, „80D-“ se značkou v dalším rámečku) – oddělí se,
// jinak by se D četlo jako 0.
const KEEPER = /(\d)(?=\p{Lu}{1,3}-(?:\p{Lu}{2}|\s|$))/gu;
// Kód státu nalepený na svou značku i bez pomlčky za ní („80D“ u přetřeného držitele, „80D-V“, „54CZ“) – oddělí se,
// jen když značka ke kódu patří (80 = D, 54 = CZ …), aby se „40O“ v těle čísla dál četlo jako 400.
const MARKS = { 10: 'FIN', 20: 'RUS', 21: 'BY', 22: 'UA', 23: 'MD', 24: 'LT', 25: 'LV', 26: 'EST', 27: 'KZ', 28: 'GE',
  41: 'AL', 44: 'BIH', 50: 'BIH', 51: 'PL', 52: 'BG', 53: 'RO', 54: 'CZ', 55: 'H', 56: 'SK', 57: 'AZ', 58: 'AM', 59: 'KS',
  60: 'IRL', 62: 'MNE', 65: 'MK', 70: 'GB', 71: 'E', 72: 'SRB', 73: 'GR', 74: 'S', 75: 'TR', 76: 'N', 78: 'HR', 79: 'SLO',
  80: 'D', 81: 'A', 82: 'L', 83: 'I', 84: 'NL', 85: 'CH', 86: 'DK', 87: 'F', 88: 'B', 94: 'P' };
const GLUED = /\b(\d{2})(\p{Lu}{1,3})(?![\p{L}\d])/gu;
const unglue = (m, cc, mark) => (MARKS[cc] === mark ? `${cc} ${mark}` : m);
// Dvojčíslí nalepené na RIV/TEN/PPW („31RIV“, i „31RV“) – oddělí se, jinak slovo s převahou písmen vypadne celé.
const MARK = /(\d)(?=(?:RI?V|TEN|PPW)\b)/g;
// Mezera mezi dvojčíslími přečtená jako tečka („31.54 3939 735-9“) – před osmi číslicemi to není desetinné číslo.
const PAIR_DOT = /\b(\d{2})\.(\d{2})(?=\s?\d{4}\s?\d{3})/g;
// … ani samotné „31.54“ v rámečku nad tělem nebo vedle něj, když je za tečkou kód státu
const PAIR_ALONE = /^\s*(\d{2})\.(\d{2})\s*$/;
const unpair = (m, a, b) => (COUNTRIES.has(Number(b)) ? `${a} ${b}` : m);

// Řádky s telefonem, e-mailem nebo adresou držitele („D-55252 Mainz-Kastel“, „+496134/94844-0“, „CZ 160 00“,
// „Komornická 7, Praha 6“, „421 01 Litoměřice“) – jejich číslice složily falešné číslo s platnou kontrolní číslicí
// nebo se vmísily mezi řádky čísla vedle nich.
const CONTACT = /\+\s?\d|@|\b(tel|fax|e-?mail|www|gmbh|str(aße|asse)?\.?)\b|\b[A-Z]-\d{4,5}\b/i;
const ADDRESS = /\b(?:CZ|SK)[- ]?\d{3} ?\d{2}\b|\b\d{3} \d{2} \p{Lu}\p{Ll}{3,}|\bPraha\b/u;

function digitTokens(lines) {
  const tokens = [];
  for (const [li, l] of lines.entries()) {
    if (CONTACT.test(l.text) || ADDRESS.test(l.text)) continue;
    const text = l.text.replace(PAIR_ALONE, unpair).replace(PAIR_DOT, '$1 $2').replace(DECIMAL, ' ')
      .replace(KEEPER, '$1 ').replace(GLUED, unglue).replace(MARK, '$1 ');
    for (const word of text.split(/[^0-9A-Za-z|!]+/)) {
      const digits = word.replace(/\D/g, '').length;
      if (!digits || digits / word.length < 0.6) continue;
      const d = [...word].map((c) => (/\d/.test(c) ? c : LOOKALIKE[c] ?? '')).join('');
      // výška písma: u narovnaného řádku jeho tloušťka (obdélník šikmého řádku je vyšší než písmo)
      tokens.push({ d, li, row: l.row ?? 0, h: l.th ?? l.h ?? 1, conf: l.conf ?? 0, first: !tokens.some((t) => t.li === li) });
    }
  }
  return tokens;
}

// Čísla na voze bývají rozdělená 2-2-4-3-1 (nebo po řádcích 2 / 2 / 4 3-1).
const GROUP_ENDS = new Set([2, 4, 8, 11, 12]);

/**
 * Najde v přečtených řádcích (výstup readText) možná čísla vozů – i rozdělená do více řádků.
 * Vrací [{ number, valid, sure, score, lines }] od nejpravděpodobnějšího; valid = sedí kontrolní číslice,
 * lines = indexy řádků, ze kterých se číslo složilo.
 * known = indexWagons(čísla známých vozů): doplní začátek čísla, který se na voze nepřečetl (filled).
 */
export function numberCandidates(lines, known) {
  const tokens = digitTokens(lines);
  const found = new Map();
  // block = složeno z rozložení na voze (dvojčíslí + osm číslic v jednom řádku), rozdělení do skupin je tím dané;
  // filled = začátek čísla doplněný ze známých vozů: 'vuz' = vůz se stejným koncem čísla, 'rada' = jen podle řady
  const add = (number, parts, aligned, block = false, filled = null) => {
    const valid = isValidCheckDigit(number);
    const country = COUNTRIES.has(Number(number.slice(2, 4)));
    let n = 0;
    const grouped = block || (aligned && parts.every((t) => GROUP_ENDS.has((n += t.d.length))));
    const rows = parts.at(-1).row - parts[0].row;
    const score = parts.reduce((a, t) => a + t.conf, 0) / parts.length - rows * 0.3
      + (valid ? 10 : 0) + (country ? 2 : 0) + (grouped ? 2 : aligned ? 1 : 0) - (filled === 'rada' ? 3 : 0);
    // „jisté“ číslo: sedí kontrolní číslice, kód státu i rozdělení do skupin (náhodná shoda je velmi vzácná);
    // začátek doplněný jen podle řady jisté není (stejnou řadu mívají vozy různých držitelů)
    const sure = valid && country && grouped && filled !== 'rada';
    const prev = found.get(number);
    if (!prev || prev.score < score) found.set(number, { number, valid, sure, score, lines: [...new Set(parts.map((t) => t.li))], ...(filled ? { filled } : {}) });
  };
  for (let i = 0; i < tokens.length; i++) {
    let all = '';
    const parts = [];
    const rows = new Set();
    for (let j = i; j < tokens.length && j < i + 8; j++) {
      const t = tokens[j];
      // části jednoho čísla: nejvýš 3 řádky s číslicemi pod sebou (řádky jen s písmeny – RIV, D-DB, úlomek
      // „-“ – se nepočítají) a podobně velké písmo
      if (!rows.has(t.row) && rows.size === 3) break;
      rows.add(t.row);
      if (Math.max(t.h, tokens[i].h) / Math.min(t.h, tokens[i].h) > 1.8) continue;
      all += t.d;
      parts.push(t);
      if (all.length === 12) add(all, parts, true);
      if (all.length >= 12) {
        if (parts.length === 1) for (let k = 0; k + 12 <= all.length; k++) add(all.slice(k, k + 12), parts, false);
        else add(all.slice(0, 12), parts, false);
        break;
      }
    }
  }
  const blocks = numberBlocks(lines, tokens);
  for (const [a, b, body] of blocks.out) add(a.d + b.d + body.map((t) => t.d).join(''), [a, b, ...body], true, true);
  // Začátek čísla, který se na voze nepřečetl (přetřené nebo vybledlé „83“ nad „54 CZ-VDSP“ / „6836 052-3“), se doplní
  // ze známých vozů: tělo (5.–12. číslice, kontrolní číslice v něm) shodné s jediným známým vozem = jisté číslo,
  // jinak se jen nabídnou začátky vozů stejné řady (5.–8. číslice), se kterými sedí kontrolní číslice.
  if (known) {
    // i tělo rozdělené do obdélníků vedle sebe („6836“ „052-3“): po sobě jdoucí slova jednoho řádku s osmi číslicemi
    const split = [];
    for (let i = 0; i < tokens.length; i++) {
      let n = 0;
      let j = i;
      while (j < tokens.length && tokens[j].row === tokens[i].row && n < 8) n += tokens[j++].d.length;
      const body = tokens.slice(i, j);
      if (n !== 8 || tokens[i].d.length < 3 || new Set(body.map((t) => t.li)).size < 2) continue;
      split.push({ body, cc: tokens.slice(0, i).reverse().find((t) => t.first && t.d.length === 2 && t.row === tokens[i].row - 1) ?? null });
    }
    for (const { body, cc } of [...blocks.bodies, ...split]) {
      const b = body.map((t) => t.d).join('');
      const parts = cc ? [cc, ...body] : body;
      const same = known.body.get(b) ?? [];
      // kód státu přečtený nad tělem nebo před ním vybere mezi vozy se stejným tělem (sám může být přečtený špatně)
      const pick = same.length === 1 ? same : same.filter((x) => x.slice(2, 4) === cc?.d);
      if (pick.length === 1) {
        if (!found.has(pick[0])) add(pick[0], parts, true, true, 'vuz');
        continue;
      }
      const offers = same.length ? same : [...(known.series.get(b.slice(0, 4)) ?? [])].map((p) => p + b).filter(isValidCheckDigit);
      const own = offers.filter((x) => x.slice(2, 4) === cc?.d);
      for (const x of (own.length ? own : offers).slice(0, 3)) if (!found.has(x)) add(x, parts, true, true, 'rada');
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * Rejstřík známých čísel vozů (evidence, paměť vozů) pro numberCandidates: body = 5.–12. číslice → čísla vozů,
 * series = 5.–8. číslice (řada) → první čtyři číslice vozů té řady.
 */
export function indexWagons(numbers) {
  const body = new Map();
  const series = new Map();
  for (const n of new Set(numbers)) {
    if (!/^\d{12}$/.test(n) || !isValidCheckDigit(n)) continue;
    if (!body.has(n.slice(4))) body.set(n.slice(4), []);
    body.get(n.slice(4)).push(n);
    if (!series.has(n.slice(4, 8))) series.set(n.slice(4, 8), new Set());
    series.get(n.slice(4, 8)).add(n.slice(0, 4));
  }
  return { body, series };
}

/**
 * Číslo podle rozložení na voze, nezávisle na pořadí řádků (na novějších vozech „33 RIV“ / „80 D-TWA“ / „2742 187-8“:
 * při mírném náklonu se řádky slijí a pořadí se pomíchá, mezi části vlezou cizí číslice). Tělo = osm číslic
 * v jednom řádku (i rozdělených „495 6 322-2“ nebo v obdélnících těsně vedle sebe); před ním dvě dvojčíslí,
 * každé na začátku svého řádku: pod sebou zarovnaná vlevo s tělem (nad ním), nebo vlevo od těla ve stejném
 * řádku (tam i obě v jednom obdélníku „84 54“). Vrací out = [[a, b, tělo]]
 * a bodies = [{ body, cc }] – každé tělo s dvojčíslím těsně nad ním nebo před ním (kód státu), pokud je.
 */
function numberBlocks(lines, tokens) {
  const out = [];
  const bodies = [];
  const box = (t) => lines[t.li];
  // svislá poloha kolmo na převažující sklon řádků: na šikmém snímku jsou řádky „33 RIV“ / „80 D-TWA“ / tělo
  // podle středů obdélníků skoro ve stejné výšce. Sklon = medián vážený plochou obdélníku, řádky bez sklonu
  // (čtení narovnává až od 2°) se počítají jako rovné – jinak sklon určil drobný text okolo (šikmá cedulka,
  // tabulka) a rovné řádky čísla se rozešly (sortLines v ocr.js počítá jen narovnané řádky).
  const angles = lines.map((l) => [l.angle ?? 0, l.w * l.h]).sort((a, b) => a[0] - b[0]);
  let half = angles.reduce((s, [, w]) => s + w, 0) / 2;
  const tilt = angles.find(([, w]) => (half -= w) <= 0)?.[0] ?? 0;
  const cy = (t) => -(box(t).x + box(t).w / 2) * Math.sin(tilt) + (box(t).y + box(t).h / 2) * Math.cos(tilt);
  const pairs = tokens.filter((t) => t.first && t.d.length === 2);
  // obdélníky jen s dvojčíslími („84 54“ vlevo od těla) – vlevo se počítají všechna jejich dvojčíslí
  const pairBox = (li) => tokens.every((t) => t.li !== li || t.d.length === 2);
  for (const li of new Set(tokens.map((t) => t.li))) {
    const own = tokens.filter((t) => t.li === li);
    // tělo: souvislá část slov řádku s právě osmi číslicemi (4-3-1, s rozdělením, které čtení přidá), případně
    // pokračující v obdélnících těsně napravo ve stejné výšce („6992“ „021- 9 Faccs“ – na šikmé fotce jim
    // čtení může přidělit i různé řádky)
    for (let i = 0; i < own.length; i++) {
      if (own[i].d.length < 3) continue;
      const h = own[i].h;
      const body = [];
      let n = 0;
      for (let j = i; j < own.length && n < 8; j++) n += body[body.push(own[j]) - 1].d.length;
      for (let last = li; n < 8;) {
        const L = lines[last];
        const next = tokens.filter((t) => t.first && t.li !== last && !body.includes(t) && box(t).x > L.x + L.w * 0.5
          && box(t).x - (L.x + L.w) < h * 2 && Math.abs(cy(t) - cy(body.at(-1))) < h * 0.5
          && Math.max(t.h, h) / Math.min(t.h, h) < 1.4).sort((p, q) => box(p).x - box(q).x)[0];
        if (!next) break;
        last = next.li;
        for (const t of tokens) if (t.li === last && n < 8) n += body[body.push(t) - 1].d.length;
      }
      if (n !== 8) continue;
      const B = box(body[0]);
      const yb = cy(body[0]);
      // dvojčíslí bývají menším písmem než tělo (na vozech TSI zhruba polovičním)
      const near = pairs.filter((p) => p.li !== li && Math.max(p.h, h) / Math.min(p.h, h) < 2.6);
      const side = tokens.filter((p) => p.d.length === 2 && p.li !== li && (p.first || pairBox(p.li))
        && Math.max(p.h, h) / Math.min(p.h, h) < 2.6);
      // pod sebou: nad tělem, levý okraj do 1,5 výšky těla od levého okraje těla; řádky od sebe aspoň
      // půl výšky svého písma, nejvýš 3 výšky těla
      const above = near.filter((p) => cy(p) < yb && Math.abs(box(p).x - B.x) < h * 1.5).sort((p, q) => cy(p) - cy(q));
      for (let k = 0; k + 1 < above.length; k++) {
        const [a, b] = [above[k], above[k + 1]];
        if (cy(b) - cy(a) > a.h * 0.5 && yb - cy(b) > b.h * 0.5 && yb - cy(a) < h * 3) out.push([a, b, body]);
      }
      // v jednom řádku: dvě dvojčíslí vlevo od těla ve stejné výšce (samostatné rámečky v pořadí zleva,
      // pak dvojčíslí na začátku řádku těla „52 495 6 322-2“)
      const left = [...side.filter((p) => Math.abs(cy(p) - yb) < Math.max(p.h, h) * 0.5 && box(p).x + box(p).w <= B.x + h * 0.3
        && B.x - box(p).x < Math.max(p.h, h) * 8).sort((p, q) => box(p).x - box(q).x || tokens.indexOf(p) - tokens.indexOf(q)),
      ...own.slice(0, i).filter((t) => t.d.length === 2)];
      if (left.length >= 2) out.push([left.at(-2), left.at(-1), body]);
      // kód státu: nejbližší dvojčíslí nad tělem (do 1,5 výšky těla), jinak vlevo ve stejném řádku
      const up = above.filter((p) => yb - cy(p) > p.h * 0.5 && yb - cy(p) < h * 1.5).at(-1);
      bodies.push({ body, cc: up ?? left.at(-1) ?? null });
    }
  }
  return { out, bodies };
}

// ───── Přestavovače a brzda ─────

/** Polohy přestavovače prázdný – ložený (P-L, P-½L-L) a samočinný (předpis příl. 2, čl. 567, 288). */
export const LOAD_POSITIONS = [['prazdny', 'Prázdný'], ['polo', '½ ložený'], ['lozeny', 'Ložený'], ['auto', 'Samočinný']];

/** Co vozmistr u vozu nastavuje/kontroluje; pořadí = pořadí na obrazovce. */
export const SWITCHES = {
  rezim: {
    title: 'Přestavovač G/P', short: 'Režim',
    options: [['G', 'G'], ['P', 'P']],
  },
  naklad: {
    title: 'Přestavovač prázdný / ložený', short: 'P/L',
    options: LOAD_POSITIONS,
  },
  kohout: {
    title: 'Brzda (uzavírací kohout)', short: 'Brzda',
    options: [['zapnuta', 'Zapnuta'], ['vypnuta', 'Vypnuta']],
  },
  rucni: {
    title: 'Ruční brzda', short: 'Ruční',
    options: [['odbrzdena', 'Odbrzděna'], ['zabrzdena', 'Zabrzděna'], ['nema', 'Nemá']],
  },
};

export const optionLabel = (kind, value) =>
  SWITCHES[kind]?.options.find(([v]) => v === value)?.[1] ?? '';

/** Brzdicí váhy z nápisu na voze: klíč režim_náklad. */
export const BRAKE_WEIGHTS = [
  ['P_prazdny', 'P prázdný'], ['P_lozeny', 'P ložený'],
  ['G_prazdny', 'G prázdný'], ['G_lozeny', 'G ložený'],
];
/** Přestavovač P-½L-L má navíc polohu ½ ložený. */
export const BRAKE_WEIGHTS_HALF = [['P_polo', 'P ½ ložený'], ['G_polo', 'G ½ ložený']];

/** Kolonka 51 výkazu – druh brzdových špalíků. */
export const BLOCKS = [
  ['K', 'K', 'nekovové špalíky typ K'],
  ['L', 'L', 'nekovové špalíky typ L'],
  ['LL', 'LL', 'nekovové špalíky typ LL'],
  ['D', 'D', 'kotoučová brzda'],
  ['F', 'F', 'litinové špalíky'],
];

/** Údaje z nápisů, které patří k vozu (pamatují se podle čísla) – [klíč, popis, jednotka]. */
export const WAGON_FIELDS = [
  ['axles', 'Počet náprav', ''],
  ['length_m', 'Délka přes nárazníky', 'm'],
  ['tare_kg', 'Hmotnost prázdného vozu', 'kg'],
  ['hand_bw_t', 'Síla zajišťovací brzdy', 't'],
  ['hand_force_kn', 'Zajišťovací síla', 'kN'],
  ['max_speed', 'Nejv. dovolená rychlost', 'km/h'],
];
// change_t = přestavná hmotnost (t) ze štítku přestavovače, u P-½L-L change2_t = mezi ½ ložený a ložený;
// bw_max = „MAX … t“ u samočinného brzdění podle nákladu; load_auto = vůz má samočinný přestavovač.
// Zajišťovací síla (čl. 562): hand_force_kn = jeden údaj „… kN“; novější nápis „Min … kN (Max … kN) n/N“ =
// hand_force_min_kn, hand_force_max_kn, hand_n (náprav s ruční brzdou) a hand_N (všech náprav vozu).
const STATIC_KEYS = [...WAGON_FIELDS.map(([k]) => k), 'blocks', 'revision', 'hand_brake', 'series',
  'change_t', 'change2_t', 'bw_max', 'load_auto', 'hand_force_min_kn', 'hand_force_max_kn', 'hand_n', 'hand_N'];

/**
 * Nový vůz ve výkazu: údaje z nápisů z paměti (wagon), polohy přestavovačů a stanice určení
 * jako u předchozího vozu (prev), jinak cílová stanice vlaku.
 */
export function newEntry(number, wagon, prev, toStation = '') {
  return {
    id: uid(),
    number,
    rezim: prev?.rezim ?? 'P',
    // samočinný přestavovač je vlastnost vozu (od předchozího vozu se nepřebírá), ruční poloha ano
    naklad: wagon?.load_auto ? 'auto' : prev?.naklad === 'auto' ? 'prazdny' : prev?.naklad ?? 'prazdny',
    kohout: 'zapnuta',
    rucni: wagon?.hand_brake === 'nema' ? 'nema' : 'odbrzdena',
    hand_checked: false,
    ...Object.fromEntries(STATIC_KEYS.map((k) => [k, wagon?.[k] ?? null])),
    bw: { ...(wagon?.bw ?? {}) },
    cargo_kg: null,
    destination: prev?.destination || toStation,
    rid_un: '',
    rid_icn: '',
    exceptional: false,
    track_class: null,
    samples: [],
    note: '',
  };
}

/**
 * Údaje z řady vozu (seriesInfo z js/series.js) do vozu ve výkazu – jen tam, kde nic není (paměť vozu
 * a ruční zadání mají přednost). U nejistého počtu náprav poznámka, ať ho vozmistr zadá ručně.
 */
export function applySeries(entry, info) {
  if (!info) return entry;
  entry.series ??= info.series;
  if (entry.axles == null && info.axles.sure) entry.axles = info.axles.value;
  if (entry.max_speed == null && info.speed) entry.max_speed = info.speed;
  entry.series_note = info.axles.sure ? null : `Podle řady ${info.series}: ${info.axles.note ?? 'počet náprav nejde určit'} – zadejte ručně.`;
  return entry;
}

/**
 * Opravené číslo vozu: co se převzalo ze staré řady (oldInfo), se zahodí a doplní podle nového čísla –
 * nejdřív z paměti vozu (wagon), pak z řady (info). Co vozmistr zadal ručně, zůstane.
 */
export function renumberEntry(e, number, wagon, oldInfo, info) {
  const entered = Object.fromEntries(Object.entries(e.bw ?? {}).filter(([, v]) => v != null));
  const next = { ...e, number, series: null, series_note: null, bw: { ...(wagon?.bw ?? {}), ...entered } };
  if (oldInfo?.axles.sure && num(e.axles) === oldInfo.axles.value) next.axles = null;
  if (oldInfo?.speed && num(e.max_speed) === oldInfo.speed) next.max_speed = null;
  for (const k of STATIC_KEYS) if (next[k] == null && wagon?.[k] != null) next[k] = wagon[k];
  // jako u nového vozu: bez ruční brzdy, samočinný přestavovač
  if (e.hand_brake == null && next.hand_brake === 'nema') next.rucni = 'nema';
  if (e.load_auto == null && next.load_auto) next.naklad = 'auto';
  return applySeries(next, info);
}

/** Údaje vozu, které se uloží k číslu vozu pro příště. */
export const wagonFromEntry = (e) => ({
  number: e.number,
  ...Object.fromEntries(STATIC_KEYS.map((k) => [k, e[k] ?? null])),
  bw: { ...e.bw },
  updated_at: new Date().toISOString(),
});

export const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Kolonka 52: brzdicí váha vozu (t) pro režim P nebo G podle polohy přestavovače prázdný/ložený (čl. 285:
 * u ručního jen hodnota u polohy kliky). Vypnutá brzda → null (pole se ve výkazu proškrtne).
 * Samočinný (čl. 288): s „MAX … t“ dopravní hmotnost, nejvýš MAX (pro G i P; údaje výrobce aplikace nemá);
 * samočinný přestavovač P-L pod přestavnou hmotností hodnota prázdný, od ní ložený; bez přestavné hmotnosti ložený.
 */
export function bwFor(e, mode) {
  if (e.kohout === 'vypnuta') return null;
  const bw = e.bw ?? {};
  if (e.naklad !== 'auto') return num(bw[`${mode}_${e.naklad}`]);
  const kg = entryMassKg(e);
  if (num(e.bw_max) !== null) return kg === null ? null : Math.min(num(e.bw_max), Math.floor(kg / 1000));
  if (num(e.change_t) !== null && kg !== null) return num(bw[`${mode}_${kg / 1000 < num(e.change_t) ? 'prazdny' : 'lozeny'}`]);
  return num(bw[`${mode}_lozeny`]);
}

/**
 * Čl. 285: v jaké poloze má být ruční přestavovač – prázdný pod přestavnou hmotností, ložený od ní
 * (P-½L-L: ½ ložený mezi oběma přestavnými hmotnostmi). null = nejde určit (chybí náklad nebo přestavná hmotnost).
 */
export function wantedLoad(e) {
  const c1 = num(e.change_t);
  const kg = entryMassKg(e);
  if (e.naklad === 'auto' || c1 === null || kg === null || num(e.cargo_kg) === null) return null;
  const t = kg / 1000;
  const c2 = num(e.change2_t);
  return t < c1 ? 'prazdny' : c2 !== null && t < c2 ? 'polo' : 'lozeny';
}

/**
 * Brzdicí váhy přečtené u přestavovače (lb: empty, half, loaded, change, change2, max) → údaje vozu.
 * Štítek platí pro G i P (pohyblivá pravítka s různými hodnotami, čl. 567 c), se opraví v kartě vozu);
 * co se nepřečetlo, zůstane z paměti.
 */
export function loadBrakeToWagon(lb, position, old = {}) {
  const bw = { ...(old.bw ?? {}) };
  for (const mode of ['G', 'P']) {
    if (lb?.empty != null) bw[`${mode}_prazdny`] = lb.empty;
    if (lb?.half != null) bw[`${mode}_polo`] = lb.half;
    if (lb?.loaded != null) bw[`${mode}_lozeny`] = lb.loaded;
  }
  return {
    bw,
    change_t: lb?.change ?? old.change_t ?? null,
    change2_t: lb?.change2 ?? old.change2_t ?? null,
    bw_max: lb?.max ?? old.bw_max ?? null,
    load_auto: position ? position === 'auto' : old.load_auto ?? null,
  };
}

/** Brzdicí váha vozu ve vlaku (t) podle polohy přestavovače G/P; vypnutá brzda = 0. */
export const entryBrakeWeight = (e) => (e.kohout === 'vypnuta' ? 0 : bwFor(e, e.rezim));

/** Celková hmotnost vozu (kg) = prázdný vůz + náklad. */
export const entryMassKg = (e) => (num(e.tare_kg) === null ? null : num(e.tare_kg) + (num(e.cargo_kg) ?? 0));

/** Kolonka 58: traťová třída podle hmotnosti na nápravu (A ≤ 16 t, B ≤ 18 t, C ≤ 20 t, D ≤ 22,5 t). */
export function trackClass(e) {
  if (e.track_class) return e.track_class;
  const m = entryMassKg(e);
  const axles = num(e.axles);
  if (m === null || !axles) return null;
  const perAxle = m / axles / 1000;
  return perAxle <= 16 ? 'A' : perAxle <= 18 ? 'B' : perAxle <= 20 ? 'C' : perAxle <= 22.5 ? 'D' : 'E';
}

// Obvyklé meze údajů z nápisů – stejné jako pravidla čtení v tréninku (fields.js RULES, BW_RANGE).
// Hodnota mimo ně bývá překlep nebo jiná jednotka (t místo kg); karta vozu ji označí, nic sama neopraví.
const RANGES = {
  axles: [2, 12], length_m: [5, 40], tare_kg: [8000, 60000], hand_bw_t: [3, 60], hand_force_kn: [3, 200],
  max_speed: [10, 200], bw: [5, 200], change_t: [5, 200], change2_t: [5, 200], bw_max: [5, 200],
  hand_force_min_kn: [3, 200], hand_force_max_kn: [3, 200],
};
const MAX_AXLE_T = 22.5;   // nejvyšší hmotnost na nápravu, traťová třída D

/**
 * Neobvyklé údaje vozu ke kontrole: [{ key, text }], key = pole v kartě vozu (brzdicí váhy „bw.P_lozeny“).
 * Meze z nápisů, kg zadané v tunách, ložený nad prázdným, hmotnost na nápravu.
 */
export function wagonWarnings(e) {
  const out = [];
  const range = (key, v, name, unit, [lo, hi]) => {
    if (v === null || (v >= lo && v <= hi)) return;
    const u = unit ? ` ${unit}` : '';
    out.push({ key, text: `${name} ${fmt(v, 2)}${u} – bývá ${fmt(lo)}–${fmt(hi)}${u}` });
  };
  for (const [key, name, unit] of WAGON_FIELDS) {
    const v = num(e[key]);
    if (unit === 'kg' && v !== null && v > 0 && v < 100) {
      out.push({ key, text: `${name} se zadává v kg: ${fmt(v, 2)} t = ${fmt(Math.round(v * 1000))} kg` });
    } else if (key === 'axles' && v !== null && !Number.isInteger(v)) {
      out.push({ key, text: 'Počet náprav musí být celé číslo' });
    } else range(key, v, name, unit, RANGES[key]);
  }
  const cargo = num(e.cargo_kg);
  if (cargo !== null && cargo > 0 && cargo < 100) {
    out.push({ key: 'cargo_kg', text: `Hmotnost nákladu se zadává v kg: ${fmt(cargo, 2)} t = ${fmt(Math.round(cargo * 1000))} kg` });
  }
  const bw = e.bw ?? {};
  for (const [k, name] of [...BRAKE_WEIGHTS, ...BRAKE_WEIGHTS_HALF]) range(`bw.${k}`, num(bw[k]), `Brzdicí váha ${name}`, 't', RANGES.bw);
  for (const m of ['P', 'G']) {
    const [empty, half, loaded] = ['prazdny', 'polo', 'lozeny'].map((p) => num(bw[`${m}_${p}`]));
    if (empty !== null && loaded !== null && loaded <= empty) {
      out.push({ key: `bw.${m}_lozeny`, text: `Brzdicí váha ${m} ložený (${fmt(loaded)} t) bývá vyšší než prázdný (${fmt(empty)} t)` });
    }
    if (half !== null && ((empty !== null && half <= empty) || (loaded !== null && half >= loaded))) {
      out.push({ key: `bw.${m}_polo`, text: `Brzdicí váha ${m} ½ ložený (${fmt(half)} t) bývá mezi prázdným a loženým` });
    }
  }
  range('change_t', num(e.change_t), 'Přestavná hmotnost', 't', RANGES.change_t);
  range('change2_t', num(e.change2_t), 'Přestavná hmotnost ½ → ložený', 't', RANGES.change2_t);
  if (num(e.change_t) !== null && num(e.change2_t) !== null && num(e.change2_t) <= num(e.change_t)) {
    out.push({ key: 'change2_t', text: `Přestavná hmotnost ½ → ložený (${fmt(e.change2_t)} t) bývá vyšší než prázdný → ½ (${fmt(e.change_t)} t)` });
  }
  range('bw_max', num(e.bw_max), 'MAX', 't', RANGES.bw_max);
  range('hand_force_min_kn', num(e.hand_force_min_kn), 'Zajišťovací síla Min', 'kN', RANGES.hand_force_min_kn);
  range('hand_force_max_kn', num(e.hand_force_max_kn), 'Zajišťovací síla Max', 'kN', RANGES.hand_force_max_kn);
  const [hn, hN] = [num(e.hand_n), num(e.hand_N) ?? num(e.axles)];
  if (hn !== null && (!Number.isInteger(hn) || hn < 1 || (hN !== null && hn > hN))) {
    out.push({ key: 'hand_n', text: `Náprav s ruční brzdou (n = ${fmt(hn)}) musí být celé číslo od 1 do počtu náprav vozu` });
  }
  const m = entryMassKg(e);
  const axles = num(e.axles);
  if (m !== null && axles >= 1 && m / axles / 1000 > MAX_AXLE_T) {
    out.push({ key: cargo ? 'cargo_kg' : 'tare_kg',
      text: `Na nápravu vychází ${fmt(m / axles / 1000)} t – víc než ${fmt(MAX_AXLE_T)} t (traťová třída D); zkontrolujte hmotnosti a nápravy` });
  }
  return out;
}

/**
 * Zajišťovací síla vozu podle nápisu a dopravní hmotnosti (čl. 63 b, 427; dopravní hmotnost v t = kN, n/N =
 * náprav s ruční brzdou / všech náprav, N není-li vyznačeno = počet náprav vozu). Výsledek se zaokrouhluje dolů na 0,1 kN.
 * Nápis „Min … kN (Max … kN)“: prázdný vůz Min, jinak dopravní hmotnost × n/N v mezích Min–Max; jen Min = vždy Min;
 * Max menší než Min (starší vozy) = u loženého i částečně loženého vozu nižší hodnota bez přepočtu.
 * Jeden údaj „… kN“: dopravní hmotnost × n/N, nejvýš vyznačená hodnota; bez n/N vyznačená hodnota.
 * Vrací { value (kN; null = nápis chybí), why }.
 */
export function handForceInfo(e) {
  const min = num(e.hand_force_min_kn);
  const max = num(e.hand_force_max_kn);
  const single = num(e.hand_force_kn);
  const n = num(e.hand_n);
  const N = num(e.hand_N) ?? num(e.axles);
  const ratio = n !== null && N !== null && Number.isInteger(n) && n >= 1 && n <= N ? n / N : null;
  const kg = entryMassKg(e);
  const calc = kg !== null && ratio !== null ? Math.floor(Math.round((kg / 1000) * ratio * 1000) / 100) / 10 : null;
  const how = calc === null ? '' : `dopravní hmotnost ${fmt(kg / 1000, 2)} t × ${n}/${N} = ${fmt(calc)} kN`;
  if (min !== null) {
    const empty = !num(e.cargo_kg);
    if (max === null) return { value: min, why: 'na voze jen Min – platí vždy' };
    if (empty) return { value: min, why: 'prázdný vůz – Min' };
    if (max < min) return { value: max, why: 'Max je menší než Min (starší vůz) – platí nižší hodnota bez přepočtu' };
    if (calc === null) {
      return { value: min, why: `${kg === null ? 'chybí hmotnost vozu' : 'chybí počet náprav s ruční brzdou (n)'} – počítá se Min` };
    }
    const v = Math.min(max, Math.max(min, calc));
    return { value: v, why: v === calc ? how : `${how}, v mezích Min–Max → ${v === max ? 'Max' : 'Min'}` };
  }
  if (single === null) return { value: null, why: 'zajišťovací síla není zadaná' };
  if (calc === null || calc >= single) return { value: single, why: calc === null ? 'vyznačená hodnota' : `vyznačená hodnota (${how})` };
  return { value: calc, why: `${how} – méně než vyznačených ${fmt(single)} kN` };
}

/** Kolonka 53 se vyplní jen u vozů, u nichž se ověřila činnost ruční brzdy (čl. 63 b). */
export const handForce = (e) => (e.rucni !== 'nema' && e.hand_checked ? handForceInfo(e).value : null);

/** Součty za vlak (řádek CELKEM a brzdicí procenta). Chybějící údaj = součet je neúplný (missing > 0). */
export function totals(entries) {
  const t = {
    wagons: entries.length, axles: 0, length: 0, cargoKg: 0, tareKg: 0, massKg: 0,
    bwP: 0, bwG: 0, bw: 0, handForce: 0, missing: 0, brakesOff: 0,
  };
  for (const e of entries) {
    const m = entryMassKg(e);
    const bw = entryBrakeWeight(e);
    if (m === null || bw === null || num(e.axles) === null || num(e.length_m) === null) t.missing++;
    t.axles += num(e.axles) ?? 0;
    t.length += num(e.length_m) ?? 0;
    t.cargoKg += num(e.cargo_kg) ?? 0;
    t.tareKg += num(e.tare_kg) ?? 0;
    t.massKg += m ?? 0;
    t.bwP += bwFor(e, 'P') ?? 0;
    t.bwG += bwFor(e, 'G') ?? 0;
    t.bw += bw ?? 0;
    t.handForce += handForce(e) ?? 0;
    if (e.kohout === 'vypnuta') t.brakesOff++;
  }
  // součty desetinných čísel bez chyb zaokrouhlení (308,87999… → 308,88)
  for (const k of ['length', 'bwP', 'bwG', 'bw', 'handForce']) t[k] = Math.round(t[k] * 100) / 100;
  t.mass = t.massKg / 1000;
  t.lambda = t.mass > 0 ? Math.floor((t.bw / t.mass) * 100) : null;
  return t;
}

/** Oranžová tabulka RID: nahoře identifikační číslo nebezpečí (33, X423), dole UN číslo (1203). */
export function ridFromLines(lines) {
  const words = lines.flatMap((l) => l.text.split(/\s+/).map((w) => ({ w: w.replace(/[^0-9X]/gi, '').toUpperCase(), y: l.y })));
  const un = words.find((x) => /^\d{4}$/.test(x.w));
  const icn = words.find((x) => /^X?\d{2,3}$/.test(x.w) && (!un || x.y < un.y));
  return { un: un?.w ?? '', icn: icn?.w ?? '' };
}

// ───── různé ─────

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const dtf = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '');
const df = new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
const tf = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
export const formatDate = (iso) => (iso ? df.format(new Date(iso)).replace(/\s/g, '') : '');
export const formatTime = (iso) => (iso ? tf.format(new Date(iso)) : '');

/** Datum a čas pro <input type="datetime-local"> v místním čase. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fmt = (v, digits = 1) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: digits });

export function plural(n, one, few, many) {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

/** Zmenšená kopie fotky jako JPEG (pro trénovací data a náhledy). */
export async function toJpeg(src, max = 1280, quality = 0.85) {
  const w = src.videoWidth || src.naturalWidth || src.width;
  const h = src.videoHeight || src.naturalHeight || src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}
