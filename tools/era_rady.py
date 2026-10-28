# Převod tabulek ERA Appendix 6 Part 9 (číslice 5–8 čísla nákladního vozu → písmenné označení řady) na data/rady.json.
# Zdroj: https://www.era.europa.eu/domains/registers/evr_en → „Assignment of EVN – Appendix 6 Part 9“ (appendix_6_p9_en.xls).
# Spuštění (potřebuje xlrd 2.x): python3 tools/era_rady.py appendix_6_p9_en.xls data/rady.json
# List „Table N“ = 5. číslice N; záhlaví sloupce = 6. číslice (u listů 3 a 4 i s písmenem kategorie);
# první sloupec = 7. a 8. číslice; buňka = malá písmena řady (poznámky „(1)“ se zahodí, „°“ = nepřiděleno).
import sys, re, json, xlrd
CATEGORY = {'0': 'T', '1': 'G', '2': 'H', '5': 'E', '6': 'F', '7': 'Z', '8': 'I', '9': 'U'}
b = xlrd.open_workbook(sys.argv[1])
out = {}
for s in b.sheets():
    m = re.fullmatch(r'Table (\d)', s.name.strip())
    if not m:
        continue
    d5 = m.group(1)
    for c in range(1, s.ncols):
        h = s.cell_value(0, c)
        if isinstance(h, float):
            d6, cat = str(int(h)), CATEGORY.get(d5)
        else:
            hm = re.fullmatch(r"'?\s*(\d)\s+([A-Z])\s*'?", str(h).strip())
            if not hm:
                continue
            d6, cat = hm.groups()
        if not cat:
            continue
        for r in range(1, s.nrows):
            row = s.cell_value(r, 0)
            if not isinstance(row, float):
                continue
            letters = re.sub(r'\(\s*\d+\s*\)?', '', str(s.cell_value(r, c))).strip()
            if re.fullmatch(r'[a-z]+', letters):
                out[f'{d5}{d6}{int(row):02d}'] = cat + letters
# list „new codes“: kódy přidané po sestavení tabulek (název řady, kód, datum)
if 'new codes' in b.sheet_names():
    s = b.sheet_by_name('new codes')
    for r in range(s.nrows):
        name, code = str(s.cell_value(r, 0)).strip(), s.cell_value(r, 1)
        name = re.sub(r'\(\s*\d+\s*\)?', '', name).strip()
        if isinstance(code, float) and re.fullmatch(r'[A-Z][a-z]+', name):
            out.setdefault(f'{int(code):04d}', name)
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
print(len(out), 'kódů')

