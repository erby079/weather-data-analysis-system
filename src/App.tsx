import React, { useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, SlidersHorizontal, Upload, X } from 'lucide-react';
import { CleaningAndMatrixView } from './components/CleaningAndMatrixView';
import { NumPyCodeLab } from './components/NumPyCodeLab';
import { RainfallCharts } from './components/RainfallCharts';
import { TrendCharts } from './components/TrendCharts';
import {
  SAMPLE_DATASETS,
  serializeDatasetRawCSV,
  serializeRecordsToCSV,
} from './data/sampleDatasets';
import { parseWeatherCSV, runNumPyWeatherAnalysis } from './engine/numpyWeatherEngine';
import {
  PipelineConfig,
  RainImputeMethod,
  TempImputeMethod,
  WeatherDataset,
} from './types/weather';

type ActiveTab = 'trends' | 'rainfall' | 'cleaning' | 'code';

const DEFAULT_CONFIG: PipelineConfig = {
  tempImputeMethod: 'interp',
  rainImputeMethod: 'zero',
  clipOutliers: true,
  outlierSigma: 3.0,
  rollingWindow: 30,
  anomalySigma: 2.2,
  yearFilter: 'all',
};

const NAV_TABS: { id: ActiveTab; label: string }[] = [
  { id: 'trends', label: 'Trends' },
  { id: 'rainfall', label: 'Rainfall' },
  { id: 'cleaning', label: 'Cleaning & Matrix' },
  { id: 'code', label: 'NumPy Code' },
];

export default function App() {
  const [datasets, setDatasets] = useState<WeatherDataset[]>(SAMPLE_DATASETS);
  const [activeDatasetId, setActiveDatasetId] = useState<string>(SAMPLE_DATASETS[0].id);
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<ActiveTab>('trends');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? datasets[0],
    [datasets, activeDatasetId]
  );

  const analysis = useMemo(
    () => runNumPyWeatherAnalysis(activeDataset, config),
    [activeDataset, config]
  );

  const loadCsvFile = (file: File) => {
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const parsed = parseWeatherCSV(text, file.name);
        setDatasets((prev) => [parsed, ...prev]);
        setActiveDatasetId(parsed.id);
        setConfig((prev) => ({ ...prev, yearFilter: 'all' }));
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Unable to parse CSV file. Ensure it contains date and temperature columns.'
        );
      }
    };
    reader.onerror = () => {
      setUploadError('Failed to read the selected file.');
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadCsvFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingCsv(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      loadCsvFile(file);
    }
  };

  const triggerDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadRawCsv = () => {
    triggerDownload(serializeDatasetRawCSV(activeDataset), activeDataset.filename);
  };

  const handleExportCleanedCsv = () => {
    const csv = serializeRecordsToCSV(analysis.dates, analysis.cleanedArrays);
    const outName = activeDataset.filename.replace(/\.csv$/i, '') + '_cleaned.csv';
    triggerDownload(csv, outName);
  };

  const handleDatasetChange = (id: string) => {
    setActiveDatasetId(id);
    setConfig((prev) => ({ ...prev, yearFilter: 'all' }));
    setUploadError(null);
  };

  const dateSpanLabel =
    analysis.rowCount > 0
      ? `${analysis.dates[0]} to ${analysis.dates[analysis.rowCount - 1]}`
      : 'No observations';

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between">
      <div className="space-y-6">
        {/* 1. Dataset Source */}
        <div>
          <label
            htmlFor="station-select"
            className="block text-xs font-semibold text-slate-800 mb-2"
          >
            Historical Dataset
          </label>
          <select
            id="station-select"
            value={activeDataset.id}
            onChange={(e) => handleDatasetChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span className="font-mono tabular-nums truncate">{activeDataset.filename}</span>
            <button
              type="button"
              onClick={handleDownloadRawCsv}
              className="text-blue-700 hover:text-blue-900 font-medium whitespace-nowrap shrink-0 ml-2 cursor-pointer"
            >
              Raw CSV
            </button>
          </div>
        </div>

        <hr className="border-slate-200" />

        {/* 2. Vectorized Cleaning Pipeline */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-slate-800">
            Missing-Value Cleaning
          </h3>

          <div>
            <label
              htmlFor="temp-impute"
              className="block text-xs text-slate-600 mb-1.5"
            >
              Continuous Arrays (Temp · Humidity · Wind)
            </label>
            <select
              id="temp-impute"
              value={config.tempImputeMethod}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  tempImputeMethod: e.target.value as TempImputeMethod,
                }))
              }
              className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
            >
              <option value="interp">np.interp (Time Linear)</option>
              <option value="nanmedian">np.nanmedian (Monthly)</option>
              <option value="nanmean">np.nanmean (Global Mean)</option>
              <option value="ffill">Forward Fill (Accumulate)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="rain-impute"
              className="block text-xs text-slate-600 mb-1.5"
            >
              Rainfall Array (Precipitation NaNs)
            </label>
            <select
              id="rain-impute"
              value={config.rainImputeMethod}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  rainImputeMethod: e.target.value as RainImputeMethod,
                }))
              }
              className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
            >
              <option value="zero">np.nan_to_num(nan=0.0)</option>
              <option value="nanmedian">np.nanmedian (Monthly)</option>
              <option value="interp">np.interp (Linear)</option>
            </select>
          </div>

          <div className="pt-1">
            <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer select-none">
              <span className="font-medium">Clip Sensor Outliers (np.clip)</span>
              <input
                type="checkbox"
                checked={config.clipOutliers}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, clipOutliers: e.target.checked }))
                }
                className="w-4 h-4 accent-blue-700 rounded cursor-pointer"
              />
            </label>

            {config.clipOutliers && (
              <div className="mt-2.5">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 mb-1">
                  <span>IQR Sigma Bound</span>
                  <span className="font-semibold text-slate-900">
                    ±{config.outlierSigma.toFixed(1)}σ
                  </span>
                </div>
                <input
                  type="range"
                  min="2.0"
                  max="4.0"
                  step="0.2"
                  value={config.outlierSigma}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      outlierSigma: parseFloat(e.target.value),
                    }))
                  }
                  aria-label="Outlier clipping IQR sigma bound"
                  className="w-full sci-range"
                />
              </div>
            )}
          </div>
        </div>

        <hr className="border-slate-200" />

        {/* 3. Trend & Signal Parameters */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-slate-800">
            Signal &amp; Pattern Parameters
          </h3>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
              <span>Rolling Kernel (np.convolve)</span>
              <span className="font-mono tabular-nums text-slate-900 font-medium">
                {config.rollingWindow}d
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 rounded-md">
              {[7, 14, 30, 60].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, rollingWindow: w }))}
                  className={`py-1.5 text-xs font-mono font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    config.rollingWindow === w
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 mb-1">
              <span>Anomaly Threshold</span>
              <span className="font-semibold text-slate-900">
                |z| ≥ {config.anomalySigma.toFixed(1)}σ
              </span>
            </div>
            <input
              type="range"
              min="1.5"
              max="3.0"
              step="0.1"
              value={config.anomalySigma}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  anomalySigma: parseFloat(e.target.value),
                }))
              }
              aria-label="Anomaly Z-score threshold"
              className="w-full sci-range"
            />
          </div>

          <div>
            <label
              htmlFor="year-scope"
              className="block text-xs text-slate-600 mb-1.5"
            >
              Year Filter Slice
            </label>
            <select
              id="year-scope"
              value={config.yearFilter === 'all' ? 'all' : String(config.yearFilter)}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  yearFilter: e.target.value === 'all' ? 'all' : Number(e.target.value),
                }))
              }
              className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600 cursor-pointer"
            >
              <option value="all">
                All Years ({analysis.availableYears[0]}–
                {analysis.availableYears[analysis.availableYears.length - 1]})
              </option>
              {analysis.availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Year {yr} Only
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Bottom Sidebar Export & Reset Actions */}
      <div className="pt-6 mt-6 border-t border-slate-200 space-y-2">
        <button
          type="button"
          onClick={handleExportCleanedCsv}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" /> Export Cleaned CSV
        </button>
        <button
          type="button"
          onClick={() => setConfig(DEFAULT_CONFIG)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset Parameters
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingCsv(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingCsv(false);
      }}
      onDrop={handleDrop}
    >
      {/* Hidden CSV Upload Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-5 lg:px-6 h-14 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('trends');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          ClimaNum
        </a>

        {/* Zone 2: 4 clean single-line text navigation links */}
        <nav
          aria-label="Analysis views"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'border-blue-700 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> Load CSV
          </button>
        </div>
      </header>

      {/* Mobile Navigation Strip (visible below md only) */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Asymmetric Split Console */}
      <div className="flex-1 flex min-h-0 max-w-[1600px] w-full mx-auto">
        {/* Desktop Left Parameter & Cleaning Sidebar */}
        <aside className="hidden lg:block w-[308px] shrink-0 bg-[#F1F5F9]/75 border-r border-slate-200 p-5 overflow-y-auto">
          {sidebarContent}
        </aside>

        {/* Mobile Parameter Drawer */}
        {mobileControlsOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/40"
              onClick={() => setMobileControlsOpen(false)}
            />
            <div className="relative z-50 w-[308px] max-w-[85vw] bg-[#F8FAFC] h-full p-5 overflow-y-auto border-r border-slate-200">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
                <span className="text-sm font-semibold text-slate-900">
                  Pipeline Parameters
                </span>
                <button
                  type="button"
                  onClick={() => setMobileControlsOpen(false)}
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                  aria-label="Close parameters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {sidebarContent}
            </div>
          </div>
        )}

        {/* Right Primary Analytical Viewport */}
        <main className="flex-1 min-w-0 p-5 lg:p-6 space-y-6">
          {/* Drag-and-drop indicator */}
          {isDraggingCsv && (
            <div className="border-2 border-dashed border-blue-600 bg-blue-50/70 rounded-lg p-6 text-center text-sm font-medium text-blue-900">
              Drop a historical weather CSV file to load it into the NumPy analysis pipeline
            </div>
          )}

          {/* Upload error notice */}
          {uploadError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 text-xs text-red-800"
            >
              <span>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="text-red-700 hover:text-red-900 font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Workspace Station Header (Zero-Pill Unboxed Metadata) */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {activeDataset.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-mono tabular-nums">
                <span className="font-sans text-slate-600">{activeDataset.location}</span>
                <span aria-hidden="true">·</span>
                <span>{activeDataset.coordinates}</span>
                <span aria-hidden="true">·</span>
                <span>{dateSpanLabel}</span>
                <span aria-hidden="true">·</span>
                <span>
                  ndarray ({analysis.rowCount}, 6) float64
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileControlsOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md self-start whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Parameters
            </button>
          </div>

          {/* 4-Column Quantitative KPI Strip (Single Elevation, Hairline Dividers) */}
          <section
            aria-label="Key climate metrics"
            className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
          >
            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Mean Temperature</div>
              <div className="mt-1.5 flex items-baseline">
                <span className="text-2xl font-mono font-semibold text-slate-900 tabular-nums">
                  {analysis.summaryKPIs.meanTemp.toFixed(2)}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5">°C</span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                σ = {analysis.summaryKPIs.tempStd.toFixed(2)} °C · P95 ={' '}
                {analysis.summaryKPIs.p95Temp.toFixed(1)} °C
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Linear Trend (np.polyfit)
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span
                  className={`text-2xl font-mono font-semibold tabular-nums ${
                    analysis.trendSlopePerYear >= 0 ? 'text-amber-700' : 'text-blue-700'
                  }`}
                >
                  {analysis.trendSlopePerYear >= 0 ? '+' : ''}
                  {analysis.trendSlopePerYear.toFixed(3)}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5">°C / yr</span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                R² = {analysis.trendR2.toFixed(3)} · {config.rollingWindow}d convolution
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">Annual Rainfall</div>
              <div className="mt-1.5 flex items-baseline">
                <span className="text-2xl font-mono font-semibold text-slate-900 tabular-nums">
                  {analysis.summaryKPIs.annualAvgRainfall.toFixed(0)}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5">mm / yr</span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                Peak: {analysis.summaryKPIs.wettestMonthLabel} (
                {analysis.summaryKPIs.wettestMonthMm.toFixed(0)} mm)
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs font-medium text-slate-500">
                Cleaned Cells &amp; Anomalies
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span className="text-2xl font-mono font-semibold text-teal-700 tabular-nums">
                  {analysis.summaryKPIs.totalNaNsCleaned}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5">NaNs fixed</span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                {analysis.summaryKPIs.totalOutliersClipped} clipped ·{' '}
                {analysis.summaryKPIs.anomalyCount} anomalies (≥{config.anomalySigma.toFixed(1)}σ)
              </div>
            </div>
          </section>

          {/* Active Analytical Workspace View */}
          {activeTab === 'trends' && <TrendCharts analysis={analysis} config={config} />}
          {activeTab === 'rainfall' && <RainfallCharts analysis={analysis} />}
          {activeTab === 'cleaning' && <CleaningAndMatrixView analysis={analysis} />}
          {activeTab === 'code' && (
            <NumPyCodeLab dataset={activeDataset} config={config} analysis={analysis} />
          )}
        </main>
      </div>
    </div>
  );
}
