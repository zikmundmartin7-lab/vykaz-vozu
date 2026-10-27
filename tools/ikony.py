"""Vykreslí ikony aplikace Výkaz vozů: nákladní vůz v rámečku hledáčku fotoaparátu.

Zapíše icons/icon.svg a PNG (192, 512, maskable 512).
Spuštění: python3 tools/ikony.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

MODRA = (31, 78, 140, 255)
BILA = (255, 255, 255, 255)
CIL = Path(__file__).resolve().parent.parent / "icons"
S = 4  # převzorkování kvůli hladkým hranám

# Motiv v mřížce 512 × 512
ROHY = [((96, 96), (96, 176), (176, 96)), ((416, 96), (336, 96), (416, 176)),
        ((96, 416), (96, 336), (176, 416)), ((416, 416), (416, 336), (336, 416))]
SKRIN = (150, 196, 362, 300)
RAM = (136, 298, 376, 316)
KOLA = (186, 230, 282, 326)
KOLA_Y, KOLO_R = 336, 18


def motiv(d, k, dx=0, dy=0):
    def b(x, y):
        return (dx + x * k, dy + y * k)

    for roh, a, c in ROHY:
        d.line([b(*a), b(*roh), b(*c)], fill=BILA, width=round(22 * k), joint="curve")
        for p in (a, c, roh):
            r = 11 * k
            x, y = b(*p)
            d.ellipse([x - r, y - r, x + r, y + r], fill=BILA)
    d.rounded_rectangle([*b(SKRIN[0], SKRIN[1]), *b(SKRIN[2], SKRIN[3])], radius=10 * k, fill=BILA)
    d.rounded_rectangle([*b(RAM[0], RAM[1]), *b(RAM[2], RAM[3])], radius=5 * k, fill=BILA)
    for x in KOLA:
        cx, cy = b(x, KOLA_Y)
        r = KOLO_R * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BILA)
    # svislá žebra skříně (modrá)
    for x in (192, 234, 278, 320):
        d.rounded_rectangle([*b(x - 5, 214), *b(x + 5, 282)], radius=4 * k, fill=MODRA)


def png(size, maskable=False):
    big = size * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, big, big], fill=MODRA)
        k = big / 512 * 0.78
        off = (big - 512 * k) / 2
        motiv(d, k, off, off)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.2, fill=MODRA)
        motiv(d, big / 512)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    rohy = "".join(
        f'<polyline points="{a[0]},{a[1]} {r[0]},{r[1]} {c[0]},{c[1]}"/>' for r, a, c in ROHY)
    kola = "".join(f'<circle cx="{x}" cy="{KOLA_Y}" r="{KOLO_R}"/>' for x in KOLA)
    zebra = "".join(f'<rect x="{x - 5}" y="214" width="10" height="68" rx="4" fill="#1f4e8c"/>' for x in (192, 234, 278, 320))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            '<rect width="512" height="512" rx="102" fill="#1f4e8c"/>'
            f'<g fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">{rohy}</g>'
            f'<g fill="#fff"><rect x="{SKRIN[0]}" y="{SKRIN[1]}" width="{SKRIN[2] - SKRIN[0]}" height="{SKRIN[3] - SKRIN[1]}" rx="10"/>'
            f'<rect x="{RAM[0]}" y="{RAM[1]}" width="{RAM[2] - RAM[0]}" height="{RAM[3] - RAM[1]}" rx="5"/>{kola}</g>{zebra}</svg>\n')


if __name__ == "__main__":
    CIL.mkdir(exist_ok=True)
    (CIL / "icon.svg").write_text(svg(), encoding="utf-8")
    png(192).save(CIL / "icon-192.png")
    png(512).save(CIL / "icon-512.png")
    png(512, maskable=True).save(CIL / "icon-maskable-512.png")
    print("Ikony zapsány do", CIL)
