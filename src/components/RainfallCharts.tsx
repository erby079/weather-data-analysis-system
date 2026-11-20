import React, { useState } from 'react';
import { AnalysisResult } from '../types/weather';

interface RainfallChartsProps {
  analysis: AnalysisResult;
}

export const RainfallCharts: React.FC<RainfallChartsProps> = ({ analysis }) => {
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const monthly = analysis.monthlySummaries;
  const seasons = analysis.seasonalStats;

  // Dual-axis Climograph SVG geometry
  const W = 880;
  const H = 300;
  const pad = { top: 22, right: 56, bottom: 34, left: 54 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const maxRain = Math.max(
    25,
    Math.ceil(Math.max(...monthly.map((m) => m.totalRainfallAvgPerYear), 10) / 20) * 20
  );

  const validTemps = monthly.map((m) => m.meanTemp).filter((v) => !Number.isNaN(v));
  const minT = validTemps.length ? Math.floor((Math.min(...validTemps) - 4) / 5) * 5 : 0;
  const maxT = validTemps.length ? Math.ceil((Math.max(...validTemps) + 4) / 5) * 5 : 35;

  const barStep = plotW / 12;
  const barWidth = Math.min(34, barStep * 0.54);

  const rainToY = (mm: number) => pad.top + ((maxRain - mm) / maxRain) * plotH;
  const tempToY = (c: number) =>
    pad.top + ((maxT - c) / Math.max(1, maxT - minT)) * plotH;
  const monthToX = (idx: number) => pad.left + (idx + 0.5) * barStep;

  const tempLinePoints = monthly
    .map((m, i) =>
      Number.isNaN(m.meanTemp) ? null : `${monthToX(i).toFixed(1)},${tempToY(m.meanTemp).toFixed(1)}`
    )
    .filter(Boolean)
    .join(' ');

  const rainTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxRain * f));
  const tempTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(minT + (maxT - minT) * f));

  // Boxplot scale
  const boxMin = Math.floor(
    Math.min(...seasons.map((s) => (Number.isNaN(s.p05) ? 0 : s.p05))) - 3
  );
  const boxMax = Math.ceil(
    Math.max(...seasons.map((s) => (Number.isNaN(s.p95) ? 30 : s.p95))) + 3
  );
  const boxRange = Math.max(5, boxMax - boxMin);
  const boxToPct = (v: number) => ((v - boxMin) / boxRange) * 100;

  const activeMonth = hoverMonth !== null ? monthly[hoverMonth] : null;

  return (
    <div className="space-y-6">
      {/* Monthly Dual-Axis Climograph */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Monthly Rainfall &amp; Temperature Climograph
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Average monthly precipitation (mm/year, left axis) overlaid with mean temperature (°C, right axis)
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 bg-blue-600/80 rounded-[1px]" /> Rainfall (mm)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-amber-600" /> Mean Temp (°C)
            </span>
          </div>
        </div>

        {/* Interactive Month Readout Bar */}
        <div className="mt-3 py-2.5 px-3 bg-slate-50 border border-slate-200/80 rounded text-xs font-mono tabular-nums flex flex-wrap items-center justify-between gap-3">
          {activeMonth ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
                <strong className="text-slate-900">{activeMonth.monthLabel}</strong>
                <span className="text-slate-300">/</span>
                <span>
                  Avg Rain:{' '}
                  <strong className="text-blue-700">
                    {activeMonth.totalRainfallAvgPerYear.toFixed(1)} mm
                  </strong>
                </span>
                <span>
                  Mean Temp:{' '}
                  <strong className="text-amber-700">
                    {Number.isNaN(activeMonth.meanTemp) ? '—' : `${activeMonth.meanTemp.toFixed(1)} °C`}
                  </strong>
                </span>
                <span>
                  Rainy Days:{' '}
                  <strong className="text-slate-900">
                    {activeMonth.rainyDaysAvgPerYear.toFixed(1)} d/yr
                  </strong>
                </span>
                <span>
                  Humidity:{' '}
                  <strong className="text-slate-900">
                    {Number.isNaN(activeMonth.meanHumidity) ? '—' : `${activeMonth.meanHumidity.toFixed(0)}%`}
                  </strong>
                </span>
              </div>
              <span className="text-slate-500">
                Extremes:{' '}
                {Number.isNaN(activeMonth.minTemp)
                  ? '—'
                  : `${activeMonth.minTemp.toFixed(1)}°C to ${activeMonth.maxTemp.toFixed(1)}°C`}
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              Hover any month column to inspect precipitation volume, rainy day frequency, and thermal bounds.
            </span>
          )}
        </div>

        <div className="mt-3 w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto min-w-[620px] select-none"
            role="img"
            aria-label="Monthly rainfall and mean temperature climograph"
          >
            {/* Horizontal gridlines aligned with rainfall axis */}
            {rainTicks.map((rt) => {
              const y = rainToY(rt);
              return (
                <g key={`r-${rt}`}>
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={W - pad.right}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeWidth="1"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-blue-700 font-mono text-[10px]"
                  >
                    {rt} mm
                  </text>
                </g>
              );
            })}

            {/* Right axis temperature ticks */}
            {tempTicks.map((tt) => {
              const y = tempToY(tt);
              return (
                <text
                  key={`t-${tt}`}
                  x={W - pad.right + 8}
                  y={y + 4}
                  textAnchor="start"
                  className="fill-amber-700 font-mono text-[10px]"
                >
                  {tt}°C
                </text>
              );
            })}

            {/* Axes borders */}
            <line x1={pad.left} y1={pad.top} x2={pad.left} y2={H - pad.bottom} stroke="#CBD5E1" />
            <line x1={W - pad.right} y1={pad.top} x2={W - pad.right} y2={H - pad.bottom} stroke="#CBD5E1" />
            <line x1={pad.left} y1={H - pad.bottom} x2={W - pad.right} y2={H - pad.bottom} stroke="#CBD5E1" />

            {/* Rainfall Bars + Interactive Columns */}
            {monthly.map((m, idx) => {
              const cx = monthToX(idx);
              const barTop = rainToY(m.totalRainfallAvgPerYear);
              const barH = Math.max(0, H - pad.bottom - barTop);
              const isHovered = hoverMonth === idx;
              return (
                <g
                  key={m.monthLabel}
                  onMouseEnter={() => setHoverMonth(idx)}
                  onMouseLeave={() => setHoverMonth(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={pad.left + idx * barStep}
                    y={pad.top}
                    width={barStep}
                    height={plotH}
                    fill={isHovered ? '#EFF6FF' : 'transparent'}
                  />
                  <rect
                    x={cx - barWidth / 2}
                    y={barTop}
                    width={barWidth}
                    height={barH}
                    rx="1.5"
                    fill={isHovered ? '#1D4ED8' : '#3B82F6'}
                    fillOpacity={isHovered ? 0.95 : 0.78}
                  />
                  <text
                    x={cx}
                    y={H - pad.bottom + 18}
                    textAnchor="middle"
                    className={`font-mono text-[11px] ${
                      isHovered ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                    }`}
                  >
                    {m.monthLabel}
                  </text>
                </g>
              );
            })}

            {/* Mean Temp Overlay Line */}
            {tempLinePoints && (
              <polyline
                points={tempLinePoints}
                fill="none"
                stroke="#D97706"
                strokeWidth="2.2"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}

            {/* Mean Temp Nodes */}
            {monthly.map((m, idx) => {
              if (Number.isNaN(m.meanTemp)) return null;
              const isHovered = hoverMonth === idx;
              return (
                <circle
                  key={`pt-${m.monthLabel}`}
                  cx={monthToX(idx)}
                  cy={tempToY(m.meanTemp)}
                  r={isHovered ? 4.8 : 3.2}
                  fill={isHovered ? '#B45309' : '#D97706'}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                  pointerEvents="none"
                />
              );
            })}
          </svg>
        </div>
      </section>

      {/* Bottom 2-Column Split: Seasonal Percentiles Boxplot + Boolean Run-Length Streaks */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Seasonal Box-and-Whisker Distribution */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="pb-4 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-900">
              Seasonal Temperature Distribution
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              np.percentile(temp[season_mask], [5, 25, 50, 75, 95])
            </p>
          </div>

          <div className="mt-5 space-y-5">
            {seasons.map((s) => {
              const hasData = s.count > 0 && !Number.isNaN(s.p50);
              return (
                <div key={s.season} className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-3">
                    <div className="text-sm font-medium text-slate-900">{s.season}</div>
                    <div className="text-[11px] text-slate-500">{s.monthsLabel}</div>
                  </div>

                  {/* Horizontal Box-and-Whisker Track */}
                  <div className="col-span-6 relative h-7 flex items-center">
                    <div className="w-full h-px bg-slate-200" />
                    {hasData && (
                      <>
                        {/* P05 - P95 Whisker */}
                        <div
                          className="absolute h-0.5 bg-slate-400"
                          style={{
                            left: `${boxToPct(s.p05)}%`,
                            width: `${Math.max(0.5, boxToPct(s.p95) - boxToPct(s.p05))}%`,
                          }}
                        />
                        {/* Left Whisker Cap (P05) */}
                        <div
                          className="absolute w-0.5 h-3 bg-slate-500"
                          style={{ left: `${boxToPct(s.p05)}%` }}
                        />
                        {/* Right Whisker Cap (P95) */}
                        <div
                          className="absolute w-0.5 h-3 bg-slate-500"
                          style={{ left: `${boxToPct(s.p95)}%` }}
                        />
                        {/* Interquartile Range Box (P25 - P75) */}
                        <div
                          className="absolute h-5 bg-blue-100 border border-blue-600 rounded-[2px]"
                          style={{
                            left: `${boxToPct(s.p25)}%`,
                            width: `${Math.max(1.5, boxToPct(s.p75) - boxToPct(s.p25))}%`,
                          }}
                        />
                        {/* Median Line (P50) */}
                        <div
                          className="absolute w-0.5 h-5 bg-slate-900"
                          style={{ left: `${boxToPct(s.p50)}%` }}
                        />
                      </>
                    )}
                  </div>

                  {/* Tabular Quartile Readout */}
                  <div className="col-span-3 text-right font-mono text-xs tabular-nums">
                    {hasData ? (
                      <>
                        <div className="font-semibold text-slate-900">
                          {s.p50.toFixed(1)} °C
                        </div>
                        <div className="text-[11px] text-slate-500">
                          IQR {s.p25.toFixed(1)}–{s.p75.toFixed(1)}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Scale Axis Footer */}
            <div className="grid grid-cols-12 pt-2 border-t border-slate-100">
              <div className="col-span-3 text-[11px] text-slate-400">5th–95th %ile</div>
              <div className="col-span-6 flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
                <span>{boxMin}°C</span>
                <span>{Math.round((boxMin + boxMax) / 2)}°C</span>
                <span>{boxMax}°C</span>
              </div>
              <div className="col-span-3 text-right text-[11px] text-slate-400">Median / IQR</div>
            </div>
          </div>
        </section>

        {/* Vectorized Run-Length Extremes */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">
                Consecutive Extreme Streaks
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                np.diff(np.concatenate(([0], mask, [0])))
              </p>
            </div>

            <div className="divide-y divide-slate-100 mt-2">
              {analysis.streaks.map((st) => (
                <div key={st.kind} className="py-4 flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{st.kind}</div>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      {st.startDate} → {st.endDate} · {st.metricDetail}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-mono font-semibold text-slate-900 tabular-nums">
                      {st.days}
                    </span>
                    <span className="text-xs font-mono text-slate-500 ml-1">days</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between font-mono tabular-nums">
            <span>Wettest Month: {analysis.summaryKPIs.wettestMonthLabel}</span>
            <span>{analysis.summaryKPIs.wettestMonthMm.toFixed(1)} mm/yr avg</span>
          </div>
        </section>
      </div>
    </div>
  );
};
