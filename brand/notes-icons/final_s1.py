# THE Amber Notes icon (chosen 2026-09-29): a page, slightly turned, on amber (S1 from store-sheet),
# in the "C2 Deeper+" contrast from contrast-sheet.png: a deeper ground, a whiter page, a firmer shadow.
from gen import defs, lines, leaf

GROUND = ('#F8962A', '#D96A06', '#9E4604')  # top, at .55, bottom
PAGE = ('#FFFFFF', '#F7F2EA')
SHADOW = ('#4A2000', 0.45)
RULE = '#E6D7BC'

EXTRA = (f'<defs><linearGradient id="resin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{GROUND[0]}"/>'
         f'<stop offset=".55" stop-color="{GROUND[1]}"/><stop offset="1" stop-color="{GROUND[2]}"/></linearGradient>'
         f'<linearGradient id="sheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{PAGE[0]}"/><stop offset="1" stop-color="{PAGE[1]}"/></linearGradient>'
         f'<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="{SHADOW[0]}" flood-opacity="{SHADOW[1]}"/></filter></defs>')

def body():
    return ('<rect width="1024" height="1024" fill="url(#resin)"/>'
            '<g transform="rotate(-6 512 530)" filter="url(#sh)"><rect x="232" y="196" width="560" height="660" rx="56" fill="url(#sheet)"/>'
            + lines(312, 712, [470, 580, 690], RULE, 16) + leaf(640, 318, 0.95) + '</g>')

D = defs() + EXTRA
open('final-ios.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}{body()}</svg>')
open('final-mac.svg', 'w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
    '<defs><clipPath id="t"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>'
    '<filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter></defs>'
    '<rect x="100" y="100" width="824" height="824" rx="185" fill="#D96A06" filter="url(#s)"/>'
    f'<g clip-path="url(#t)"><g transform="translate(100 100) scale({824/1024})">{body()}</g></g>'
    '<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#000" stroke-opacity=".08"/></svg>')
# In-app mark: the rounded tile, transparent outside (no drawn edge: the amber tile holds its own on white).
open('final-mark.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
    '<defs><clipPath id="m"><rect width="1024" height="1024" rx="228"/></clipPath></defs>'
    f'<g clip-path="url(#m)">{body()}</g></svg>')
