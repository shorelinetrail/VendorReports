// Horizontal single-hue bar list: magnitude comparison with direct value
// labels. Server-renderable (no interaction needed — every value is labeled).

export interface BarListItem {
  label: string;
  value: number;
}

export default function BarList({ items, color = '#2a78d6' }: { items: BarListItem[]; color?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-40 flex-shrink-0 truncate text-right text-xs text-gray-600">{item.label}</span>
          <div className="h-4 flex-1">
            <div
              className="flex h-4 min-w-[2px] items-center rounded-r"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-8 flex-shrink-0 text-xs font-medium text-gray-900">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
