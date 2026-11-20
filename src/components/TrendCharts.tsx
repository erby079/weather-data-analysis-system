import React, { useMemo, useState } from 'react';
import { AnalysisResult, PipelineConfig } from '../types/weather';

interface TrendChartsProps {
  analysis: AnalysisResult;
  config: PipelineConfig;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Calibrated scientific cool-to-warm color ramp for temperature heatmap
function tempToColor(value: number, min: number, max: number): { bg: string; text: string } {
  if (Number.isNaN(value)) {
    return { bg: '#F1F5F9', text: '#94A3B8' };
  }
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  // 5-stop perceptual ramp: Deep Cobalt -> Soft Sky -> Crisp Neutral -> Warm Amber -> Thermal Crimson
  const stops: [number, [number, number, number]][] = [
    [0.0, [29, 78, 216]],
    [0.25, [96, 165, 250]],
    [0.5, [241, 245, 249]],
    [0.75, [245, 158, 11]],
    [1.0, [185, 28, 28]],
  ];

  let r = 241,
    g = 245,
    b = 249;
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      break;
    }
  }
  // WCAG luminance check for legible cell text
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    bg: `rgb(${r}, ${g}, ${b})`,
    text: luminance > 0.58 ? '#0F172A' : '#FFFFFF',
  };
}

export const TrendCharts: React.FC<TrendChartsProps> = ({ analysis, config }) => {
  const [showDaily, setShowDaily] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [showImputedMarkers, setShowImputedMarkers] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverCell, setHoverCell] = useState<{ year: number; month: number } | null>(null);

  const n = analysis.rowCount;
  const tempArr = analysis.cleanedArrays.tempMean;
  const rawTempArr = analysis.rawArrays.tempMean;
  const rollingArr = analysis.rollingTemp;
  const trendArr = analysis.trendLine;
  const rainArr = analysis.cleanedArrays.rainfall;
  const imputedMask = analysis.wasImputed.tempMean;

  // Compute SVG geometry
  const W = 920;
  const H = 310;
  const pad = { top: 18, right: 20, bottom: 34, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const { yMin, yMax, yTicks, dailyPath, rollingPath, trendPath, xTicks } = useMemo(() => {
    if (n === 0) {
      return {
        yMin: 0,
        yMax: 30,
        yTicks: [0, 10, 20, 30],
        dailyPath: '',
        rollingPath: '',
        trendPath: '',
        xTicks: [] as { idx: number; label: string }[],
      };
    }

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = tempArr[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const span = Math.max(4, maxVal - minVal);
    const yLo = Math.floor((minVal - span * 0.08) / 2) * 2;
    const yHi = Math.ceil((maxVal + span * 0.08) / 2) * 2;

    const step = Math.max(2, Math.ceil((yHi - yLo) / 5 / 2) * 2);
    const ticks: number[] = [];
    for (let t = yLo; t <= yHi + 0.01; t += step) {
      ticks.push(Math.round(t));
    }

    const toX = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const toY = (v: number) => pad.top + ((yHi - v) / Math.max(1e-6, yHi - yLo)) * plotH;

    // Downsample slightly if > 2000 rows for crisp 60fps SVG rendering
    const stride = n > 2000 ? Math.ceil(n / 1800) : 1;
    const dParts: string[] = [];
    const rParts: string[] = [];
    for (let i = 0; i < n; i += stride) {
      const x = toX(i).toFixed(1);
      dParts.push(`${i === 0 ? 'M' : 'L'}${x},${toY(tempArr[i]).toFixed(1)}`);
      rParts.push(`${i === 0 ? 'M' : 'L'}${x},${toY(rollingArr[i]).toFixed(1)}`);
    }
    if ((n - 1) % stride !== 0) {
      const last = n - 1;
      dParts.push(`L${toX(last).toFixed(1)},${toY(tempArr[last]).toFixed(1)}`);
      rParts.push(`L${toX(last).toFixed(1)},${toY(rollingArr[last]).toFixed(1)}`);
    }

    const tPath = `M${toX(0).toFixed(1)},${toY(trendArr[0]).toFixed(1)} L${toX(n - 1).toFixed(1)},${toY(trendArr[n - 1]).toFixed(1)}`;

    // X-axis ticks (5–7 evenly spaced date labels)
    const tickCount = Math.min(7, Math.max(2, Math.floor(plotW / 120)));
    const xTickList: { idx: number; label: string }[] = [];
    for (let k = 0; k < tickCount; k++) {
      const idx = Math.round((k / (tickCount - 1)) * (n - 1));
      const dStr = analysis.dates[idx] ?? '';
      xTickList.push({
        idx,
        label: config.yearFilter === 'all' ? dStr.slice(0, 7) : dStr.slice(5),
      });
    }

    return {
      yMin: yLo,
      yMax: yHi,
      yTicks: ticks,
      dailyPath: dParts.join(' '),
      rollingPath: rParts.join(' '),
      trendPath: tPath,
      xTicks: xTickList,
    };
  }, [n, tempArr, rollingArr, trendArr, analysis.dates, config.yearFilter, pad.left, pad.top, plotW, plotH]);

  const toX = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const toY = (v: number) => pad.top + ((yMax - v) / Math.max(1e-6, yMax - yMin)) * plotH;

  const tempAnomalies = useMemo(
    () => analysis.anomalies.filter((a) => a.kind === 'Heatwave' || a.kind === 'Cold Snap'),
    [analysis.anomalies]
  );

  const imputedIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      if (imputedMask[i] === 1) out.push(i);
    }
    return out;
  }, [n, imputedMask]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const clamped = Math.max(pad.left, Math.min(W - pad.right, relX));
    const frac = (clamped - pad.left) / plotW;
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHoverIdx(idx);
  };

  // Heatmap min/max calculation
  const { hmYears, hmMin, hmMax, cellMap } = useMemo(() => {
    const yearsSet = new Set<number>();
    let lo = Infinity;
    let hi = -Infinity;
    const map = new Map<string, (typeof analysis.yearMonthGrid)[0]>();
    for (const c of analysis.yearMonthGrid) {
      yearsSet.add(c.year);
      map.set(`${c.year}-${c.month}`, c);
      if (!Number.isNaN(c.meanTemp)) {
        if (c.meanTemp < lo) lo = c.meanTemp;
        if (c.meanTemp > hi) hi = c.meanTemp;
      }
    }
    return {
      hmYears: Array.from(yearsSet).sort((a, b) => a - b),
      hmMin: lo === Infinity ? 0 : lo,
      hmMax: hi === -Infinity ? 30 : hi,
      cellMap: map,
    };
  }, [analysis.yearMonthGrid]);

  const activeCell = hoverCell
    ? cellMap.get(`${hoverCell.year}-${hoverCell.month}`) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Primary Time-Series Chart Panel */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Temperature Time Series &amp; Convolution Smoothing
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              np.convolve(temp, kernel_{config.rollingWindow}d) · np.polyfit(t, temp, 1) slope{' '}
              {analysis.trendSlopePerYear >= 0 ? '+' : ''}
              {analysis.trendSlopePerYear.toFixed(3)} °C/yr (R² = {analysis.trendR2.toFixed(3)})
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowDaily((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDaily
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Daily Mean
            </button>
            <button
              type="button"
              onClick={() => setShowTrend((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showTrend
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Linear Fit
            </button>
            <button
              type="button"
              onClick={() => setShowAnomalies((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showAnomalies
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Anomalies ({tempAnomalies.length})
            </button>
            <button
              type="button"
              onClick={() => setShowImputedMarkers((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showImputedMarkers
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Imputed NaNs ({imputedIndices.length})
            </button>
          </div>
        </div>

        {/* Live Crosshair Telemetry Bar */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 px-3 mt-3 bg-slate-50 border border-slate-200/80 rounded text-xs font-mono tabular-nums">
          {hoverIdx !== null ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
                <span className="font-semibold text-slate-900">{analysis.dates[hoverIdx]}</span>
                <span className="text-slate-300">/</span>
                <span>
                  Cleaned: <strong className="text-slate-900">{tempArr[hoverIdx].toFixed(1)} °C</strong>
                </span>
                <span>
                  {config.rollingWindow}d Avg:{' '}
                  <strong className="text-blue-700">{rollingArr[hoverIdx].toFixed(1)} °C</strong>
                </span>
                <span>
                  Z-Score:{' '}
                  <strong
                    className={
                      Math.abs(analysis.tempZScores[hoverIdx]) >= config.anomalySigma
                        ? 'text-amber-700'
                        : 'text-slate-800'
                    }
                  >
                    {analysis.tempZScores[hoverIdx] >= 0 ? '+' : ''}
                    {analysis.tempZScores[hoverIdx].toFixed(2)}σ
                  </strong>
                </span>
                <span>
                  Rain: <strong className="text-slate-900">{rainArr[hoverIdx].toFixed(1)} mm</strong>
                </span>
              </div>
              <div className="text-slate-500">
                {Number.isNaN(rawTempArr[hoverIdx])
                  ? 'Raw cell was NaN · Imputed'
                  : analysis.wasClipped.tempMean[hoverIdx] === 1
                  ? `Raw glitch ${rawTempArr[hoverIdx].toFixed(1)} °C · Clipped`
                  : `Raw: ${rawTempArr[hoverIdx].toFixed(1)} °C`}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-500">
              <span>Move cursor across chart to probe exact Float64Array indices</span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span className="inline-block w-3 h-0.5 bg-blue-700" /> {config.rollingWindow}d Moving Average
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span className="inline-block w-3 h-0.5 border-t border-dashed border-red-600" /> Linear Trend
              </span>
            </div>
          )}
        </div>

        {/* SVG Viewport */}
        <div className="mt-3 w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto min-w-[640px] cursor-crosshair select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
            role="img"
            aria-label="Temperature time series with rolling average and linear regression trend"
          >
            {/* Horizontal grid lines */}
            {yTicks.map((tick) => {
              const y = toY(tick);
              return (
                <g key={tick}>
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
                    className="fill-slate-500 font-mono text-[10px]"
                  >
                    {tick}°C
                  </text>
                </g>
              );
            })}

            {/* X-axis ticks */}
            {xTicks.map((t, i) => {
              const x = toX(t.idx);
              return (
                <g key={`${t.idx}-${i}`}>
                  <line
                    x1={x}
                    y1={H - pad.bottom}
                    x2={x}
                    y2={H - pad.bottom + 5}
                    stroke="#CBD5E1"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={H - pad.bottom + 18}
                    textAnchor="middle"
                    className="fill-slate-500 font-mono text-[10px]"
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}

            {/* Axis border */}
            <line
              x1={pad.left}
              y1={pad.top}
              x2={pad.left}
              y2={H - pad.bottom}
              stroke="#CBD5E1"
              strokeWidth="1"
            />
            <line
              x1={pad.left}
              y1={H - pad.bottom}
              x2={W - pad.right}
              y2={H - pad.bottom}
              stroke="#CBD5E1"
              strokeWidth="1"
            />

            {/* Daily Mean Temperature Series */}
            {showDaily && dailyPath && (
              <path
                d={dailyPath}
                fill="none"
                stroke="#94A3B8"
                strokeOpacity="0.55"
                strokeWidth="1"
              />
            )}

            {/* Imputed NaN Markers */}
            {showImputedMarkers &&
              imputedIndices.map((idx) => (
                <circle
                  key={`imp-${idx}`}
                  cx={toX(idx)}
                  cy={toY(tempArr[idx])}
                  r="2.4"
                  fill="#0D9488"
                  fillOpacity="0.85"
                />
              ))}

            {/* Rolling Average Curve (np.convolve) */}
            {rollingPath && (
              <path
                d={rollingPath}
                fill="none"
                stroke="#1D4ED8"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
            )}

            {/* Linear Fit Trend Line (np.polyfit) */}
            {showTrend && trendPath && (
              <path
                d={trendPath}
                fill="none"
                stroke="#DC2626"
                strokeWidth="1.6"
                strokeDasharray="6 4"
              />
            )}

            {/* Anomaly Scatter Points */}
            {showAnomalies &&
              tempAnomalies.map((a) => (
                <circle
                  key={`anom-${a.index}`}
                  cx={toX(a.index)}
                  cy={toY(a.tempMean)}
                  r="3.2"
                  fill={a.kind === 'Heatwave' ? '#D97706' : '#0284C7'}
                  stroke="#FFFFFF"
                  strokeWidth="1"
                />
              ))}

            {/* Interactive Crosshair */}
            {hoverIdx !== null && (
              <g pointerEvents="none">
                <line
                  x1={toX(hoverIdx)}
                  y1={pad.top}
                  x2={toX(hoverIdx)}
                  y2={H - pad.bottom}
                  stroke="#1E293B"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={toX(hoverIdx)}
                  cy={toY(tempArr[hoverIdx])}
                  r="4"
                  fill="#0F172A"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
                <circle
                  cx={toX(hoverIdx)}
                  cy={toY(rollingArr[hoverIdx])}
                  r="3.5"
                  fill="#1D4ED8"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        </div>
      </section>

      {/* Bottom 2-Column Split: Year × Month Heatmap + Top Z-Score Anomalies */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Year × Month Mean Temperature Heatmap */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Year × Month Temperature Matrix
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Mean monthly temperature (°C) computed via boolean year-month masking
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-600">
              <span>{hmMin.toFixed(1)}°C</span>
              <span
                className="inline-block w-24 h-2.5 rounded-xs border border-slate-200"
                style={{
                  background:
                    'linear-gradient(90deg, rgb(29,78,216) 0%, rgb(96,165,250) 25%, rgb(241,245,249) 50%, rgb(245,158,11) 75%, rgb(185,28,28) 100%)',
                }}
              />
              <span>{hmMax.toFixed(1)}°C</span>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto flex-1">
            <table className="w-full border-separate border-spacing-[2px] text-center">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-mono font-medium text-slate-500 pr-2 pb-1">
                    Year
                  </th>
                  {MONTH_SHORT.map((m) => (
                    <th
                      key={m}
                      className="text-[11px] font-mono font-medium text-slate-500 pb-1 px-0.5"
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hmYears.map((yr) => (
                  <tr key={yr}>
                    <td className="text-left text-xs font-mono font-semibold text-slate-700 pr-2 py-1 tabular-nums">
                      {yr}
                    </td>
                    {MONTH_SHORT.map((_, mIdx) => {
                      const month = mIdx + 1;
                      const cell = cellMap.get(`${yr}-${month}`);
                      const val = cell ? cell.meanTemp : Number.NaN;
                      const { bg, text } = tempToColor(val, hmMin, hmMax);
                      const isHovered =
                        hoverCell?.year === yr && hoverCell?.month === month;
                      return (
                        <td
                          key={month}
                          onMouseEnter={() => setHoverCell({ year: yr, month })}
                          onMouseLeave={() => setHoverCell(null)}
                          style={{ backgroundColor: bg, color: text }}
                          className={`py-2 px-1 rounded-[2px] text-[11px] font-mono tabular-nums cursor-default transition-transform ${
                            isHovered ? 'ring-2 ring-slate-900 scale-[1.03]' : ''
                          }`}
                        >
                          {Number.isNaN(val) ? '—' : val.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-mono tabular-nums text-slate-600 min-h-[20px]">
            {activeCell && !Number.isNaN(activeCell.meanTemp) ? (
              <span>
                <strong className="text-slate-900">
                  {MONTH_SHORT[activeCell.month - 1]} {activeCell.year}
                </strong>{' '}
                · Mean Temp: <strong className="text-slate-900">{activeCell.meanTemp.toFixed(2)} °C</strong> ·
                Monthly Rainfall: <strong className="text-blue-700">{activeCell.totalRain.toFixed(1)} mm</strong> ·{' '}
                {activeCell.days} observations
              </span>
            ) : (
              <span className="text-slate-400">
                Hover any month cell to inspect aggregated temperature and rainfall totals.
              </span>
            )}
          </div>
        </section>

        {/* Z-Score Anomaly Ledger */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
          <div className="pb-4 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-900">
              Extreme Anomaly Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Top events where |z| ≥ {config.anomalySigma.toFixed(1)}σ ({analysis.anomalies.length} total)
            </p>
          </div>

          <div className="mt-3 overflow-y-auto max-h-[268px] flex-1">
            {analysis.anomalies.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No observations exceed {config.anomalySigma.toFixed(1)}σ. Lower the anomaly threshold in the sidebar to inspect milder deviations.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Event</th>
                    <th className="py-2 font-medium text-right">Reading</th>
                    <th className="py-2 font-medium text-right">Z-Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                  {analysis.anomalies.slice(0, 12).map((evt) => (
                    <tr key={`${evt.date}-${evt.kind}`} className="hover:bg-slate-50">
                      <td className="py-2 text-slate-800">{evt.date}</td>
                      <td className="py-2 font-sans">
                        <span
                          className={
                            evt.kind === 'Heatwave'
                              ? 'text-amber-700 font-medium'
                              : evt.kind === 'Cold Snap'
                              ? 'text-blue-700 font-medium'
                              : 'text-teal-700 font-medium'
                          }
                        >
                          {evt.kind}
                        </span>
                      </td>
                      <td className="py-2 text-right text-slate-800">
                        {evt.kind === 'Extreme Rain'
                          ? `${evt.rainfall.toFixed(1)} mm`
                          : `${evt.tempMean.toFixed(1)} °C`}
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-900">
                        {evt.zScore >= 0 ? '+' : ''}
                        {evt.zScore.toFixed(2)}σ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
