// Tests only: reads a QR code back from the SVG the connect page draws, with an independent decoder.
import jsQR from "jsqr";

/// Decodes the code drawn by app/connect/QRCode.tsx from its viewBox size and path.
export function decodeQRPath(viewBoxSize: number, d: string, scale = 4): string | null {
  const w = viewBoxSize * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, run] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let yy = y * scale; yy < (y + 1) * scale; yy++) {
      for (let xx = x * scale; xx < (x + run) * scale; xx++) {
        const i = (yy * w + xx) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
  }
  return jsQR(px, w, w)?.data ?? null;
}

/// Decodes the first QR code in rendered HTML or an element's markup.
export function decodeQRMarkup(html: string): string | null {
  const view = /viewBox="0 0 (\d+) \1"/.exec(html);
  const path = /<path d="([^"]+)" fill="#000"/.exec(html);
  return view && path ? decodeQRPath(Number(view[1]), path[1]) : null;
}
