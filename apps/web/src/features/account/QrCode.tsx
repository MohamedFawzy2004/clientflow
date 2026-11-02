import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code drawn as SVG squares (no HTML strings), for the authenticator app to scan. */
export function QrCode({
  value,
  label,
  size = 200,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { count, cells } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: Array<[number, number]> = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([c, r]);
    return { count: n, cells: dark };
  }, [value]);
  const margin = 4;
  const total = count + margin * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md border border-border bg-white"
    >
      <path
        fill="#0b1726"
        d={cells.map(([x, y]) => `M${x + margin} ${y + margin}h1v1h-1z`).join('')}
      />
    </svg>
  );
}
