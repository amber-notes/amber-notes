import { qrModules, qrPath, QUIET } from "@/lib/qr";
import styles from "./connect.module.css";

/// CSS pixels per module: whole pixels keep every module the same width (a version 8 code is 228px).
const PX = 4;

/// A QR code on a white tile, so it scans in any theme. Drawn as SVG: crisp edges, nothing inline
/// that the connect pages' CSP would block. With no link yet, the tile holds its place.
export function QRCode({ link, label }: { link: string | null; label: string }) {
  if (!link) {
    return <div className={styles.qr} role="img" aria-label={label} aria-busy="true"><span className={styles.qrPending} /></div>;
  }
  const modules = qrModules(link);
  const size = modules.length + 2 * QUIET;
  return (
    <div className={styles.qr}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width={size * PX} height={size * PX} shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#fff" />
        <path d={qrPath(modules)} fill="#000" />
      </svg>
    </div>
  );
}
