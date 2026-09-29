# Amber Notes icon candidates: each reads as "notes" first, Amber second.
R = 228  # preview corner radius on a 1024 tile
AMBER = ('#F9B233', '#EE8A12')  # honey top, deep amber bottom
LEAF = '#7A3B06'

def lines(x0, x1, ys, color, w=10):
    return ''.join(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>' for y in ys)

def leaf(cx, cy, s=1.0, color=LEAF):
    return (f'<g transform="translate({cx} {cy}) rotate(-32) scale({s})">'
            f'<path d="M-70 0 C-40 -46 40 -46 70 0 C40 46 -40 46 -70 0 Z" fill="{color}"/>'
            f'<line x1="-86" y1="0" x2="62" y2="0" stroke="#5A2A03" stroke-width="9" stroke-linecap="round"/></g>')

def defs():
    return (f'<defs><linearGradient id="amb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{AMBER[0]}"/><stop offset="1" stop-color="{AMBER[1]}"/></linearGradient>'
            '<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1EEE8"/></linearGradient>'
            '<linearGradient id="dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2A2E"/><stop offset="1" stop-color="#1C1B1E"/></linearGradient>'
            '<linearGradient id="cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8EA"/><stop offset="1" stop-color="#F6EAD2"/></linearGradient></defs>')

def clip(i):
    return f'<clipPath id="c{i}"><rect width="1024" height="1024" rx="{R}"/></clipPath>'

ICONS = {}

# A: the pad. White page, amber header with the leaf, ruled lines. Closest to Notes.
ICONS['A  Amber pad'] = (
    '<rect width="1024" height="1024" fill="url(#paper)"/>'
    '<rect width="1024" height="330" fill="url(#amb)"/>'
    '<rect y="322" width="1024" height="16" fill="#D9760A" opacity=".55"/>'
    + lines(170, 854, [520, 660, 800], '#D8D2C8', 12))

# B: the pad with the leaf pressed into the header.
ICONS['B  Pad + leaf'] = (
    '<rect width="1024" height="1024" fill="url(#paper)"/>'
    '<rect width="1024" height="330" fill="url(#amb)"/>'
    + leaf(512, 170, 1.25) +
    lines(170, 854, [520, 660, 800], '#D8D2C8', 12))

# C: an amber drop is the ink: white page, lines, a resin drop resting on the first line.
ICONS['C  Drop on page'] = (
    '<rect width="1024" height="1024" fill="url(#paper)"/>'
    + lines(170, 854, [470, 610, 750], '#D8D2C8', 12) +
    '<path d="M512 110 C 600 230 660 300 660 370 A 148 148 0 0 1 364 370 C 364 300 424 230 512 110 Z" fill="url(#amb)"/>'
    '<path d="M462 300 C 470 262 490 236 510 214" stroke="#FFE3A6" stroke-width="22" stroke-linecap="round" fill="none"/>')

# D: warm paper, amber binding down the left like a notebook spine.
ICONS['D  Notebook spine'] = (
    '<rect width="1024" height="1024" fill="url(#cream)"/>'
    '<rect width="250" height="1024" fill="url(#amb)"/>'
    + ''.join(f'<circle cx="250" cy="{y}" r="26" fill="#FFF8EA"/>' for y in (230, 400, 570, 740)) +
    lines(360, 860, [300, 440, 580, 720], '#E2D5BC', 12))

# E: night pad. Dark page, amber header, light lines: stands apart from Notes in the Dock.
ICONS['E  Night pad'] = (
    '<rect width="1024" height="1024" fill="url(#dark)"/>'
    '<rect width="1024" height="330" fill="url(#amb)"/>'
    + leaf(512, 170, 1.25) +
    lines(170, 854, [520, 660, 800], '#4A474F', 12))

# F: amber tile, white sheet with a folded corner.
ICONS['F  Folded sheet'] = (
    '<rect width="1024" height="1024" fill="url(#amb)"/>'
    '<path d="M230 170 H 690 L 800 280 V 860 A 30 30 0 0 1 770 890 H 260 A 30 30 0 0 1 230 860 V 200 A 30 30 0 0 1 260 170 Z" fill="#FFFDF8"/>'
    '<path d="M690 170 V 250 A 30 30 0 0 0 720 280 H 800 Z" fill="#F3D9A8"/>'
    + lines(310, 720, [420, 540, 660, 780], '#E6D6BA', 14))

def icon_svg(body, i):
    return f'<g clip-path="url(#c{i})">{body}</g><rect width="1024" height="1024" rx="{R}" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="4"/>'

# Single icons at 1024 for each candidate.
if __name__ == "__main__":
  pass
for i, (name, body) in enumerate(ICONS.items() if __name__ == "__main__" else []):
    key = name.split()[0]
    open(f'{key}.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{defs()}<defs>{clip(i)}</defs>{icon_svg(body, i)}</svg>')

# Tasting sheet: each candidate large, then Dock size on dark and light, next to a Notes-like neighbour.
W, H = 6 * 300 + 60, 620
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="-apple-system, Helvetica" >', defs(), '<defs>', *[clip(i) for i in range(len(ICONS))], '</defs>',
       f'<rect width="{W}" height="{H}" fill="#F5F5F7"/>', f'<rect y="380" width="{W}" height="120" fill="#232226"/>']
if __name__ == "__main__":
  pass
for i, (name, body) in enumerate(ICONS.items() if __name__ == "__main__" else []):
    x = 40 + i * 300
    out.append(f'<g transform="translate({x} 40) scale(0.25)">{icon_svg(body, i)}</g>')
    out.append(f'<text x="{x + 128}" y="330" font-size="22" font-weight="600" text-anchor="middle" fill="#1D1D1F">{name}</text>')
    for j, s in enumerate((0.0625, 0.03125)):  # 64 and 32 px
        out.append(f'<g transform="translate({x + 60 + j * 100} {400 + (64 - 1024 * s) / 2}) scale({s})">{icon_svg(body, i)}</g>')
    out.append(f'<g transform="translate({x + 60} {530}) scale(0.0625)">{icon_svg(body, i)}</g>')
    out.append(f'<g transform="translate({x + 160} {546}) scale(0.03125)">{icon_svg(body, i)}</g>')
out.append('</svg>')
if __name__ == '__main__': open('sheet.svg', 'w').write(''.join(out))
