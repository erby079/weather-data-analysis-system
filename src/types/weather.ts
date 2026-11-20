export type TempImputeMethod = 'interp' | 'nanmean' | 'nanmedian' | 'ffill';
export type RainImputeMethod = 'zero' | 'nanmedian' | 'interp';

export type WeatherFieldKey =
  | 'tempMean'
  | 'tempMax'
  | 'tempMin'
  | 'rainfall'
  | 'humidity'
  | 'windSpeed';

export interface RawWeatherRecord {
  date: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  tempMean: number; // may be NaN
  tempMax: number;
  tempMin: number;
  rainfall: number;
  humidity: number;
  windSpeed: number;
}

export interface WeatherDataset {
  id: string;
  name: string;
  location: string;
  coordinates: string;
  elevation: string;
  filename: string;
  records: RawWeatherRecord[];
}

export interface PipelineConfig {
  tempImputeMethod: TempImputeMethod;
  rainImputeMethod: RainImputeMethod;
  clipOutliers: boolean;
  outlierSigma: number; // 2.0 - 4.0
  rollingWindow: number; // 7, 14, 30, 60
  anomalySigma: number; // 1.5 - 3.0
  yearFilter: 'all' | number;
}

export interface ColumnAudit {
  field: WeatherFieldKey;
  label: string;
  unit: string;
  nanCount: number;
  nanPercent: number;
  outliersClipped: number;
  meanBefore: number;
  meanAfter: number;
  stdBefore: number;
  stdAfter: number;
  minAfter: number;
  maxAfter: number;
  numpyOp: string;
}

export interface AnomalyEvent {
  index: number;
  date: string;
  tempMean: number;
  rainfall: number;
  zScore: number;
  kind: 'Heatwave' | 'Cold Snap' | 'Extreme Rain';
}

export interface MonthlySummary {
  monthIndex: number; // 0-11
  monthLabel: string;
  meanTemp: number;
  minTemp: number;
  maxTemp: number;
  totalRainfallAvgPerYear: number;
  meanHumidity: number;
  rainyDaysAvgPerYear: number;
}

export interface SeasonalBoxStat {
  season: 'Winter' | 'Spring' | 'Summer' | 'Autumn';
  monthsLabel: string;
  count: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  totalRainAvg: number;
}

export interface YearMonthCell {
  year: number;
  month: number; // 1-12
  meanTemp: number; // NaN if no data
  totalRain: number;
  days: number;
}

export interface StreakRecord {
  kind: 'Longest Dry Spell' | 'Longest Heatwave (>P95)' | 'Longest Wet Spell';
  days: number;
  startDate: string;
  endDate: string;
  metricDetail: string;
}

export interface AnalysisResult {
  dates: string[];
  years: number[];
  months: number[];
  availableYears: number[];
  rowCount: number;
  rawArrays: Record<WeatherFieldKey, Float64Array>;
  cleanedArrays: Record<WeatherFieldKey, Float64Array>;
  wasImputed: Record<WeatherFieldKey, Uint8Array>;
  wasClipped: Record<WeatherFieldKey, Uint8Array>;
  audits: ColumnAudit[];
  rollingTemp: Float64Array;
  rollingRain: Float64Array;
  trendLine: Float64Array;
  trendSlopePerYear: number;
  trendIntercept: number;
  trendR2: number;
  tempZScores: Float64Array;
  anomalies: AnomalyEvent[];
  monthlySummaries: MonthlySummary[];
  seasonalStats: SeasonalBoxStat[];
  yearMonthGrid: YearMonthCell[];
  correlationMatrix: number[][];
  correlationFields: { key: WeatherFieldKey; shortLabel: string; label: string }[];
  streaks: StreakRecord[];
  summaryKPIs: {
    meanTemp: number;
    tempStd: number;
    annualAvgRainfall: number;
    totalNaNsCleaned: number;
    totalOutliersClipped: number;
    anomalyCount: number;
    p95Temp: number;
    wettestMonthLabel: string;
    wettestMonthMm: number;
  };
}
