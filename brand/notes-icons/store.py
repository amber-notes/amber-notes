# Store-safe variants: keep notepad + amber + leaf, but move away from Apple Notes' look
# (a white page with a flat coloured top band). Each changes the silhouette or the ground.
from gen import defs, clip, lines, leaf, icon_svg
from final import body as current
EXTRA = '''<defs>
<linearGradient id="resin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB938"/><stop offset=".55" stop-color="#F08E14"/><stop offset="1" stop-color="#C9650A"/></linearGradient>
<linearGradient id="sheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#F3EDE2"/></linearGradient>
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34302C"/><stop offset="1" stop-color="#1E1B19"/></linearGradient>
<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#5A2A00" flood-opacity=".32"/></filter>
</defs>'''
RULE = '#E3D3B5'
V = {}
# S1: amber is the ground; a cream page sits on it, slightly turned, with the leaf pressed in its corner.
V['S1 Page on amber'] = ('<rect width="1024" height="1024" fill="url(#resin)"/>'
    '<g transform="rotate(-6 512 530)" filter="url(#sh)"><rect x="232" y="196" width="560" height="660" rx="56" fill="url(#sheet)"/>'
    + lines(312, 712, [470, 580, 690], RULE, 16) + leaf(640, 318, 0.95) + '</g>')
# S2: no page at all: the leaf is the mark, with three cream lines like a note being written.
V['S2 Leaf and lines'] = ('<rect width="1024" height="1024" fill="url(#resin)"/>'
    + leaf(512, 330, 2.1, '#FFF3DC').replace('stroke="#5A2A03"', 'stroke="#E08A14"')
    + lines(262, 762, [620, 730], '#FFF3DC', 30) + lines(262, 582, [840], '#FFF3DC', 30))
# S3: a night tile with an amber page tab: reads as a notebook, nothing like Notes' white pad.
V['S3 Night notebook'] = ('<rect width="1024" height="1024" fill="url(#night)"/>'
    '<rect x="222" y="232" width="580" height="600" rx="60" fill="url(#resin)"/>'
    '<rect x="222" y="232" width="120" height="600" rx="60" fill="#C9650A"/><rect x="282" y="232" width="60" height="600" fill="#C9650A"/>'
    + lines(400, 720, [420, 530, 640], '#FFE7BF', 18) + leaf(560, 760, 0.8, '#FFF3DC').replace('stroke="#5A2A03"', 'stroke="#E08A14"'))
# S4: the leaf becomes a bookmark ribbon on a cream page: the silhouette gets a notch Notes doesn't have.
V['S4 Leaf bookmark'] = ('<rect width="1024" height="1024" fill="url(#cream)"/>'
    '<path d="M640 0 H800 V420 L720 360 L640 420 Z" fill="url(#resin)"/>' + leaf(720, 250, 0.85, '#7A3B06')
    + lines(200, 580, [300, 420], RULE, 16) + lines(200, 824, [540, 660, 780], RULE, 16))
# S5: an amber resin drop with a page inside it, the "amber preserves your notes" idea.
V['S5 Page in amber drop'] = ('<rect width="1024" height="1024" fill="url(#cream)"/>'
    '<path d="M512 120 C 660 300 800 430 800 610 A 288 288 0 0 1 224 610 C 224 430 364 300 512 120 Z" fill="url(#resin)" filter="url(#sh)"/>'
    '<rect x="382" y="470" width="260" height="320" rx="34" fill="url(#sheet)"/>' + lines(430, 594, [560, 630, 700], RULE, 14)
    + '<path d="M392 300 C 404 262 430 230 460 206" stroke="#FFE3A6" stroke-width="26" stroke-linecap="round" fill="none"/>')
# S6: the current pad, but the header curves down like a resin pour, and the page is warm cream.
V['S6 Poured header'] = ('<rect width="1024" height="1024" fill="url(#cream)"/>'
    '<path d="M0 0 H1024 V300 C 860 380 700 280 512 330 C 330 380 170 300 0 350 Z" fill="url(#resin)"/>'
    + leaf(512, 170, 1.4) + lines(170, 854, [560, 700, 840], RULE, 14))

items = [('Current', current())] + list(V.items())
W = len(items) * 250 + 40; H = 560
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="-apple-system, Helvetica">', defs(), EXTRA, '<defs>', *[clip(i) for i in range(len(items))], '</defs>',
       f'<rect width="{W}" height="{H}" fill="#F5F5F7"/>', f'<rect y="300" width="{W}" height="110" fill="#1C1C1E"/>',
       f'<rect y="410" width="{W}" height="110" fill="#8FA7C4"/>']
for i, (name, body) in enumerate(items):
    x = 30 + i * 250
    out.append(f'<g transform="translate({x+15} 30) scale(0.1953)">{icon_svg(body, i)}</g>')
    out.append(f'<text x="{x+115}" y="270" font-size="17" font-weight="600" text-anchor="middle" fill="#1D1D1F">{name}</text>')
    for row, y in ((0, 323), (1, 433)):
        out.append(f'<g transform="translate({x+40} {y}) scale(0.0586)">{icon_svg(body, i)}</g>')
        out.append(f'<g transform="translate({x+130} {y+14}) scale(0.03125)">{icon_svg(body, i)}</g>')
    if name != 'Current':
        open(f"store-{name.split()[0]}.svg", 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{defs()}{EXTRA}<defs>{clip(i)}</defs>{icon_svg(body, i)}</svg>')
out.append('</svg>')
open('store-sheet.svg', 'w').write(''.join(out))
