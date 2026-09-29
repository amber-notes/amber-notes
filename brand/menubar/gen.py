# Menu bar template glyphs (18x18 pt): the notepad from the app icon, in one ink.
def pad(variant):
    # Outline of the pad; the header band is solid; perforation notches cut into its lower edge.
    x, y, w, h, r = 2.25, 1.75, 13.5, 14.5, 3.4
    outline = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="none" stroke="#000" stroke-width="1.5"/>'
    hb = 6.5  # header band bottom
    band = (f'M{x} {y + r} A{r} {r} 0 0 1 {x + r} {y} H{x + w - r} A{r} {r} 0 0 1 {x + w} {y + r} V{hb} H{x} Z')
    holes = ''
    if variant in ('dots', 'dots3'):
        xs = [5.4, 9, 12.6] if variant == 'dots3' else [4.9, 7.3, 9.7, 12.1]
        rr = 0.85 if variant == 'dots3' else 0.7
        holes = ''.join(f' M{cx - rr} {hb} a{rr} {rr} 0 1 0 {2 * rr} 0 a{rr} {rr} 0 1 0 {-2 * rr} 0 Z' for cx in xs)
    header = f'<path d="{band}{holes}" fill="#000" fill-rule="evenodd"/>'
    lines = ''.join(f'<line x1="5.25" y1="{ly}" x2="12.75" y2="{ly}" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>' for ly in (9.75, 12.75))
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">{outline}{header}{lines}</svg>'

for v in ('plain', 'dots', 'dots3'):
    open(f'glyph-{v}.svg', 'w').write(pad(v))
