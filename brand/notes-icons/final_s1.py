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

# The page's placement in the tile: RAISE lifts it by that share of the tile's height, PAGE_SCALE
# scales it about its own centre (512, 526).
RAISE = 0.0
PAGE_SCALE = 1.0


def body(raise_=None, scale=None):
    raise_ = RAISE if raise_ is None else raise_
    scale = PAGE_SCALE if scale is None else scale
    place = f'translate(0 {-raise_ * 1024:g}) translate(512 526) scale({scale:g}) translate(-512 -526) ' if raise_ or scale != 1 else ''
    return ('<rect width="1024" height="1024" fill="url(#resin)"/>'
            f'<g transform="{place}rotate(-6 512 530)" filter="url(#sh)"><rect x="232" y="196" width="560" height="660" rx="56" fill="url(#sheet)"/>'
            + lines(312, 712, [470, 580, 690], RULE, 16) + leaf(640, 318, 0.95) + '</g>')

D = defs() + EXTRA
# The Mac tile's drop shadow on its transparent margin: (dy, blur σ, opacity) on the 1024 canvas,
# black, or None for no baked shadow. iOS icons are full-bleed and carry none.
MAC_SHADOW = (10, 5, 0.30)  # Apple's macOS app icon template: y 10, blur 10 (σ 5), black 30%


def mac_svg(shadow=MAC_SHADOW, raise_=None, scale=None):
    shape = 'x="100" y="100" width="824" height="824" rx="185"'
    drop = tile = ''
    if shadow:  # the shadow alone, cast by the tile's shape, so no underlay can fringe the edge
        dy, blur, opacity = shadow
        drop = (f'<filter id="s" x="-10%" y="-10%" width="120%" height="130%">'
                f'<feGaussianBlur in="SourceAlpha" stdDeviation="{blur}"/><feOffset dy="{dy}" result="b"/>'
                f'<feFlood flood-color="#000" flood-opacity="{opacity}"/><feComposite in2="b" operator="in"/></filter>')
        tile = f'<rect {shape} fill="#000" filter="url(#s)"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
            f'<defs><clipPath id="t"><rect {shape}/></clipPath>{drop}</defs>'
            f'{tile}<g clip-path="url(#t)"><g transform="translate(100 100) scale({824/1024})">{body(raise_, scale)}</g></g>'
            f'<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#000" stroke-opacity=".08"/></svg>')


def ios_svg(raise_=None, scale=None):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}{body(raise_, scale)}</svg>'


def mark_svg(raise_=None, scale=None):
    # In-app mark: the rounded tile, transparent outside (no drawn edge: the amber tile holds its own on white).
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
            '<defs><clipPath id="m"><rect width="1024" height="1024" rx="228"/></clipPath></defs>'
            f'<g clip-path="url(#m)">{body(raise_, scale)}</g></svg>')


if __name__ == "__main__":
    open('final-ios.svg', 'w').write(ios_svg())
    open('final-mac.svg', 'w').write(mac_svg())
    open('final-mark.svg', 'w').write(mark_svg())
