# Round 2: many notes-first directions, Amber second.
from gen import defs, clip, lines, leaf, icon_svg
EXTRA = '''<defs>
<linearGradient id="honey" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC94D"/><stop offset="1" stop-color="#E97C0C"/></linearGradient>
<linearGradient id="resin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB938"/><stop offset=".55" stop-color="#F08E14"/><stop offset="1" stop-color="#C9650A"/></linearGradient>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="sheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#F3EDE2"/></linearGradient>
<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#6B3500" flood-opacity=".28"/></filter>
</defs>'''
P = 'url(#paper)'; RULE = '#D8D2C8'
def pad(header, page=P, rule=RULE, top=330, extra='', sep=''):
    return f'<rect width="1024" height="1024" fill="{page}"/><rect width="1024" height="{top}" fill="{header}"/>{sep}{extra}' + lines(170, 854, [top + 190, top + 330, top + 470], rule, 12)

def perf(y, color='#fff', n=15):  # a row of tear holes under the header
    step = 1024 / n
    return ''.join(f'<circle cx="{step/2 + i*step:.0f}" cy="{y}" r="9" fill="{color}" opacity=".85"/>' for i in range(n))

def wave(y, color):  # a torn, wavy edge under the header
    d = f'M0 {y} ' + ' '.join(f'Q {x+32} {y+26} {x+64} {y}' for x in range(0, 1024, 64)) + f' V0 H0 Z'
    return f'<path d="{d}" fill="{color}"/>'

def drop(cx, cy, s=1.0):
    return (f'<g transform="translate({cx} {cy}) scale({s})"><path d="M0 -150 C 88 -30 148 40 148 110 A 148 148 0 0 1 -148 110 C -148 40 -88 -30 0 -150 Z" fill="url(#amb)"/>'
            f'<path d="M-50 40 C -42 2 -22 -24 -2 -46" stroke="#FFE3A6" stroke-width="22" stroke-linecap="round" fill="none"/></g>')

def pebble(cx, cy, s=1.0):  # today's amber pebble, simplified
    return (f'<g transform="translate({cx} {cy}) scale({s})"><path d="M-150 20 C-150 -110 -60 -160 30 -160 C 130 -160 170 -80 160 10 C 150 120 70 160 -10 160 C -100 160 -150 110 -150 20 Z" fill="url(#resin)"/>'
            f'<path d="M-95 -95 C -60 -130 -10 -140 30 -138" stroke="#FFE3A6" stroke-width="20" stroke-linecap="round" fill="none"/>' + leaf(0, 30, 0.9) + '</g>')

def pencil_line(y):  # the last line is being written: amber stroke with a caret
    return f'<line x1="170" y1="{y}" x2="560" y2="{y}" stroke="#F0901A" stroke-width="16" stroke-linecap="round"/><rect x="590" y="{y-46}" width="14" height="70" rx="7" fill="#F0901A"/>'

I = {}
I['1 Pad, perforated'] = pad('url(#amb)', extra=perf(330, '#FFF'))
I['2 Pad, torn edge'] = '<rect width="1024" height="1024" fill="url(#paper)"/>' + wave(318, '#F4A21F').replace('fill="#F4A21F"', 'fill="url(#amb)"') + lines(170, 854, [520, 660, 800], RULE, 12)
I['3 Pad + leaf, perforated'] = pad('url(#amb)', extra=leaf(512, 165, 1.25) + perf(330, '#FFF'))
I['4 Pad + pebble'] = pad('url(#amb)', top=300, extra=pebble(512, 300, 0.62))
I['5 Honey pad, writing'] = '<rect width="1024" height="1024" fill="url(#paper)"/><rect width="1024" height="300" fill="url(#honey)"/>' + lines(170, 854, [480, 620], RULE, 12) + pencil_line(760)
I['6 Cream pad'] = pad('url(#amb)', page='url(#cream)', rule='#E3D3B5', extra=leaf(512, 165, 1.25))
I['7 Resin header, gloss'] = pad('url(#resin)', extra='<rect width="1024" height="150" fill="url(#gloss)"/>' + leaf(512, 175, 1.25))
I['8 Night pad, writing'] = '<rect width="1024" height="1024" fill="url(#dark)"/><rect width="1024" height="300" fill="url(#amb)"/>' + lines(170, 854, [480, 620], '#4A474F', 12) + pencil_line(760)
I['9 Amber tile, white sheet'] = ('<rect width="1024" height="1024" fill="url(#resin)"/><g filter="url(#sh)"><rect x="200" y="170" width="624" height="700" rx="46" fill="url(#sheet)"/></g>'
                                 '<rect x="200" y="170" width="624" height="170" rx="46" fill="#FFF3DC"/><rect x="200" y="290" width="624" height="50" fill="#FFF3DC"/>' + lines(280, 744, [470, 590, 710], '#E3D6C0', 14))
I['10 Sticky note, tilted'] = ('<rect width="1024" height="1024" fill="url(#cream)"/><g transform="rotate(-7 512 512)" filter="url(#sh)"><rect x="190" y="190" width="644" height="644" rx="36" fill="url(#honey)"/>'
                               + lines(270, 750, [400, 520, 640], '#FFFFFF', 14).replace('stroke="#FFFFFF"', 'stroke="#FFFFFF" stroke-opacity=".7"') + '</g>')
I['11 Two pages'] = ('<rect width="1024" height="1024" fill="url(#amb)"/><g filter="url(#sh)"><rect x="250" y="150" width="560" height="700" rx="40" fill="#FFE7BF" transform="rotate(6 530 500)"/>'
                     '<rect x="214" y="174" width="560" height="700" rx="40" fill="url(#sheet)"/></g>' + lines(290, 700, [360, 480, 600, 720], '#E3D6C0', 14))
I['12 Page + drop ink'] = '<rect width="1024" height="1024" fill="url(#paper)"/>' + lines(170, 854, [560, 700, 840], RULE, 12) + drop(512, 330, 1.0)
I['13 Pad, amber rule'] = pad('url(#amb)', extra='<rect y="322" width="1024" height="16" fill="#C9650A"/>' + leaf(512, 165, 1.25), rule='#E8C48A')
I['14 Ring-bound'] = (pad('url(#amb)', top=300) + ''.join(f'<rect x="{x}" y="250" width="34" height="110" rx="17" fill="#8E8A85"/><rect x="{x+6}" y="256" width="22" height="46" rx="11" fill="#D9D4CD"/>' for x in (230, 390, 550, 710)))
I['15 Leaf as bookmark'] = pad('url(#amb)', top=250, extra='<path d="M700 0 H 800 V 400 L 750 360 L 700 400 Z" fill="#7A3B06"/>')
I['16 Minimal dot'] = '<rect width="1024" height="1024" fill="url(#paper)"/>' + lines(250, 774, [430, 560, 690], RULE, 16) + '<circle cx="512" cy="250" r="78" fill="url(#amb)"/>'

W = 8 * 230 + 40; H = 2 * 420 + 40
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="-apple-system, Helvetica">', defs(), EXTRA, '<defs>', *[clip(i) for i in range(len(I))], '</defs>', f'<rect width="{W}" height="{H}" fill="#F5F5F7"/>']
for i, (name, body) in enumerate(I.items()):
    col, row = i % 8, i // 8
    x, y = 30 + col * 230, 20 + row * 420
    out.append(f'<g transform="translate({x} {y}) scale(0.19)">{icon_svg(body, i)}</g>')
    out.append(f'<text x="{x + 97}" y="{y + 225}" font-size="16" font-weight="600" text-anchor="middle" fill="#1D1D1F">{name}</text>')
    out.append(f'<rect x="{x - 10}" y="{y + 245}" width="215" height="140" rx="14" fill="#232226"/>')
    out.append(f'<g transform="translate({x + 8} {y + 280}) scale(0.0625)">{icon_svg(body, i)}</g>')
    out.append(f'<g transform="translate({x + 96} {y + 296}) scale(0.03125)">{icon_svg(body, i)}</g>')
    out.append(f'<g transform="translate({x + 150} {y + 304}) scale(0.0156)">{icon_svg(body, i)}</g>')
    open(f'r2-{i+1:02d}.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{defs()}{EXTRA}<defs>{clip(i)}</defs>{icon_svg(body, i)}</svg>')
out.append('</svg>')
open('sheet2.svg', 'w').write(''.join(out))
