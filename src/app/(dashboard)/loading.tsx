// Shared skeleton shown while any dashboard page's server data loads.
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-gray-200" />
        <div className="h-4 w-96 max-w-full rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-full w-full rounded bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
