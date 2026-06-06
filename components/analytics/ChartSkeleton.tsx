'use client';

// Hauteurs fixes — valeurs déterministes pour éviter les écarts d'hydratation SSR/client
const BAR_HEIGHTS = [62, 85, 48, 91, 56, 78, 52, 83];

interface ChartSkeletonProps {
  height?: number;
  type?: 'bar' | 'line' | 'pie';
}

export function ChartSkeleton({ height = 300, type = 'bar' }: ChartSkeletonProps) {
  return (
    <div
      className="animate-pulse rounded-xl bg-gray-900 border border-gray-800 p-6"
      style={{ height }}
      role="status"
      aria-label="Chargement du graphique…"
    >
      {/* En-tête simulée */}
      <div className="mb-2 h-4 w-2/5 rounded-md bg-gray-700" />
      <div className="mb-6 h-3 w-1/4 rounded-md bg-gray-800" />

      {type === 'pie' ? (
        /* ── Pie chart ── */
        <div className="flex h-[calc(100%-5rem)] items-center justify-center gap-8">
          <div
            className="shrink-0 rounded-full bg-gray-700"
            style={{ width: 120, height: 120 }}
          />
          <div className="flex flex-col gap-3">
            {[70, 55, 42].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-sm bg-gray-700" />
                <div className="h-3 rounded-md bg-gray-700" style={{ width: w }} />
              </div>
            ))}
          </div>
        </div>
      ) : type === 'line' ? (
        /* ── Line chart ── */
        <div className="h-[calc(100%-5rem)]">
          <svg
            className="h-full w-full"
            viewBox="0 0 400 180"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Grille horizontale */}
            {[40, 80, 120, 160].map(y => (
              <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#1F2937" strokeWidth="1" />
            ))}
            {/* Seuil 80% (imite LineChartEnveloppes) */}
            <line x1="0" y1={72} x2="400" y2={72}
              stroke="#374151" strokeWidth="1.5" strokeDasharray="6 3" />
            {/* Courbe simulée */}
            <polyline
              points="0,140 50,110 100,125 165,68 220,88 275,48 340,62 400,38"
              fill="none" stroke="#374151" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            />
            {/* Points de données */}
            {[[0,140],[50,110],[100,125],[165,68],[220,88],[275,48],[340,62],[400,38]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="4" fill="#374151" />
            ))}
          </svg>
        </div>
      ) : (
        /* ── Bar chart stacked (imite BarChartDepenses) ── */
        <div className="flex h-[calc(100%-5rem)] items-end gap-2">
          {BAR_HEIGHTS.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col gap-0.5">
              {/* montantReel simulé */}
              <div className="w-full rounded-t-sm bg-gray-700" style={{ height: `${Math.round(h * 0.55)}%` }} />
              {/* montantAnticipe simulé */}
              <div className="w-full bg-gray-800" style={{ height: `${Math.round(h * 0.45)}%` }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
