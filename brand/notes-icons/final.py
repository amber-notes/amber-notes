# The Amber Notes icon: a notepad with an amber header, the leaf, and a perforated tear line.
from gen import defs, leaf, lines

def body():
    top = 330
    holes = ''.join(f'<circle cx="{34 + i * 68.4:.1f}" cy="{top}" r="10" fill="#FFFFFF"/>' for i in range(15))
    return ('<rect width="1024" height="1024" fill="url(#paper)"/>'
            f'<rect width="1024" height="{top}" fill="url(#amb)"/>'
            f'<rect y="{top - 6}" width="1024" height="6" fill="#D9760A" opacity=".35"/>'
            + holes + leaf(512, 168, 1.5)
            + lines(160, 864, [540, 695, 850], '#DCCDB6', 13))

D = defs()
# iOS: full bleed; the system applies the mask.
open('final-ios.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}{body()}</svg>')
# macOS: the standard 824 pt tile on a 1024 canvas, with the system-style shadow.
mac = (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
       '<defs><clipPath id="t"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>'
       '<filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter></defs>'
       '<rect x="100" y="100" width="824" height="824" rx="185" fill="#fff" filter="url(#s)"/>'
       f'<g clip-path="url(#t)"><g transform="translate(100 100) scale({824/1024})">{body()}</g></g>'
       '<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#000" stroke-opacity=".10"/></svg>')
open('final-mac.svg', 'w').write(mac)
# In-app mark: the rounded tile alone, transparent outside, edge to edge.
open('final-mark.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}'
    '<defs><clipPath id="m"><rect width="1024" height="1024" rx="228"/></clipPath></defs>'
    f'<g clip-path="url(#m)">{body()}</g><rect x="2" y="2" width="1020" height="1020" rx="226" fill="none" stroke="#000" stroke-opacity=".10" stroke-width="4"/></svg>')
