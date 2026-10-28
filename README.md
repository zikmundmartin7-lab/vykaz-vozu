# Výkaz vozů

Aplikace pro vozmistry: kamerou telefonu přečte číslo železničního vozu, zaznamená polohu přestavovačů brzdy a z vozů ve vlaku složí výkaz vozidel s brzdicími procenty. Rozpoznávání běží přímo v telefonu (neuronové sítě), takže funguje i bez signálu.

## Co umí

- **Skenování čísla vozu:** namířit kameru na číslo, aby bylo celé v rámečku. Síť text čte průběžně a číslo přijme sama, když ho přečte dvakrát po sobě a sedí kontrolní číslice UIC, kód státu i rozdělení do skupin. Zvládne i čísla rozdělená do několika řádků (`31 RIV` / `51 PL-FPL` / `5841 271-0`). Méně jistá čísla jen nabídne k ťuknutí. Záloha: **Vyfotit** (fotoaparát telefonu) nebo **Zadat ručně**. V noci tlačítko svítilny.
- **Přestavovače a brzda:** G/P, prázdný/ložený/samočinný, brzda zapnuta/vypnuta, ruční brzda – velká tlačítka (i v rukavicích). Nový vůz převezme polohy od předchozího. U každého je tlačítko **Fotka**: dokud síť na přestavovače není natrénovaná, fotka se uloží s polohou, kterou vozmistr zvolil. Po natrénování síť polohu z fotky odhadne sama a vozmistr ji jen potvrdí.
- **Údaje z nápisů vozu:** počet náprav, délka přes nárazníky, hmotnost prázdného vozu, zajišťovací síla ruční brzdy, nejvyšší dovolená rychlost, druh brzdových špalíků (K, L, LL, D, F) a brzdicí váhy (P/G × prázdný/ložený). **Přečíst nápis** vyfotí popis vozu a nabídne přečtená čísla – ťuknout do pole a pak na hodnotu (t a kg se převádějí samy). Údaje se zapamatují podle čísla vozu a příště se vyplní samy.
- **Náklad a zásilka:** hmotnost nákladu, stanice určení (předvyplní se od předchozího vozu nebo cílová stanice vlaku), RID – **Tabulka RID** přečte z fotky oranžové tabulky IČN (nahoře) a UN číslo (dole), mimořádná zásilka. Traťová třída se spočítá z hmotnosti na nápravu (A do 16 t, B do 18 t, C do 20 t, D do 22,5 t), jde ji i zvolit ručně.
- **Výkaz vozidel pro nákladní vlak** podle formuláře (kolonky 2–4b, 45–59, CELKEM, 60–66): stránky po 20 vozech se „Sestava pokračuje na další straně“ a „Strana x / y“, číslo vozu rozdělené na režim / zem. reg. / číslo / k. č., u vypnuté brzdy a vozu bez RID se pole proškrtne, zajišťovací síla jen u vozů s ověřenou ruční brzdou. Součty (CELKEM) na poslední straně za celý vlak. Export do **PDF** (tisk na šířku A4), **Excelu** se stejnými kolonkami a **sdílení** textu. Navíc pro kontrolu brzdicí procenta podle polohy přestavovačů G/P.
- **Data pro trénink:** přehled nasbíraných snímků podle údaje a polohy, export do ZIPu (u snímků z tréninku i JSON s přečteným textem a označeným nápisem), smazání vyexportovaných nebo všech fotek do **koše** (odtud jde obnovit, nebo koš vysypat a fotky trvale smazat).

Vše se ukládá jen v telefonu (v prohlížeči). Ven se data dostanou exportem.

**Aktualizace (stejně jako Závady vozů):** po návratu do aplikace (nejvýš jednou za 10 minut) a při každém spuštění se aplikace na pozadí zeptá na novou verzi. Když je, stáhne ji celou znovu přímo z webu a nahoře se objeví zelená lišta **Je k dispozici nová verze aplikace** – klepnutím se nová verze načte bez zavírání aplikace. Na úvodní obrazovce dole je **Verze aplikace NN** a tlačítko **Aktualizovat** (najde, stáhne a hned načte novou verzi). Čtecí sítě (25 MB) se při nové verzi znovu nestahují.

## Řada vozu z čísla

Zdroje: [OTIF UTP Marking 2021](https://otif.org/fileadmin/new/3-Reference-Text/3D-Technical-Interoperability/3D1-Prescriptions-and-other-rules/UTP-MARKING-2021_e%20In-force.pdf) (kap. 11 – 1. číslice: 0, 2, 4 = vůz s nápravami, 1, 3, 8 = s podvozky; kap. 14 – číslice 5–8; definice písmen řady), [ERA – Assignment of EVN, Appendix 6 Part 9 a 12](https://www.era.europa.eu/domains/registers/evr_en). Tabulka ERA se občas doplňuje – při aktualizaci stáhnout nový `appendix_6_p9_en.xls` a spustit `tools/era_rady.py`.

## Snímání pro trénink

Úvodní obrazovka → **Snímat pro trénink**. Vozmistr obchází vůz s kamerou a aplikace ho vede po údajích. Výchozí pořadí:

1. číslo vozu, 2. počet náprav, 3. hmotnost a ruční brzda (vlastní hmotnost v kg, pod ní síla zajišťovací brzdy v t a odkud se brzda obsluhuje), 4. zajišťovací síla (kN), 5. délka přes nárazníky, 6. nejvyšší dovolená rychlost, 7. druh brzdových špalíků, 8. přestavovač G/P, 9. přestavovač prázdný/ložený, 10. revize.

- Kamera čte text v celém záběru a kolem přečtených nápisů kreslí rámečky. Zeleně je nápis, který aplikace považuje za hledaný údaj, a jeho hodnota je předvyplněná dole.
- **Potvrdit** = hodnota sedí. Když nesedí, hodnotu přepište, nebo ťukněte na správný nápis v obraze (zežloutne). Ťuknutím nebo psaním se obraz zastaví, aby se uložil přesně ten snímek; **Zpět ke kameře** ho pustí dál.
- **Světlo** (vpravo nahoře, i ve skeneru čísla vozu): žárovka zapne a vypne svítilnu, sluníčko ukáže posuvník **Jas** (−2 až +2, pamatuje se). Sílu světla svítilny webová aplikace nastavit neumí – iPhone ani Android to webu nedovolí, jen zapnout a vypnout. Jas proto mění obraz: kde to kamera umí (část Androidů), korekcí expozice (ztmavení pomůže proti odleskům reflexních nápisů), jinak softwarově – stejně se upraví i snímek, který se čte a ukládá.
- **Řada podle čísla:** z 5.–8. číslice se podle tabulek ERA určí řada vozu (např. Shimmns) a z ní počet náprav a nejvyšší rychlost (s = 100 km/h, ss = 120 km/h). Jistý počet náprav se předvyplní; u 8 náprav, nejistého „6 a více“ a kloubových vozů aplikace jen poradí a počet se zvolí ručně (i „Jiný počet“).
- **Hmotnost a ruční brzda v jednom kroku:** aplikace přečte vlastní hmotnost, pod ní sílu zajišťovací brzdy (t) a podle barvy dělicí čáry mezi nimi navrhne barvu rámečku. Podle předpisu (čl. 562, 528, 529): **červený rámeček = pořádací brzda, ovládaná ručním kolem z boku vozu ze země; jakákoli jiná barva (černá, bílá…) = ruční brzda, ovládaná z plošiny**. Volí se Červený / Jiná barva / Nemá; ukládá se tato volba, význam se z ní odvozuje. Bez údaje v tunách navrhne „Nemá“. Barva se měří uvnitř popisového pole, protože vůz sám bývá červený. Výřez rámečku se ukládá zvlášť pro budoucí síť na barvu.
- **Na voze není** = údaj na voze chybí, krok se přeskočí. **Fotka** pořídí snímek fotoaparátem (ostřejší než živý obraz).
- Počet náprav, druh špalíků a přestavovače se volí tlačítkem; snímek pro trénink se uloží sám při **Potvrdit** – přesně to, co je v tu chvíli na displeji (zvláštní fotka není potřeba) (nápravy předvolené na 4, u špalíků aplikace nabídne LL/K/L, když je na snímku samostatný nápis).
- Na konci se ukáže souhrn a **Uložit a další vůz** uloží údaje k číslu vozu (příště se ve výkazu vyplní samy).

- Kroky jsou vpravo pod sebou s popisem: bílý = právě snímaný, zelený s ✓ = potvrzený, přeškrtnutý = na voze není. **Ťuknutím** se na krok přejde, **tažením nahoru/dolů** se přesune jinam v pořadí (pořadí si telefon pamatuje). Po potvrzení aplikace přejde na další nevyplněný krok.

Každé potvrzení uloží snímek, potvrzenou hodnotu, všechen přečtený text s rámečky a označený nápis. Z toho se natrénuje síť, která pozná, který nápis je který údaj, a sítě na přestavovače.

Údaje se zatím hledají pravidly: hmotnost = číslo s kg mezi 8 a 60 t, síla zajišťovací brzdy = samostatné číslo s t, zajišťovací síla = číslo s kN, délka = nejdelší číslo s m mezi 8 a 40, rychlost = číslo s km/h (bez jednotky SS v tabulce zatížení = 120, S = 100), revize = řádek s nápisem REV, a když ho síť nepřečte, datum s kódem dílny vlevo („REV 1003 18.06.26“). Nula přečtená jako písmeno o („20.ot“) se opraví. Čtecí síť nezná českou diakritiku (ŽOS přečte jako OS) – text revize je potřeba opravit.

## Trénink sítě na přestavovače

1. V aplikaci **Data pro trénink → Exportovat nové**, v nabídce sdílení **Disk** → složka `Vykaz_vozu_data` (na Disku musí být `.zip` v MB, ne text s názvem). Jinak **Stáhnout všechno jako ZIP do telefonu** a nahrát ručně.
2. Otevřít sešit (kopie na Disku: `Colab_Notebooks/Vykaz_vozu/trenink_prestavovacu.ipynb`, zdroj `training/`) v Google Colabu, zapnout GPU (Runtime → Change runtime type → T4 GPU) a **Run all**.
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
index.html, manifest.webmanifest, sw.js   stránka, instalace na plochu, offline, aktualizace
js/version.js                             číslo verze (zvyšuje se spolu s CACHE v sw.js)
css/app.css                               vzhled
js/app.js                                 směrování mezi obrazovkami
js/model.js                               číslo vozu, hledání čísla v textu, přestavovače, brzdicí procenta
js/ocr.js, js/ort.js                      čtení textu sítěmi PaddleOCR přes ONNX Runtime Web
js/brake.js                               odhad polohy přestavovače vlastní sítí (models/brzdy.json)
js/fields.js                              údaje snímané při obchůzce a pravidla, jak je najít v textu
js/light.js                               svítilna a jas obrazu kamery
js/series.js, data/rady.json              řada vozu z čísla (tabulky ERA), počet náprav a rychlost
js/frame.js                               barva rámečku síly zajišťovací brzdy (z plošiny / ze země)
js/db.js                                  úložiště v telefonu (IndexedDB)
js/xlsx.js                                zápis Excelu a ZIPu bez knihoven
js/views/*.js                             obrazovky: výkazy, výkaz, skener, vůz, výstup, data, trénink (trainer.js)
models/                                   sítě PP-OCRv5 mobile (det.onnx, rec.onnx, slovník; Apache 2.0)
vendor/                                   Preact + htm, onnxruntime-web 1.20.1
training/trenink_prestavovacu.ipynb       trénink sítí na přestavovače v Colabu
tools/ikony.py                            ikony aplikace
tools/era_rady.py                         převod tabulky ERA appendix_6_p9_en.xls na data/rady.json
```
