import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { AnalysisResult } from '../types/weather';

interface CleaningAndMatrixViewProps {
  analysis: AnalysisResult;
}

type RowFilter = 'all' | 'imputed' | 'clipped' | 'anomalies';

function corrToStyle(r: number): { bg: string; text: string } {
  const clamped = Math.max(-1, Math.min(1, r));
  if (clamped >= 0) {
    // White -> Deep Cobalt
    const t = clamped;
    const red = Math.round(248 - t * (248 - 29));
    const green = Math.round(250 - t * (250 - 78));
    const blue = Math.round(252 - t * (252 - 216));
    return { bg: `rgb(${red},${green},${blue})`, text: t > 0.55 ? '#FFFFFF' : '#0F172A' };
  } else {
    // White -> Thermal Crimson
    const t = -clamped;
    const red = Math.round(248 - t * (248 - 185));
    const green = Math.round(250 - t * (250 - 28));
    const blue = Math.round(252 - t * (252 - 28));
    return { bg: `rgb(${red},${green},${blue})`, text: t > 0.55 ? '#FFFFFF' : '#0F172A' };
  }
}

export const CleaningAndMatrixView: React.FC<CleaningAndMatrixViewProps> = ({ analysis }) => {
  const [selectedPair, setSelectedPair] = useState<[number, number]>([0, 4]);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 15;

  const anomalyIndexSet = useMemo(() => {
    const s = new Set<number>();
    for (const a of analysis.anomalies) s.add(a.index);
    return s;
  }, [analysis.anomalies]);

  const filteredIndices = useMemo(() => {
    const q = searchQuery.trim();
    const out: number[] = [];
    for (let i = 0; i < analysis.rowCount; i++) {
      if (q && !analysis.dates[i].includes(q)) continue;

      if (rowFilter === 'imputed') {
        const hasImp =
          analysis.wasImputed.tempMean[i] === 1 ||
          analysis.wasImputed.rainfall[i] === 1 ||
          analysis.wasImputed.humidity[i] === 1 ||
          analysis.wasImputed.windSpeed[i] === 1;
        if (!hasImp) continue;
      } else if (rowFilter === 'clipped') {
        const hasClip =
          analysis.wasClipped.tempMean[i] === 1 ||
          analysis.wasClipped.humidity[i] === 1 ||
          analysis.wasClipped.windSpeed[i] === 1;
        if (!hasClip) continue;
      } else if (rowFilter === 'anomalies') {
        if (!anomalyIndexSet.has(i)) continue;
      }
      out.push(i);
    }
    return out;
  }, [analysis, rowFilter, searchQuery, anomalyIndexSet]);

  const totalPages = Math.max(1, Math.ceil(filteredIndices.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredIndices.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const pairA = analysis.correlationFields[selectedPair[0]];
  const pairB = analysis.correlationFields[selectedPair[1]];
  const pairVal = analysis.correlationMatrix[selectedPair[0]]?.[selectedPair[1]] ?? 0;

  return (
    <div className="space-y-6">
      {/* Top Grid: Data Cleaning Audit Table + Correlation Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Before vs. After Vectorized Cleaning Audit */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">
              Missing-Value &amp; Outlier Cleaning Audit
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Float64Array shape ({analysis.rowCount}, 6) · {analysis.summaryKPIs.totalNaNsCleaned} NaNs imputed ·{' '}
              {analysis.summaryKPIs.totalOutliersClipped} sensor glitches clipped
            </p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500">
                  <th className="py-2 pr-3 font-medium">Array Column</th>
                  <th className="py-2 px-2 font-medium text-right">NaNs</th>
                  <th className="py-2 px-2 font-medium text-right">Clipped</th>
                  <th className="py-2 px-2 font-medium text-right">μ Before → After</th>
                  <th className="py-2 pl-2 font-medium text-right">σ Before → After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
                {analysis.audits.map((a) => (
                  <tr key={a.field} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3">
                      <div className="font-sans font-medium text-slate-900">{a.label}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[230px]">
                        {a.numpyOp}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <span className={a.nanCount > 0 ? 'text-teal-700 font-semibold' : 'text-slate-400'}>
                        {a.nanCount}
                      </span>
                      <span className="text-slate-400 ml-1">({a.nanPercent.toFixed(1)}%)</span>
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <span
                        className={
                          a.outliersClipped > 0 ? 'text-amber-700 font-semibold' : 'text-slate-400'
                        }
                      >
                        {a.outliersClipped}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700 whitespace-nowrap">
                      {Number.isNaN(a.meanBefore) ? '—' : a.meanBefore.toFixed(2)} →{' '}
                      <strong className="text-slate-900">{a.meanAfter.toFixed(2)}</strong>{' '}
                      <span className="text-slate-400">{a.unit}</span>
                    </td>
                    <td className="py-2.5 pl-2 text-right text-slate-700 whitespace-nowrap">
                      {Number.isNaN(a.stdBefore) ? '—' : a.stdBefore.toFixed(2)} →{' '}
                      <strong className="text-slate-900">{a.stdAfter.toFixed(2)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Pearson Correlation Matrix (np.corrcoef) */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">
                Pearson Correlation Matrix
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                np.corrcoef(np.vstack([T_mean, T_max, T_min, Rain, Humid, Wind]))
              </p>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-separate border-spacing-[2px] text-center">
                <thead>
                  <tr>
                    <th className="w-14" />
                    {analysis.correlationFields.map((f) => (
                      <th
                        key={f.key}
                        className="text-[11px] font-mono font-medium text-slate-500 pb-1"
                      >
                        {f.shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.correlationFields.map((rowF, rIdx) => (
                    <tr key={rowF.key}>
                      <td className="text-left text-[11px] font-mono font-medium text-slate-600 pr-1.5">
                        {rowF.shortLabel}
                      </td>
                      {analysis.correlationFields.map((colF, cIdx) => {
                        const val = analysis.correlationMatrix[rIdx][cIdx];
                        const { bg, text } = corrToStyle(val);
                        const isSelected =
                          selectedPair[0] === rIdx && selectedPair[1] === cIdx;
                        return (
                          <td
                            key={colF.key}
                            onClick={() => setSelectedPair([rIdx, cIdx])}
                            style={{ backgroundColor: bg, color: text }}
                            className={`py-2 px-1 text-[11px] font-mono tabular-nums rounded-[2px] cursor-pointer transition-transform ${
                              isSelected ? 'ring-2 ring-slate-900' : ''
                            }`}
                          >
                            {val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Pair Interpretation */}
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong className="text-slate-900">{pairA?.label}</strong> vs.{' '}
              <strong className="text-slate-900">{pairB?.label}</strong>
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              r = {pairVal >= 0 ? '+' : ''}
              {pairVal.toFixed(3)} ·{' '}
              {Math.abs(pairVal) >= 0.7
                ? 'Strong'
                : Math.abs(pairVal) >= 0.35
                ? 'Moderate'
                : 'Weak'}{' '}
              {pairVal >= 0 ? 'positive' : 'negative'}
            </span>
          </div>
        </section>
      </div>

      {/* Interactive Raw vs. Cleaned Array Data Grid */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Raw vs. Cleaned Array Inspector
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Showing {filteredIndices.length.toLocaleString()} of {analysis.rowCount.toLocaleString()} daily records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search by Date */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Filter date (e.g. 2022-05)"
                className="pl-8 pr-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-48"
              />
            </div>

            {/* Segmented Filter Control */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'imputed', label: 'Imputed NaNs' },
                  { id: 'clipped', label: 'Clipped' },
                  { id: 'anomalies', label: 'Anomalies' },
                ] as { id: RowFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setRowFilter(tab.id);
                    setPage(0);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    rowFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500">
                <th className="py-2 pr-3 font-medium">Idx</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 px-3 font-medium text-right">Raw Temp</th>
                <th className="py-2 px-3 font-medium text-right">Cleaned Temp</th>
                <th className="py-2 px-3 font-medium text-right">Raw Rain</th>
                <th className="py-2 px-3 font-medium text-right">Cleaned Rain</th>
                <th className="py-2 px-3 font-medium text-right">Humidity</th>
                <th className="py-2 pl-3 font-medium text-right">Z-Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-mono tabular-nums">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center font-sans text-slate-500">
                    No records match the current filter.
                  </td>
                </tr>
              ) : (
                pageRows.map((idx) => {
                  const rTemp = analysis.rawArrays.tempMean[idx];
                  const cTemp = analysis.cleanedArrays.tempMean[idx];
                  const rRain = analysis.rawArrays.rainfall[idx];
                  const cRain = analysis.cleanedArrays.rainfall[idx];
                  const cHum = analysis.cleanedArrays.humidity[idx];
                  const z = analysis.tempZScores[idx];
                  const tempImputed = analysis.wasImputed.tempMean[idx] === 1;
                  const tempClipped = analysis.wasClipped.tempMean[idx] === 1;
                  const rainImputed = analysis.wasImputed.rainfall[idx] === 1;

                  return (
                    <tr key={idx} className="hover:bg-slate-50 h-9">
                      <td className="py-1.5 pr-3 text-slate-400">{idx}</td>
                      <td className="py-1.5 pr-3 text-slate-900 font-medium">{analysis.dates[idx]}</td>
                      <td className="py-1.5 px-3 text-right">
                        {Number.isNaN(rTemp) ? (
                          <span className="text-red-600 font-medium">NaN</span>
                        ) : tempClipped ? (
                          <span className="text-amber-700 line-through">{rTemp.toFixed(1)}°C</span>
                        ) : (
                          <span className="text-slate-500">{rTemp.toFixed(1)}°C</span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <span
                          className={
                            tempImputed
                              ? 'text-teal-700 font-semibold'
                              : tempClipped
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-900'
                          }
                        >
                          {cTemp.toFixed(1)}°C
                        </span>
                        {tempImputed && <span className="text-[10px] text-teal-600 ml-1">imp</span>}
                        {tempClipped && <span className="text-[10px] text-amber-600 ml-1">clip</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {Number.isNaN(rRain) ? (
                          <span className="text-red-600 font-medium">NaN</span>
                        ) : (
                          <span className="text-slate-500">{rRain.toFixed(1)} mm</span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <span className={rainImputed ? 'text-teal-700 font-semibold' : 'text-slate-900'}>
                          {cRain.toFixed(1)} mm
                        </span>
                        {rainImputed && <span className="text-[10px] text-teal-600 ml-1">imp</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-slate-700">{cHum.toFixed(1)}%</td>
                      <td className="py-1.5 pl-3 text-right">
                        <span
                          className={
                            anomalyIndexSet.has(idx)
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-600'
                          }
                        >
                          {z >= 0 ? '+' : ''}
                          {z.toFixed(2)}σ
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
          <span>
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
