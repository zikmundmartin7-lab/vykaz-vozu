# Výkaz vozů

Aplikace pro vozmistry: kamerou telefonu přečte číslo železničního vozu, zaznamená polohu přestavovačů brzdy a z vozů ve vlaku složí výkaz vozidel s brzdicími procenty. Rozpoznávání běží přímo v telefonu (neuronové sítě), takže funguje i bez signálu.

## Co umí

- **Skenování čísla vozu:** namířit kameru na číslo, aby bylo celé v rámečku. Síť text čte průběžně a číslo přijme sama, když ho přečte dvakrát po sobě a sedí kontrolní číslice UIC, kód státu i rozdělení do skupin. Zvládne i čísla rozdělená do několika řádků (`31 RIV` / `51 PL-FPL` / `5841 271-0`). Méně jistá čísla jen nabídne k ťuknutí. Záloha: **Vyfotit** (fotoaparát telefonu) nebo **Zadat ručně**. V noci tlačítko svítilny.
- **Přestavovače a brzda:** G/P, prázdný/ložený/samočinný, brzda zapnuta/vypnuta, ruční brzda – velká tlačítka (i v rukavicích). Nový vůz převezme polohy od předchozího. U každého je tlačítko **Fotka**: dokud síť na přestavovače není natrénovaná, fotka se uloží s polohou, kterou vozmistr zvolil. Po natrénování síť polohu z fotky odhadne sama a vozmistr ji jen potvrdí.
- **Údaje z nápisů vozu:** počet náprav, délka přes nárazníky, hmotnost prázdného vozu, zajišťovací síla ruční brzdy, nejvyšší dovolená rychlost, druh brzdových špalíků (K, L, LL, D, F) a brzdicí váhy (P/G × prázdný/ložený). **Přečíst nápis** vyfotí popis vozu a nabídne přečtená čísla – ťuknout do pole a pak na hodnotu (t a kg se převádějí samy). Údaje se zapamatují podle čísla vozu a příště se vyplní samy.
- **Náklad a zásilka:** hmotnost nákladu, stanice určení (předvyplní se od předchozího vozu nebo cílová stanice vlaku), RID – **Tabulka RID** přečte z fotky oranžové tabulky IČN (nahoře) a UN číslo (dole), mimořádná zásilka. Traťová třída se spočítá z hmotnosti na nápravu (A do 16 t, B do 18 t, C do 20 t, D do 22,5 t), jde ji i zvolit ručně.
- **Výkaz vozidel pro nákladní vlak** podle formuláře (kolonky 2–4b, 45–59, CELKEM, 60–66): stránky po 20 vozech se „Sestava pokračuje na další straně“ a „Strana x / y“, číslo vozu rozdělené na režim / zem. reg. / číslo / k. č., u vypnuté brzdy a vozu bez RID se pole proškrtne, zajišťovací síla jen u vozů s ověřenou ruční brzdou. Součty (CELKEM) na poslední straně za celý vlak. Export do **PDF** (tisk na šířku A4), **Excelu** se stejnými kolonkami a **sdílení** textu. Navíc pro kontrolu brzdicí procenta podle polohy přestavovačů G/P.
- **Data pro trénink:** přehled nasbíraných fotek podle přestavovače a polohy, export do ZIPu.

Vše se ukládá jen v telefonu (v prohlížeči). Ven se data dostanou exportem.

## Trénink sítě na přestavovače

1. V aplikaci **Data pro trénink → Exportovat nové**, ZIP uložit na Google Disk do složky `Vykaz_vozu_data`.
2. Otevřít `training/trenink_prestavovacu.ipynb` v Google Colabu, zapnout GPU (Runtime → Change runtime type → T4 GPU) a **Run all**.
3. Ze složky `Vykaz_vozu_modely` na Disku zkopírovat `brzdy.json` a nové soubory `.onnx` do složky `models/` aplikace a vydat novou verzi.

Síť se natrénuje pro přestavovač, který má aspoň dvě polohy s 8 a více fotkami. Na začátek stačí desítky fotek od každé polohy, spolehlivá síť chce stovky – z různých vozů, za dne i v noci. Sešit vypíše chybně poznané fotky, často odhalí špatně zadanou polohu.

## Vyzkoušení na počítači

```bash
python3 -m http.server 8770
```

Pak otevřít <http://localhost:8770>. Kamera na počítači nemusí být k dispozici – číslo jde vyfotit (vybrat soubor) nebo zadat ručně. `test/ocr.html` projede rozpoznávání na testovacích fotkách v `test/img/`.

V telefonu kamera funguje jen na adrese s HTTPS (např. GitHub Pages jako u Závad vozů).

## Struktura

```
index.html, manifest.webmanifest, sw.js   stránka, instalace na plochu, offline
css/app.css                               vzhled
js/app.js                                 směrování mezi obrazovkami
js/model.js                               číslo vozu, hledání čísla v textu, přestavovače, brzdicí procenta
js/ocr.js, js/ort.js                      čtení textu sítěmi PaddleOCR přes ONNX Runtime Web
js/brake.js                               odhad polohy přestavovače vlastní sítí (models/brzdy.json)
js/db.js                                  úložiště v telefonu (IndexedDB)
js/xlsx.js                                zápis Excelu a ZIPu bez knihoven
js/views/*.js                             obrazovky: výkazy, výkaz, skener, vůz, výstup, data
models/                                   sítě PP-OCRv5 mobile (det.onnx, rec.onnx, slovník; Apache 2.0)
vendor/                                   Preact + htm, onnxruntime-web 1.20.1
training/trenink_prestavovacu.ipynb       trénink sítí na přestavovače v Colabu
tools/ikony.py                            ikony aplikace
```
