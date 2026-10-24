# Generates an original Gen-2-style pixel route scene as an inline SVG (256x144 logical pixels).
# Colors are CSS variables so the page can switch morning / day / night palettes.
W, H = 256, 144
out = []
def rect(x, y, w, h, cls): out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" class="{cls}"/>')

def sprite(rows, palette, ox, oy, extra="", into=None):
    dst = out if into is None else into
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == ".": x += 1; continue
            run = 1
            while x + run < len(row) and row[x + run] == ch: run += 1
            dst.append(f'<rect x="{ox+x}" y="{oy+y}" width="{run}" height="1" class="{palette[ch]}"{extra}/>')
            x += run

# Sky bands (dithered transitions like GBC gradients)
bands = [(0, 30, "sk1"), (30, 24, "sk2"), (54, 18, "sk3"), (72, 14, "sk4")]
for y, h, c in bands: rect(0, y, W, h, c)
defs = []
for (a,) in [("sk1",), ("sk2",), ("sk3",)]:
    defs.append(f'<pattern id="d-{a}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" class="{a}"/><rect x="1" y="1" width="1" height="1" class="{a}"/></pattern>')
for (y, a) in [(30, "sk1"), (54, "sk2"), (72, "sk3")]:
    out.append(f'<rect x="0" y="{y}" width="{W}" height="2" fill="url(#d-{a})"/>')

# Sun / moon
orb = [
    "...oooo...",
    ".oooooooo.",
    ".oooooooo.",
    "oooooooooo",
    "oooooooooo",
    "oooooooooo",
    "oooooooooo",
    ".oooooooo.",
    ".oooooooo.",
    "...oooo...",
]
out.append('<g class="orb">'); sprite(orb, {"o": "sun"}, 196, 14); out.append('</g>')
# Stars (only visible at night via CSS)
out.append('<g class="stars">')
for x, y in [(18, 8), (44, 20), (70, 6), (101, 15), (130, 9), (152, 24), (172, 5), (226, 30), (240, 12), (60, 34), (118, 30)]:
    rect(x, y, 1, 1, "star")
out.append('</g>')

# Clouds (drift)
cloud = [
    "....wwww......",
    "..wwwwwwww....",
    ".wwwwwwwwwwww.",
    "wwwwwwwwwwwwww",
    ".ssssssssssss.",
]
for i, (x, y) in enumerate([(20, 20), (120, 12), (230, 34)]):
    out.append(f'<g class="cloud c{i}">'); sprite(cloud, {"w": "cl1", "s": "cl2"}, x, y); out.append('</g>')

# Distant mountains (stepped silhouette)
import math
pts = []
for x in range(0, W + 1, 4):
    h = 64 + int(6 * math.sin(x / 23) + 4 * math.sin(x / 9 + 1) + 5 * math.sin(x / 41 + 2))
    pts.append((x, h))
for i, (x, h) in enumerate(pts[:-1]):
    rect(x, h, 4, 90 - h, "mt1")
    rect(x, h, 4, 1, "mt2")

# Tree line (Gen-2 style round trees)
tree = [
    "....dddddddd....",
    "..ddllllllllddd.",
    ".dllllllllllldd.",
    ".dllllggllllldd.",
    "dllllggggllllldd",
    "dlllllllllllgldd",
    "dllgglllllllggdd",
    "dllggglllllllldd",
    ".dlllllllggllld.",
    ".dddllllggggldd.",
    "..ddddlllllddd..",
    "....dddddddd....",
    "......tttt......",
    "......tTTt......",
    ".....ttTTtt.....",
    "....kkkkkkkk....",
]
tp = {"d": "tr1", "l": "tr2", "g": "tr3", "t": "tk1", "T": "tk2", "k": "gr3"}
body = []; sprite(tree, tp, 0, 0, into=body)
defs.append('<symbol id="tree" viewBox="0 0 16 16" width="16" height="16">' + "".join(body) + '</symbol>')
for row_y, offset in [(76, 0), (84, 8)]:
    for x in range(-8 + offset, W, 16):
        out.append(f'<use href="#tree" x="{x}" y="{row_y}"/>')

# Ground
rect(0, 100, W, 44, "gr1")
defs.append('<pattern id="gtex" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="1" height="1" class="gr2"/><rect x="2" y="2" width="1" height="1" class="gr2"/><rect x="4" y="4" width="1" height="1" class="gr2"/><rect x="6" y="6" width="1" height="1" class="gr2"/></pattern>')
out.append(f'<rect x="0" y="100" width="{W}" height="44" fill="url(#gtex)"/>')

# Winding route path
for y in range(100, 144):
    cx = 120 + int(22 * math.sin((y - 100) / 13))
    w = 26 + (y - 100) // 2
    rect(cx - w // 2, y, w, 1, "pa1")
    rect(cx - w // 2, y, 1, 1, "pa2"); rect(cx + w // 2 - 1, y, 1, 1, "pa2")
for x, y in [(115, 108), (128, 117), (104, 126), (136, 133), (110, 139)]:
    rect(x, y, 2, 1, "pa2")

# Tall grass patches (classic tufts)
tuft = [
    "a...a...",
    "aa.aaa.a",
    "babbabba",
    "bbbbbbbb",
]
tg = {"a": "tg2", "b": "tg1"}
body = []; sprite(tuft, tg, 0, 0, into=body)
defs.append('<pattern id="tuft" width="8" height="4" patternUnits="userSpaceOnUse">' + "".join(body) + '</pattern>')
for (gx, gy, cols, rows) in [(8, 104, 7, 6), (176, 106, 9, 5), (196, 126, 7, 4), (20, 130, 5, 3)]:
    out.append(f'<rect x="{gx}" y="{gy}" width="{cols*8}" height="{rows*4}" fill="url(#tuft)" transform="translate(0 0)"/>')

# Fence
for x in range(150, 256, 6):
    rect(x, 96, 2, 7, "fe1"); rect(x, 96, 2, 1, "fe2")
rect(150, 98, 106, 1, "fe1"); rect(150, 101, 106, 1, "fe1")

# Blank wooden route sign
sign = [
    "bbbbbbbbbbbb",
    "bwwwwwwwwwwb",
    "bwccccccccwb",
    "bwwwwwwwwwwb",
    "bwccccccwwwb",
    "bwwwwwwwwwwb",
    "bbbbbbbbbbbb",
    ".....pp.....",
    ".....pp.....",
    ".....pp.....",
]
sprite(sign, {"b": "fe1", "w": "sg1", "c": "sg2", "p": "fe1"}, 82, 100)

# Flowers (wiggle in two frames, like the Gen 2 overworld)
for i, (x, y) in enumerate([(60, 112), (66, 116), (150, 118), (160, 112), (90, 134), (230, 112), (238, 118), (46, 122)]):
    f = "fa" if i % 2 == 0 else "fb"
    out.append(f'<g class="flower {f}">')
    rect(x, y, 1, 1, "fl1"); rect(x + 2, y, 1, 1, "fl1"); rect(x + 1, y + 1, 1, 1, "fl2"); rect(x, y + 2, 1, 1, "fl1"); rect(x + 2, y + 2, 1, 1, "fl1")
    out.append('</g>')

svg = (f'<svg id="scene" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice" '
       f'shape-rendering="crispEdges" aria-hidden="true" focusable="false"><defs>' + "".join(defs) + "</defs>" + "".join(out) + "</svg>")
open("scene.svg", "w").write(svg)
print(len(svg), "bytes")
