import {
  AnalysisResult,
  AnomalyEvent,
  ColumnAudit,
  MonthlySummary,
  PipelineConfig,
  RainImputeMethod,
  RawWeatherRecord,
  SeasonalBoxStat,
  StreakRecord,
  TempImputeMethod,
  WeatherDataset,
  WeatherFieldKey,
  YearMonthCell,
} from '../types/weather';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const FIELD_META: Record<
  WeatherFieldKey,
  { label: string; shortLabel: string; unit: string; csvCol: string }
> = {
  tempMean: { label: 'Mean Temperature', shortLabel: 'T_mean', unit: '°C', csvCol: 'temp_mean_c' },
  tempMax: { label: 'Max Temperature', shortLabel: 'T_max', unit: '°C', csvCol: 'temp_max_c' },
  tempMin: { label: 'Min Temperature', shortLabel: 'T_min', unit: '°C', csvCol: 'temp_min_c' },
  rainfall: { label: 'Rainfall', shortLabel: 'Rain', unit: 'mm', csvCol: 'rainfall_mm' },
  humidity: { label: 'Relative Humidity', shortLabel: 'Humid', unit: '%', csvCol: 'humidity_pct' },
  windSpeed: { label: 'Wind Speed', shortLabel: 'Wind', unit: 'km/h', csvCol: 'wind_speed_kmh' },
};

const ALL_FIELDS: WeatherFieldKey[] = [
  'tempMean',
  'tempMax',
  'tempMin',
  'rainfall',
  'humidity',
  'windSpeed',
];

// ============================================================================
// Core NumPy-Equivalent TypedArray Primitives
// ============================================================================

export function npNanMean(arr: Float64Array): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isNaN(v)) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : Number.NaN;
}

export function npNanStd(arr: Float64Array, mean?: number): number {
  const m = mean !== undefined ? mean : npNanMean(arr);
  if (Number.isNaN(m)) return Number.NaN;
  let sqSum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isNaN(v)) {
      const diff = v - m;
      sqSum += diff * diff;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sqSum / count) : 0;
}

export function npNanSortedValid(arr: Float64Array): Float64Array {
  const valid: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isNaN(arr[i])) valid.push(arr[i]);
  }
  const out = Float64Array.from(valid);
  out.sort();
  return out;
}

export function npNanPercentile(arr: Float64Array, q: number): number {
  const sorted = npNanSortedValid(arr);
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function npNanMedian(arr: Float64Array): number {
  return npNanPercentile(arr, 50);
}

export function npNanMinMax(arr: Float64Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isNaN(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: Number.NaN, max: Number.NaN };
  return { min, max };
}

/**
 * Exact equivalent of:
 *   valid = ~np.isnan(arr)
 *   cleaned = np.interp(np.arange(len(arr)), np.flatnonzero(valid), arr[valid])
 */
export function npInterpNaNs(arr: Float64Array): Float64Array {
  const n = arr.length;
  const out = new Float64Array(arr);
  const xp: number[] = [];
  const fp: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(arr[i])) {
      xp.push(i);
      fp.push(arr[i]);
    }
  }

  if (xp.length === 0) {
    out.fill(0);
    return out;
  }

  let seg = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(arr[i])) continue;
    if (i <= xp[0]) {
      out[i] = fp[0];
    } else if (i >= xp[xp.length - 1]) {
      out[i] = fp[fp.length - 1];
    } else {
      while (seg + 1 < xp.length && xp[seg + 1] < i) {
        seg++;
      }
      const x0 = xp[seg];
      const x1 = xp[seg + 1];
      const y0 = fp[seg];
      const y1 = fp[seg + 1];
      const t = (i - x0) / (x1 - x0);
      out[i] = y0 + t * (y1 - y0);
    }
  }
  return out;
}

/**
 * Equivalent of np.convolve(arr, np.ones(window)/window, mode='same')
 * with boundary-normalized edge window so edge values remain physically accurate.
 */
export function npConvolveMovingAverage(arr: Float64Array, window: number): Float64Array {
  const n = arr.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const w = Math.max(1, Math.min(window, n));
  const halfLeft = Math.floor((w - 1) / 2);
  const halfRight = w - 1 - halfLeft;

  // Prefix sums for O(n) exact window mean
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + arr[i];
  }

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfLeft);
    const end = Math.min(n - 1, i + halfRight);
    out[i] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
  }
  return out;
}

/**
 * Exact equivalent of np.polyfit(x, y, 1) (degree-1 OLS linear regression)
 */
export function npPolyfitLinear(y: Float64Array): {
  slopePerDay: number;
  slopePerYear: number;
  intercept: number;
  r2: number;
  fitted: Float64Array;
} {
  const n = y.length;
  const fitted = new Float64Array(n);
  if (n < 2) {
    if (n === 1) fitted[0] = y[0];
    return { slopePerDay: 0, slopePerYear: 0, intercept: y[0] ?? 0, r2: 0, fitted };
  }

  const xMean = (n - 1) / 2;
  const yMean = npNanMean(y);

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = y[i] - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const slopePerDay = sxx > 0 ? sxy / sxx : 0;
  const intercept = yMean - slopePerDay * xMean;

  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slopePerDay * i + intercept;
    fitted[i] = pred;
    const err = y[i] - pred;
    ssRes += err * err;
  }

  const r2 = syy > 1e-12 ? Math.max(0, 1 - ssRes / syy) : 0;
  return {
    slopePerDay,
    slopePerYear: slopePerDay * 365.25,
    intercept,
    r2,
    fitted,
  };
}

/**
 * Exact equivalent of np.corrcoef(matrix) across all 6 weather variables
 */
export function npCorrcoef(arrays: Float64Array[]): number[][] {
  const k = arrays.length;
  const means = arrays.map((a) => npNanMean(a));
  const stds = arrays.map((a, idx) => npNanStd(a, means[idx]));
  const n = arrays[0]?.length ?? 0;

  const matrix: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < k; j++) {
      let cov = 0;
      const ai = arrays[i];
      const aj = arrays[j];
      const mi = means[i];
      const mj = means[j];
      for (let t = 0; t < n; t++) {
        cov += (ai[t] - mi) * (aj[t] - mj);
      }
      cov /= Math.max(1, n);
      const denom = stds[i] * stds[j];
      const r = denom > 1e-12 ? Math.max(-1, Math.min(1, cov / denom)) : 0;
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return matrix;
}

// ============================================================================
// CSV Parser (Flexible Column Detection)
// ============================================================================

function parseNumericCell(raw: string | undefined): number {
  if (!raw) return Number.NaN;
  const trimmed = raw.trim().toLowerCase();
  if (
    trimmed === '' ||
    trimmed === 'na' ||
    trimmed === 'nan' ||
    trimmed === 'null' ||
    trimmed === 'none' ||
    trimmed === '-' ||
    trimmed === '-999' ||
    trimmed === '-9999'
  ) {
    return Number.NaN;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : Number.NaN;
}

function findColumnIndex(
  headers: string[],
  candidates: string[],
  excludeSubstrings: string[] = []
): number {
  const normalized = headers.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/\(.*?\)/g, '') // strip units like (°C), (mm), (%)
      .replace(/[^a-z0-9]/g, '')
  );
  const isExcluded = (h: string) =>
    excludeSubstrings.some((ex) => h.includes(ex));

  for (const cand of candidates) {
    const exact = normalized.findIndex((h) => h === cand && !isExcluded(h));
    if (exact !== -1) return exact;
  }
  for (const cand of candidates) {
    const partial = normalized.findIndex(
      (h) => h.includes(cand) && !isExcluded(h)
    );
    if (partial !== -1) return partial;
  }
  return -1;
}

function parseDateParts(raw: string): { date: string; year: number; month: number; day: number } | null {
  const clean = raw.trim().replace(/^["']|["']$/g, '');
  // Try YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const mm = m < 10 ? `0${m}` : `${m}`;
      const dd = d < 10 ? `0${d}` : `${d}`;
      return { date: `${y}-${mm}-${dd}`, year: y, month: m, day: d };
    }
  }
  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const mm = m < 10 ? `0${m}` : `${m}`;
    const dd = d < 10 ? `0${d}` : `${d}`;
    return { date: `${y}-${mm}-${dd}`, year: y, month: m, day: d };
  }
  return null;
}

export function parseWeatherCSV(csvText: string, filename: string): WeatherDataset {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 3) {
    throw new Error('CSV must include a header row and at least 2 data rows.');
  }

  // Scan first 10 lines to find the actual table header row (supports Open-Meteo metadata preambles)
  let headerLineIdx = 0;
  let headers: string[] = [];
  let dateCol = -1;
  let tempMeanCol = -1;
  let tempMaxCol = -1;
  let tempMinCol = -1;
  let rainCol = -1;
  let humidCol = -1;
  let windCol = -1;

  const maxScan = Math.min(10, lines.length - 1);
  for (let idx = 0; idx < maxScan; idx++) {
    const cols = lines[idx].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
    const dCol = findColumnIndex(cols, ['date', 'timestamp', 'datetime', 'day', 'time']);
    const tMean = findColumnIndex(
      cols,
      ['temperature2mmean', 'tempmeanc', 'tempmean', 'tavg', 'meantemp', 'temperature', 'tempc', 'temp'],
      ['max', 'min', 'high', 'low']
    );
    const tMax = findColumnIndex(cols, [
      'temperature2mmax',
      'tempmaxc',
      'tempmax',
      'tmax',
      'maxtemp',
      'high',
    ]);
    const tMin = findColumnIndex(cols, [
      'temperature2mmin',
      'tempminc',
      'tempmin',
      'tmin',
      'mintemp',
      'low',
    ]);

    if (dCol !== -1 && (tMean !== -1 || tMax !== -1 || tMin !== -1)) {
      headerLineIdx = idx;
      headers = cols;
      dateCol = dCol;
      tempMeanCol = tMean;
      tempMaxCol = tMax;
      tempMinCol = tMin;
      rainCol = findColumnIndex(cols, [
        'precipitationsum',
        'rainsum',
        'rainfallmm',
        'rainfall',
        'precipmm',
        'precipitation',
        'precip',
        'prcp',
        'rain',
      ]);
      humidCol = findColumnIndex(cols, [
        'relativehumidity2mmean',
        'humiditypct',
        'humidity',
        'relhumidity',
        'rh',
      ]);
      windCol = findColumnIndex(cols, [
        'windspeed10mmax',
        'windspeed10mmean',
        'windspeedkmh',
        'windspeed',
        'wind',
        'awnd',
        'wspd',
      ]);
      break;
    }
  }

  if (dateCol === -1) {
    throw new Error('Could not detect a Date column (expected e.g. "date", "time", or "timestamp").');
  }
  if (tempMeanCol === -1 && tempMaxCol === -1 && tempMinCol === -1) {
    throw new Error(
      'Could not detect a Temperature column (expected e.g. "temp_mean_c", "temperature_2m_mean", "temp_max", or "tavg").'
    );
  }

  const records: RawWeatherRecord[] = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const dt = parseDateParts(cells[dateCol] ?? '');
    if (!dt) continue;

    const tMax = tempMaxCol !== -1 ? parseNumericCell(cells[tempMaxCol]) : Number.NaN;
    const tMin = tempMinCol !== -1 ? parseNumericCell(cells[tempMinCol]) : Number.NaN;
    let tMean = tempMeanCol !== -1 ? parseNumericCell(cells[tempMeanCol]) : Number.NaN;

    if (Number.isNaN(tMean) && tempMeanCol === -1 && !Number.isNaN(tMax) && !Number.isNaN(tMin)) {
      tMean = (tMax + tMin) / 2;
    }

    records.push({
      date: dt.date,
      year: dt.year,
      month: dt.month,
      day: dt.day,
      tempMean: tMean,
      tempMax: tempMaxCol !== -1 ? tMax : Number.isNaN(tMean) ? Number.NaN : tMean + 3.5,
      tempMin: tempMinCol !== -1 ? tMin : Number.isNaN(tMean) ? Number.NaN : tMean - 3.5,
      rainfall: rainCol !== -1 ? parseNumericCell(cells[rainCol]) : 0,
      humidity: humidCol !== -1 ? parseNumericCell(cells[humidCol]) : 60,
      windSpeed: windCol !== -1 ? parseNumericCell(cells[windCol]) : 12,
    });
  }

  if (records.length < 2) {
    throw new Error('No valid dated weather records were parsed from this CSV file.');
  }

  // Chronological sort (matching np.argsort(dates))
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const cleanName = filename.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ');
  return {
    id: `uploaded-${Date.now()}`,
    name: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
    location: `Uploaded CSV (${records.length.toLocaleString()} rows · ${headers.length} cols)`,
    coordinates: 'Custom Station',
    elevation: '—',
    filename,
    records,
  };
}

// ============================================================================
// Full Vectorized Weather Analysis Pipeline
// ============================================================================

function imputeArray(
  raw: Float64Array,
  months: number[],
  method: TempImputeMethod | RainImputeMethod
): { cleaned: Float64Array; imputedMask: Uint8Array; opName: string } {
  const n = raw.length;
  const imputedMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(raw[i])) imputedMask[i] = 1;
  }

  if (method === 'interp') {
    return {
      cleaned: npInterpNaNs(raw),
      imputedMask,
      opName: 'np.interp(idx, valid_idx, arr[valid])',
    };
  }

  if (method === 'zero') {
    const out = new Float64Array(raw);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(out[i])) out[i] = 0.0;
    }
    return {
      cleaned: out,
      imputedMask,
      opName: 'np.nan_to_num(arr, nan=0.0)',
    };
  }

  if (method === 'nanmean') {
    const meanVal = npNanMean(raw);
    const fill = Number.isNaN(meanVal) ? 0 : meanVal;
    const out = new Float64Array(raw);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(out[i])) out[i] = fill;
    }
    return {
      cleaned: out,
      imputedMask,
      opName: 'np.where(np.isnan(arr), np.nanmean(arr), arr)',
    };
  }

  if (method === 'nanmedian') {
    // Monthly seasonal median via boolean month masking
    const monthMedians = new Float64Array(13);
    const globalMed = npNanMedian(raw);
    for (let m = 1; m <= 12; m++) {
      const bucket: number[] = [];
      for (let i = 0; i < n; i++) {
        if (months[i] === m && !Number.isNaN(raw[i])) {
          bucket.push(raw[i]);
        }
      }
      monthMedians[m] =
        bucket.length > 0 ? npNanMedian(Float64Array.from(bucket)) : Number.isNaN(globalMed) ? 0 : globalMed;
    }
    const out = new Float64Array(raw);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(out[i])) out[i] = monthMedians[months[i]];
    }
    return {
      cleaned: out,
      imputedMask,
      opName: 'np.nanmedian(arr[month == m])',
    };
  }

  // Forward Fill (ffill with backward fill for leading NaNs)
  const out = new Float64Array(raw);
  let lastValid = Number.NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(out[i])) {
      lastValid = out[i];
    } else if (!Number.isNaN(lastValid)) {
      out[i] = lastValid;
    }
  }
  let nextValid = Number.NaN;
  for (let i = n - 1; i >= 0; i--) {
    if (!Number.isNaN(out[i])) {
      nextValid = out[i];
    } else if (!Number.isNaN(nextValid)) {
      out[i] = nextValid;
    } else {
      out[i] = 0;
    }
  }
  return {
    cleaned: out,
    imputedMask,
    opName: 'arr[np.maximum.accumulate(valid_idx)]',
  };
}

/**
 * Vectorized run-length encoding equivalent of:
 *   padded = np.concatenate(([0], mask.astype(int), [0]))
 *   diffs = np.diff(padded)
 *   starts = np.flatnonzero(diffs == 1)
 *   ends = np.flatnonzero(diffs == -1)
 */
function findLongestStreak(
  mask: Uint8Array,
  dates: string[]
): { days: number; startDate: string; endDate: string } {
  let bestLen = 0;
  let bestStart = 0;
  let curLen = 0;
  let curStart = 0;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }

  if (bestLen === 0) {
    return { days: 0, startDate: '—', endDate: '—' };
  }
  return {
    days: bestLen,
    startDate: dates[bestStart],
    endDate: dates[bestStart + bestLen - 1],
  };
}

export function runNumPyWeatherAnalysis(
  dataset: WeatherDataset,
  config: PipelineConfig
): AnalysisResult {
  const yearSet = new Set<number>();
  for (const r of dataset.records) yearSet.add(r.year);
  const availableYears = Array.from(yearSet).sort((a, b) => a - b);

  const filtered =
    config.yearFilter === 'all'
      ? dataset.records
      : dataset.records.filter((r) => r.year === config.yearFilter);

  const n = filtered.length;
  const dates = new Array<string>(n);
  const years = new Array<number>(n);
  const months = new Array<number>(n);

  const rawArrays: Record<WeatherFieldKey, Float64Array> = {
    tempMean: new Float64Array(n),
    tempMax: new Float64Array(n),
    tempMin: new Float64Array(n),
    rainfall: new Float64Array(n),
    humidity: new Float64Array(n),
    windSpeed: new Float64Array(n),
  };

  for (let i = 0; i < n; i++) {
    const r = filtered[i];
    dates[i] = r.date;
    years[i] = r.year;
    months[i] = r.month;
    rawArrays.tempMean[i] = r.tempMean;
    rawArrays.tempMax[i] = r.tempMax;
    rawArrays.tempMin[i] = r.tempMin;
    rawArrays.rainfall[i] = r.rainfall;
    rawArrays.humidity[i] = r.humidity;
    rawArrays.windSpeed[i] = r.windSpeed;
  }

  const cleanedArrays = {} as Record<WeatherFieldKey, Float64Array>;
  const wasImputed = {} as Record<WeatherFieldKey, Uint8Array>;
  const wasClipped = {} as Record<WeatherFieldKey, Uint8Array>;
  const audits: ColumnAudit[] = [];

  let totalNaNsCleaned = 0;
  let totalOutliersClipped = 0;

  for (const field of ALL_FIELDS) {
    const raw = rawArrays[field];
    const meta = FIELD_META[field];

    let nanCount = 0;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(raw[i])) nanCount++;
    }
    totalNaNsCleaned += nanCount;

    const meanBefore = npNanMean(raw);
    const stdBefore = npNanStd(raw, meanBefore);

    // Step 1: Optional robust outlier detection using MAD/IQR + Sigma bounds
    // Mask extreme sensor glitches before imputation, or clip via np.clip
    const working = new Float64Array(raw);
    const clipMask = new Uint8Array(n);
    let outliersClipped = 0;

    if (config.clipOutliers && field !== 'rainfall') {
      // Robust bounds via median + IQR-derived robust sigma so huge spikes don't corrupt mean/std
      const p25 = npNanPercentile(raw, 25);
      const p75 = npNanPercentile(raw, 75);
      const med = npNanMedian(raw);
      const iqr = Math.max(1e-6, p75 - p25);
      const robustStd = iqr / 1.349;
      let lower = med - config.outlierSigma * robustStd;
      let upper = med + config.outlierSigma * robustStd;

      // Physical sanity caps
      if (field === 'humidity') {
        lower = Math.max(0, lower);
        upper = Math.min(100, upper);
      } else if (field === 'windSpeed') {
        lower = Math.max(0, lower);
      }

      for (let i = 0; i < n; i++) {
        const v = working[i];
        if (!Number.isNaN(v) && (v < lower || v > upper)) {
          working[i] = Math.max(lower, Math.min(upper, v));
          clipMask[i] = 1;
          outliersClipped++;
        }
      }
    } else if (config.clipOutliers && field === 'rainfall') {
      // Rainfall cannot be negative; clip negative sensor glitches to 0
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(working[i]) && working[i] < 0) {
          working[i] = 0;
          clipMask[i] = 1;
          outliersClipped++;
        }
      }
    }
    totalOutliersClipped += outliersClipped;

    // Step 2: Impute NaNs using selected NumPy strategy
    const method =
      field === 'rainfall' ? config.rainImputeMethod : config.tempImputeMethod;
    const { cleaned, imputedMask, opName } = imputeArray(working, months, method);

    cleanedArrays[field] = cleaned;
    wasImputed[field] = imputedMask;
    wasClipped[field] = clipMask;

    const meanAfter = npNanMean(cleaned);
    const stdAfter = npNanStd(cleaned, meanAfter);
    const { min: minAfter, max: maxAfter } = npNanMinMax(cleaned);

    audits.push({
      field,
      label: meta.label,
      unit: meta.unit,
      nanCount,
      nanPercent: n > 0 ? (nanCount / n) * 100 : 0,
      outliersClipped,
      meanBefore,
      meanAfter,
      stdBefore,
      stdAfter,
      minAfter,
      maxAfter,
      numpyOp: opName,
    });
  }

  // Step 3: Rolling averages via np.convolve
  const rollingTemp = npConvolveMovingAverage(cleanedArrays.tempMean, config.rollingWindow);
  const rollingRain = npConvolveMovingAverage(cleanedArrays.rainfall, config.rollingWindow);

  // Step 4: Linear regression trend via np.polyfit(t, temp, 1)
  const poly = npPolyfitLinear(cleanedArrays.tempMean);

  // Step 5: Z-score Anomaly Detection (vectorized)
  const tempArr = cleanedArrays.tempMean;
  const rainArr = cleanedArrays.rainfall;
  const tempMean = npNanMean(tempArr);
  const tempStd = npNanStd(tempArr, tempMean);
  const rainMean = npNanMean(rainArr);
  const rainStd = npNanStd(rainArr, rainMean);

  const tempZScores = new Float64Array(n);
  const anomalies: AnomalyEvent[] = [];

  for (let i = 0; i < n; i++) {
    const tz = tempStd > 1e-9 ? (tempArr[i] - tempMean) / tempStd : 0;
    const rz = rainStd > 1e-9 ? (rainArr[i] - rainMean) / rainStd : 0;
    tempZScores[i] = tz;

    if (tz >= config.anomalySigma) {
      anomalies.push({
        index: i,
        date: dates[i],
        tempMean: tempArr[i],
        rainfall: rainArr[i],
        zScore: tz,
        kind: 'Heatwave',
      });
    } else if (tz <= -config.anomalySigma) {
      anomalies.push({
        index: i,
        date: dates[i],
        tempMean: tempArr[i],
        rainfall: rainArr[i],
        zScore: tz,
        kind: 'Cold Snap',
      });
    } else if (rz >= Math.max(2.6, config.anomalySigma + 1.0) && rainArr[i] >= 15) {
      anomalies.push({
        index: i,
        date: dates[i],
        tempMean: tempArr[i],
        rainfall: rainArr[i],
        zScore: rz,
        kind: 'Extreme Rain',
      });
    }
  }

  // Sort anomalies by descending absolute Z-score
  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  // Step 6: Monthly Climograph Aggregation
  const activeYearCount = Math.max(1, new Set(years).size);
  const monthlySummaries: MonthlySummary[] = [];
  for (let m = 1; m <= 12; m++) {
    let tSum = 0;
    let tMin = Infinity;
    let tMax = -Infinity;
    let rSum = 0;
    let hSum = 0;
    let rainyDays = 0;
    let count = 0;
    const monthYears = new Set<number>();

    for (let i = 0; i < n; i++) {
      if (months[i] === m) {
        const t = tempArr[i];
        const r = rainArr[i];
        tSum += t;
        if (cleanedArrays.tempMin[i] < tMin) tMin = cleanedArrays.tempMin[i];
        if (cleanedArrays.tempMax[i] > tMax) tMax = cleanedArrays.tempMax[i];
        rSum += r;
        hSum += cleanedArrays.humidity[i];
        if (r >= 0.5) rainyDays++;
        count++;
        monthYears.add(years[i]);
      }
    }

    const yrDiv = Math.max(1, monthYears.size);
    monthlySummaries.push({
      monthIndex: m - 1,
      monthLabel: MONTH_LABELS[m - 1],
      meanTemp: count > 0 ? tSum / count : Number.NaN,
      minTemp: count > 0 ? tMin : Number.NaN,
      maxTemp: count > 0 ? tMax : Number.NaN,
      totalRainfallAvgPerYear: rSum / yrDiv,
      meanHumidity: count > 0 ? hSum / count : Number.NaN,
      rainyDaysAvgPerYear: rainyDays / yrDiv,
    });
  }

  // Step 7: Seasonal Boxplot Percentiles via np.percentile
  const seasonDefs: {
    season: SeasonalBoxStat['season'];
    monthsLabel: string;
    mList: number[];
  }[] = [
    { season: 'Winter', monthsLabel: 'Dec · Jan · Feb', mList: [12, 1, 2] },
    { season: 'Spring', monthsLabel: 'Mar · Apr · May', mList: [3, 4, 5] },
    { season: 'Summer', monthsLabel: 'Jun · Jul · Aug', mList: [6, 7, 8] },
    { season: 'Autumn', monthsLabel: 'Sep · Oct · Nov', mList: [9, 10, 11] },
  ];

  const seasonalStats: SeasonalBoxStat[] = seasonDefs.map((def) => {
    const vals: number[] = [];
    let rainTotal = 0;
    for (let i = 0; i < n; i++) {
      if (def.mList.includes(months[i])) {
        vals.push(tempArr[i]);
        rainTotal += rainArr[i];
      }
    }
    const fa = Float64Array.from(vals);
    return {
      season: def.season,
      monthsLabel: def.monthsLabel,
      count: vals.length,
      p05: npNanPercentile(fa, 5),
      p25: npNanPercentile(fa, 25),
      p50: npNanPercentile(fa, 50),
      p75: npNanPercentile(fa, 75),
      p95: npNanPercentile(fa, 95),
      mean: npNanMean(fa),
      totalRainAvg: rainTotal / activeYearCount,
    };
  });

  // Step 8: Year x Month Heatmap Matrix (always across all available years in filtered set)
  const filteredYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const yearMonthGrid: YearMonthCell[] = [];
  for (const yr of filteredYears) {
    for (let m = 1; m <= 12; m++) {
      let tSum = 0;
      let rSum = 0;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        if (years[i] === yr && months[i] === m) {
          tSum += tempArr[i];
          rSum += rainArr[i];
          cnt++;
        }
      }
      yearMonthGrid.push({
        year: yr,
        month: m,
        meanTemp: cnt > 0 ? tSum / cnt : Number.NaN,
        totalRain: rSum,
        days: cnt,
      });
    }
  }

  // Step 9: Pearson Correlation Matrix via np.corrcoef
  const correlationFields = ALL_FIELDS.map((key) => ({
    key,
    shortLabel: FIELD_META[key].shortLabel,
    label: FIELD_META[key].label,
  }));
  const correlationMatrix = npCorrcoef(ALL_FIELDS.map((k) => cleanedArrays[k]));

  // Step 10: Vectorized Boolean Run-Length Streaks
  const p95Temp = npNanPercentile(tempArr, 95);
  const dryMask = new Uint8Array(n);
  const wetMask = new Uint8Array(n);
  const heatMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    dryMask[i] = rainArr[i] < 0.2 ? 1 : 0;
    wetMask[i] = rainArr[i] >= 1.0 ? 1 : 0;
    heatMask[i] = tempArr[i] >= p95Temp ? 1 : 0;
  }

  const dryStreak = findLongestStreak(dryMask, dates);
  const heatStreak = findLongestStreak(heatMask, dates);
  const wetStreak = findLongestStreak(wetMask, dates);

  const streaks: StreakRecord[] = [
    {
      kind: 'Longest Dry Spell',
      days: dryStreak.days,
      startDate: dryStreak.startDate,
      endDate: dryStreak.endDate,
      metricDetail: 'rainfall < 0.2 mm',
    },
    {
      kind: 'Longest Heatwave (>P95)',
      days: heatStreak.days,
      startDate: heatStreak.startDate,
      endDate: heatStreak.endDate,
      metricDetail: `temp ≥ ${p95Temp.toFixed(1)} °C`,
    },
    {
      kind: 'Longest Wet Spell',
      days: wetStreak.days,
      startDate: wetStreak.startDate,
      endDate: wetStreak.endDate,
      metricDetail: 'rainfall ≥ 1.0 mm',
    },
  ];

  // Summary KPIs
  let totalRainAll = 0;
  for (let i = 0; i < n; i++) totalRainAll += rainArr[i];
  const yearsSpanned = Math.max(0.1, n / 365.25);
  const annualAvgRainfall = totalRainAll / yearsSpanned;

  let wettest = monthlySummaries[0];
  for (const ms of monthlySummaries) {
    if (ms.totalRainfallAvgPerYear > (wettest?.totalRainfallAvgPerYear ?? -1)) {
      wettest = ms;
    }
  }

  return {
    dates,
    years,
    months,
    availableYears,
    rowCount: n,
    rawArrays,
    cleanedArrays,
    wasImputed,
    wasClipped,
    audits,
    rollingTemp,
    rollingRain,
    trendLine: poly.fitted,
    trendSlopePerYear: poly.slopePerYear,
    trendIntercept: poly.intercept,
    trendR2: poly.r2,
    tempZScores,
    anomalies,
    monthlySummaries,
    seasonalStats,
    yearMonthGrid,
    correlationMatrix,
    correlationFields,
    streaks,
    summaryKPIs: {
      meanTemp: tempMean,
      tempStd,
      annualAvgRainfall,
      totalNaNsCleaned,
      totalOutliersClipped,
      anomalyCount: anomalies.length,
      p95Temp,
      wettestMonthLabel: wettest?.monthLabel ?? '—',
      wettestMonthMm: wettest?.totalRainfallAvgPerYear ?? 0,
    },
  };
}

// ============================================================================
// Dynamic Runnable Python + NumPy Script Generator
// ============================================================================

export function generateNumPyPythonScript(
  dataset: WeatherDataset,
  config: PipelineConfig,
  analysis: AnalysisResult
): string {
  const tempImputeSnippet =
    config.tempImputeMethod === 'interp'
      ? `    valid = ~np.isnan(arr)
    idx = np.arange(len(arr))
    return np.interp(idx, idx[valid], arr[valid])`
      : config.tempImputeMethod === 'nanmean'
      ? `    return np.where(np.isnan(arr), np.nanmean(arr), arr)`
      : config.tempImputeMethod === 'nanmedian'
      ? `    cleaned = arr.copy()
    for m in range(1, 13):
        mask = (months == m)
        med = np.nanmedian(arr[mask])
        cleaned[mask & np.isnan(cleaned)] = med
    return cleaned`
      : `    idx = np.where(~np.isnan(arr), np.arange(len(arr)), 0)
    np.maximum.accumulate(idx, out=idx)
    return arr[idx]`;

  const rainImputeSnippet =
    config.rainImputeMethod === 'zero'
      ? `rainfall = np.nan_to_num(raw_rain, nan=0.0)`
      : config.rainImputeMethod === 'nanmedian'
      ? `rainfall = raw_rain.copy()
for m in range(1, 13):
    m_mask = (months == m)
    rainfall[m_mask & np.isnan(rainfall)] = np.nanmedian(raw_rain[m_mask])`
      : `valid_r = ~np.isnan(raw_rain)
rainfall = np.interp(np.arange(len(raw_rain)), np.flatnonzero(valid_r), raw_rain[valid_r])`;

  const outlierBlock = config.clipOutliers
    ? `def clip_robust_outliers(arr, sigma=${config.outlierSigma.toFixed(1)}, lo_cap=None, hi_cap=None):
    """Clip sensor spikes via IQR-scaled robust sigma (no mean contamination)."""
    q25, med, q75 = np.nanpercentile(arr, [25, 50, 75])
    robust_std = max((q75 - q25) / 1.349, 1e-6)
    lo = med - sigma * robust_std
    hi = med + sigma * robust_std
    if lo_cap is not None: lo = max(lo, lo_cap)
    if hi_cap is not None: hi = min(hi, hi_cap)
    return np.clip(arr, lo, hi)

raw_temp = clip_robust_outliers(raw_temp)
raw_humid = clip_robust_outliers(raw_humid, lo_cap=0.0, hi_cap=100.0)
raw_wind = clip_robust_outliers(raw_wind, lo_cap=0.0)`
    : `# Outlier clipping disabled in current pipeline configuration`;

  const yearFilterLine =
    config.yearFilter === 'all'
      ? `# Using all available years (${analysis.availableYears[0]}–${analysis.availableYears[analysis.availableYears.length - 1]})`
      : `year_mask = (years == ${config.yearFilter})
dates, years, months = dates[year_mask], years[year_mask], months[year_mask]
data = data[year_mask]`;

  return `"""
Weather Data Analysis System — Pure NumPy Vectorized Pipeline
Dataset: ${dataset.name} (${dataset.filename})
Rows: ${analysis.rowCount} | Active Parameters: window=${config.rollingWindow}d, anomaly=${config.anomalySigma.toFixed(1)}σ
"""
import re
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

CSV_PATH = "${dataset.filename}"

# 1. Load Historical Weather CSV with Header Auto-Detection (handles Open-Meteo, Vega, NOAA)
def load_weather_csv(path):
    with open(path, "r", encoding="utf-8") as f:
        raw_lines = [line.strip() for line in f]

    def norm(col):
        return re.sub(r"[^a-z0-9]", "", re.sub(r"\\(.*?\\)", "", col.lower()))

    def find_col(cols, candidates, excludes=()):
        normed = [norm(c) for c in cols]
        for cand in candidates:
            for idx, h in enumerate(normed):
                if h == cand and not any(ex in h for ex in excludes):
                    return idx
        for cand in candidates:
            for idx, h in enumerate(normed):
                if cand in h and not any(ex in h for ex in excludes):
                    return idx
        return -1

    header_idx, cols = 0, []
    for i, line in enumerate(raw_lines[:15]):
        if not line:
            continue
        parts = [p.strip().strip('"') for p in line.split(",")]
        d_col = find_col(parts, ["date", "timestamp", "datetime", "day", "time"])
        t_col = find_col(parts, ["temperature2mmean", "tempmeanc", "tempmean", "tavg", "tempmax", "tmax"])
        if d_col != -1 and t_col != -1:
            header_idx, cols = i, parts
            break

    c_date = find_col(cols, ["date", "timestamp", "datetime", "day", "time"])
    c_tmean = find_col(cols, ["temperature2mmean", "tempmeanc", "tempmean", "tavg", "meantemp", "temp"], ("max", "min", "high", "low"))
    c_tmax = find_col(cols, ["temperature2mmax", "tempmaxc", "tempmax", "tmax", "maxtemp", "high"])
    c_tmin = find_col(cols, ["temperature2mmin", "tempminc", "tempmin", "tmin", "mintemp", "low"])
    c_rain = find_col(cols, ["precipitationsum", "rainsum", "rainfallmm", "rainfall", "precipitation", "precip", "prcp", "rain"])
    c_humid = find_col(cols, ["relativehumidity2mmean", "humiditypct", "humidity", "rh"])
    c_wind = find_col(cols, ["windspeed10mmax", "windspeedkmh", "windspeed", "wind", "awnd"])

    def read_col(col_idx, default_val):
        if col_idx == -1:
            return np.full(len(raw_dates), default_val, dtype=np.float64)
        return np.genfromtxt(path, delimiter=",", skip_header=header_idx + 1, usecols=col_idx, dtype=np.float64)

    raw_dates = np.genfromtxt(path, delimiter=",", skip_header=header_idx + 1, usecols=c_date, dtype="U10")
    tmax = read_col(c_tmax, np.nan)
    tmin = read_col(c_tmin, np.nan)
    tmean = read_col(c_tmean, np.nan) if c_tmean != -1 else (tmax + tmin) / 2.0
    if c_tmax == -1: tmax = tmean + 3.5
    if c_tmin == -1: tmin = tmean - 3.5
    rain = read_col(c_rain, 0.0)
    humid = read_col(c_humid, 60.0)
    wind = read_col(c_wind, 12.0)

    order = np.argsort(raw_dates)
    matrix = np.column_stack([tmean, tmax, tmin, rain, humid, wind])[order]
    return raw_dates[order], matrix

dates, data = load_weather_csv(CSV_PATH)
years = np.array([int(d[:4]) for d in dates], dtype=np.int32)
months = np.array([int(d[5:7]) for d in dates], dtype=np.int32)
${yearFilterLine}

raw_temp, raw_tmax, raw_tmin, raw_rain, raw_humid, raw_wind = data.T
print(f"Loaded shape={data.shape}, total NaNs={np.isnan(data).sum()}")

# 2. Vectorized Outlier Clipping & Missing-Value Imputation
${outlierBlock}

def impute_continuous(arr, months):
${tempImputeSnippet}

temp_mean = impute_continuous(raw_temp, months)
temp_max  = impute_continuous(raw_tmax, months)
temp_min  = impute_continuous(raw_tmin, months)
humidity  = impute_continuous(raw_humid, months)
wind      = impute_continuous(raw_wind, months)
${rainImputeSnippet}

# 3. Rolling Average via Discrete Convolution (np.convolve)
window = ${config.rollingWindow}
kernel = np.ones(window, dtype=np.float64) / window
rolling_temp = np.convolve(temp_mean, kernel, mode="same")

# 4. Linear Warming/Cooling Trend via OLS (np.polyfit)
t_days = np.arange(len(temp_mean), dtype=np.float64)
slope_per_day, intercept = np.polyfit(t_days, temp_mean, 1)
trend_line = slope_per_day * t_days + intercept
print(f"Linear Trend: {slope_per_day * 365.25:+.3f} °C/year")

# 5. Vectorized Z-Score Anomaly Detection
z_temp = (temp_mean - np.mean(temp_mean)) / np.std(temp_mean)
anomaly_idx = np.flatnonzero(np.abs(z_temp) >= ${config.anomalySigma.toFixed(1)})
print(f"Detected {len(anomaly_idx)} temperature anomalies (|z| >= ${config.anomalySigma.toFixed(1)})")

# 6. Longest Dry Spell via Boolean Run-Length Encoding (np.diff)
dry_mask = (rainfall < 0.2).astype(np.int8)
edges = np.diff(np.concatenate(([0], dry_mask, [0])))
starts = np.flatnonzero(edges == 1)
ends = np.flatnonzero(edges == -1)
longest_dry_days = int((ends - starts).max()) if len(starts) else 0
print(f"Longest Dry Spell: {longest_dry_days} consecutive days")

# 7. Feature Correlation Matrix (np.corrcoef)
clean_matrix = np.vstack([temp_mean, temp_max, temp_min, rainfall, humidity, wind])
corr_matrix = np.nan_to_num(np.corrcoef(clean_matrix), nan=0.0)

# 8. Visualization Suite (Matplotlib & Seaborn)
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
axes[0].plot(t_days, temp_mean, alpha=0.35, lw=0.8, label="Daily Mean °C")
axes[0].plot(t_days, rolling_temp, lw=2.0, color="#1D4ED8", label=f"{window}d Moving Avg")
axes[0].plot(t_days, trend_line, "--", lw=1.6, color="#DC2626", label="Linear Fit")
axes[0].scatter(anomaly_idx, temp_mean[anomaly_idx], s=18, color="#D97706", zorder=5, label="Anomalies")
axes[0].set_title("${dataset.name} — Temperature Trend")
axes[0].set_ylabel("Temperature (°C)")
axes[0].legend()

labels = ["T_mean", "T_max", "T_min", "Rain", "Humid", "Wind"]
sns.heatmap(corr_matrix, annot=True, fmt=".2f", cmap="coolwarm", vmin=-1, vmax=1,
            xticklabels=labels, yticklabels=labels, ax=axes[1])
axes[1].set_title("Pearson Correlation Matrix (np.corrcoef)")
plt.tight_layout()
plt.show()
`;
}
