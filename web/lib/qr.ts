// QR codes for the connect page, drawn as one SVG path: no canvas, no inline style, no eval, so it
// renders under the connect pages' strict CSP and stays crisp at any size.
import qrcode from "qrcode-generator";

/// The quiet zone around a code, in modules (the standard's minimum).
export const QUIET = 4;

/// The code's modules, row by row, true for dark. Error correction M: about 15% of the code can be
/// smudged or glared, and a connect link still fits a version 8 code.
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/// The dark modules as one path, a rectangle per horizontal run, offset by the quiet zone. The
/// viewBox is (size + 2 × QUIET) square.
export function qrPath(modules: boolean[][]): string {
  let d = "";
  modules.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      if (!row[c]) { c++; continue; }
      let end = c;
      while (end < row.length && row[end]) end++;
      d += `M${c + QUIET} ${r + QUIET}h${end - c}v1h-${end - c}z`;
      c = end;
    }
  });
  return d;
}
