// Horizontal grouped bars (e.g. one group per vendor, one thin bar per
// measure). Direct value labels on every bar, so it is server-renderable.

export interface GroupedBarSeries {
  label: string;
  color: string;
}

export interface GroupedBarGroup {
  label: string;
  values: number[]; // aligned with the series array
}

export default function GroupedBars({ groups, series }: { groups: GroupedBarGroup[]; series: GroupedBarSeries[] }) {
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label} className="flex items-start gap-3">
            <span className="w-40 flex-shrink-0 truncate pt-0.5 text-right text-xs text-gray-600" title={group.label}>
              {group.label}
            </span>
            <div className="flex-1 space-y-0.5">
              {group.values.map((value, i) => (
                <div key={series[i].label} className="flex items-center gap-2">
                  <div className="h-2.5 flex-1">
                    <div
                      className="h-2.5 min-w-[2px] rounded-r"
                      style={{ width: `${(value / max) * 100}%`, backgroundColor: series[i].color }}
                      title={`${series[i].label}: ${value}`}
                    />
                  </div>
                  <span className="w-8 flex-shrink-0 text-[10px] font-medium text-gray-700">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
