import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { generateNumPyPythonScript } from '../engine/numpyWeatherEngine';
import { AnalysisResult, PipelineConfig, WeatherDataset } from '../types/weather';

interface NumPyCodeLabProps {
  dataset: WeatherDataset;
  config: PipelineConfig;
  analysis: AnalysisResult;
}

export const NumPyCodeLab: React.FC<NumPyCodeLabProps> = ({
  dataset,
  config,
  analysis,
}) => {
  const [copied, setCopied] = useState(false);

  const pythonScript = useMemo(
    () => generateNumPyPythonScript(dataset, config, analysis),
    [dataset, config, analysis]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pythonScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback textarea copy
      const el = document.createElement('textarea');
      el.value = pythonScript;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

const REQUIREMENTS_TXT = `# Weather Data Analysis System — Python Dependencies
# Install with: pip install -r requirements.txt

numpy>=1.26.0,<3.0.0
matplotlib>=3.8.0,<4.0.0
seaborn>=0.13.0,<1.0.0
pandas>=2.1.0,<3.0.0
`;

  const handleDownloadPy = () => {
    const blob = new Blob([pythonScript], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset.id}_numpy_analysis.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadRequirements = () => {
    const blob = new Blob([REQUIREMENTS_TXT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'requirements.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const operations = [
    {
      step: '01',
      concept: 'Structured Ingestion & Sorting',
      primitive: 'np.genfromtxt + np.argsort',
      liveResult: `shape=(${analysis.rowCount}, 6), dtype=float64`,
      why: 'Loads tabular weather CSV directly into contiguous float64 memory buffers and enforces chronological ordering.',
    },
    {
      step: '02',
      concept: 'Robust Outlier Clipping',
      primitive: 'np.nanpercentile + np.clip',
      liveResult: config.clipOutliers
        ? `${analysis.summaryKPIs.totalOutliersClipped} spikes clipped at ±${config.outlierSigma.toFixed(1)}σ IQR`
        : 'Clipping disabled',
      why: 'Uses IQR-scaled robust sigma instead of raw mean/std so corrupted sensor spikes do not skew thresholds.',
    },
    {
      step: '03',
      concept: 'Vectorized NaN Imputation',
      primitive:
        config.tempImputeMethod === 'interp'
          ? 'np.interp(~np.isnan)'
          : config.tempImputeMethod === 'nanmean'
          ? 'np.where(np.isnan, np.nanmean)'
          : config.tempImputeMethod === 'nanmedian'
          ? 'np.nanmedian(arr[month == m])'
          : 'np.maximum.accumulate (ffill)',
      liveResult: `${analysis.summaryKPIs.totalNaNsCleaned} NaN cells repaired`,
      why: 'Restores time continuity without Python loops; continuous temperatures use interpolation/medians while rainfall respects dry gaps.',
    },
    {
      step: '04',
      concept: 'Discrete Moving Average',
      primitive: `np.convolve(temp, np.ones(${config.rollingWindow})/${config.rollingWindow})`,
      liveResult: `${config.rollingWindow}-day rolling mean active`,
      why: 'Separates multi-week synoptic weather waves from daily noise in O(N) vectorized C speed.',
    },
    {
      step: '05',
      concept: 'Ordinary Least Squares Trend',
      primitive: 'np.polyfit(t_days, temp_mean, 1)',
      liveResult: `${analysis.trendSlopePerYear >= 0 ? '+' : ''}${analysis.trendSlopePerYear.toFixed(3)} °C/year`,
      why: 'Fits a degree-1 linear regression across the entire daily index to quantify warming or cooling drift.',
    },
    {
      step: '06',
      concept: 'Boolean Run-Length & Correlation',
      primitive: 'np.diff(edges) + np.corrcoef',
      liveResult: `Max dry spell ${analysis.streaks[0]?.days ?? 0}d · T/H r = ${analysis.correlationMatrix[0][4].toFixed(2)}`,
      why: 'Computes exact consecutive dry/heatwave streaks without iteration and evaluates pairwise meteorological correlations.',
    },
  ];

  const scriptLines = pythonScript.split('\n');

  return (
    <div className="space-y-6">
      {/* Vectorized NumPy Operations Reference */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="pb-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            NumPy Vectorized Architecture Breakdown
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every visualization and metric in this workspace maps 1-to-1 to these loop-free NumPy operations.
          </p>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-mono text-slate-500">
                <th className="py-2 pr-3 font-medium">Stage</th>
                <th className="py-2 px-3 font-medium">NumPy Primitive</th>
                <th className="py-2 px-3 font-medium">Live Output</th>
                <th className="py-2 pl-3 font-medium">Engineering Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {operations.map((op) => (
                <tr key={op.step} className="align-top hover:bg-slate-50">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className="font-mono text-slate-400 mr-2">{op.step}.</span>
                    <span className="font-medium text-slate-900">{op.concept}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-blue-700 whitespace-nowrap">
                    {op.primitive}
                  </td>
                  <td className="py-3 px-3 font-mono tabular-nums text-slate-900 whitespace-nowrap">
                    {op.liveResult}
                  </td>
                  <td className="py-3 pl-3 text-slate-600 leading-relaxed max-w-md">
                    {op.why}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dynamic Synchronized Python Script Studio */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Synchronized Python + NumPy Script
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {dataset.id}_numpy_analysis.py · Automatically updated from your active sidebar parameters
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Script
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadRequirements}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> requirements.txt
            </button>
            <button
              type="button"
              onClick={handleDownloadPy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Download .py
            </button>
          </div>
        </div>

        <div className="bg-[#0F172A] text-slate-100 p-5 overflow-x-auto max-h-[540px] overflow-y-auto">
          <pre className="font-mono text-xs leading-relaxed tabular-nums">
            {scriptLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-9 pr-4 text-right select-none text-slate-500 shrink-0">
                  {i + 1}
                </span>
                <span className="whitespace-pre text-slate-100">{line || ' '}</span>
              </div>
            ))}
          </pre>
        </div>
      </section>
    </div>
  );
};
