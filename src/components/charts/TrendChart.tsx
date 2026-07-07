'use client';

import { useRef, useState } from 'react';

export interface TrendSeries {
  label: string;
  color: string;
}

export interface TrendPoint {
  label: string;
  values: number[]; // aligned with the series array
}

/** Round up to a "nice" axis maximum (1/2/5 × 10^k). */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const W = 640;
const H = 260;
const PAD = { left: 36, right: 12, top: 12, bottom: 26 };

/**
 * Multi-series line chart: 2px lines, recessive grid, crosshair + tooltip on
 * hover, legend below, expandable table view for accessibility.
 */
export default function TrendChart({ data, series }: { data: TrendPoint[]; series: TrendSeries[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yMax = niceMax(Math.max(1, ...data.flatMap((d) => d.values)));
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  // Thin the x labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  function onMove(e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || data.length === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(px - x(i));
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHover(nearest);
  }

  return (
    <div>
      <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly trend chart">
          {/* Grid + y ticks */}
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = (yMax * tick) / 4;
            return (
              <g key={tick}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} stroke="#e5e7eb" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(value) + 3} textAnchor="end" fontSize="10" fill="#6b7280">
                  {value}
                </text>
              </g>
            );
          })}
          {/* X labels */}
          {data.map((point, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={point.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">
                {point.label}
              </text>
            ) : null,
          )}
          {/* Crosshair */}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 3" />
          )}
          {/* Series lines */}
          {series.map((s, si) => (
            <path
              key={s.label}
              d={data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.values[si])}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Hover markers with a surface ring */}
          {hover !== null &&
            series.map((s, si) => (
              <circle key={s.label} cx={x(hover)} cy={y(data[hover].values[si])} r="4" fill={s.color} stroke="#ffffff" strokeWidth="2" />
            ))}
        </svg>
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-lg"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: x(hover) > W / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
          >
            <p className="font-medium text-gray-900">{data[hover].label}</p>
            {series.map((s, si) => (
              <p key={s.label} className="mt-0.5 flex items-center gap-1.5 text-gray-600">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label}: <span className="font-medium text-gray-900">{data[hover].values[si]}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {/* Table view (relief for low-contrast hues) */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">View data as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1 pr-4 font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.label} className="py-1 pr-4 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.label} className="border-b border-gray-100">
                  <td className="py-1 pr-4 text-gray-700">{point.label}</td>
                  {point.values.map((value, i) => (
                    <td key={i} className="py-1 pr-4 text-gray-900">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
