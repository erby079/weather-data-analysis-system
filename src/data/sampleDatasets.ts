import { RawWeatherRecord, WeatherDataset } from '../types/weather';

// Deterministic Mulberry32 PRNG so sample stations are reproducible
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rng: () => number): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

interface StationClimateProfile {
  id: string;
  name: string;
  location: string;
  coordinates: string;
  elevation: string;
  filename: string;
  seed: number;
  baseTemp: number;
  seasonalAmp: number;
  diurnalRange: number;
  warmingPerYear: number;
  rainBaseProb: number;
  rainPhaseShiftRad: number; // peak rain season
  rainIntensity: number;
  baseHumidity: number;
  baseWind: number;
  heatwaveMonth: number;
  stormMonth: number;
}

const STATION_PROFILES: StationClimateProfile[] = [
  {
    id: 'seattle',
    name: 'Seattle Maritime Station',
    location: 'Seattle, WA (USW00024233)',
    coordinates: '47.4502° N, 122.3088° W',
    elevation: '122 m',
    filename: 'seattle_weather_2021_2025.csv',
    seed: 202401,
    baseTemp: 11.4,
    seasonalAmp: 8.6,
    diurnalRange: 7.4,
    warmingPerYear: 0.24,
    rainBaseProb: 0.41,
    rainPhaseShiftRad: Math.PI * 0.92, // Peak Nov–Jan
    rainIntensity: 7.6,
    baseHumidity: 74,
    baseWind: 13.5,
    heatwaveMonth: 7,
    stormMonth: 11,
  },
  {
    id: 'phoenix',
    name: 'Phoenix Sonoran Station',
    location: 'Phoenix, AZ (USW00023183)',
    coordinates: '33.4342° N, 112.0116° W',
    elevation: '337 m',
    filename: 'phoenix_weather_2021_2025.csv',
    seed: 202402,
    baseTemp: 24.2,
    seasonalAmp: 12.1,
    diurnalRange: 12.8,
    warmingPerYear: 0.36,
    rainBaseProb: 0.08,
    rainPhaseShiftRad: -Math.PI * 0.28, // Late summer monsoon
    rainIntensity: 9.2,
    baseHumidity: 31,
    baseWind: 10.4,
    heatwaveMonth: 7,
    stormMonth: 8,
  },
  {
    id: 'tokyo',
    name: 'Tokyo Bay Observatory',
    location: 'Tokyo, JP (JMA-47662)',
    coordinates: '35.6916° N, 139.7501° E',
    elevation: '25 m',
    filename: 'tokyo_weather_2021_2025.csv',
    seed: 202403,
    baseTemp: 16.3,
    seasonalAmp: 11.4,
    diurnalRange: 7.8,
    warmingPerYear: 0.29,
    rainBaseProb: 0.31,
    rainPhaseShiftRad: -Math.PI * 0.35, // June tsuyu + Sept typhoons
    rainIntensity: 13.8,
    baseHumidity: 67,
    baseWind: 14.2,
    heatwaveMonth: 8,
    stormMonth: 9,
  },
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function generateStationRecords(profile: StationClimateProfile): RawWeatherRecord[] {
  const rng = createRng(profile.seed);
  const records: RawWeatherRecord[] = [];
  const startDate = new Date(Date.UTC(2021, 0, 1));
  const endDate = new Date(Date.UTC(2025, 11, 31));

  let weatherMemory = 0; // AR(1) persistence for realistic synoptic systems
  let dayIdx = 0;

  for (
    let cur = new Date(startDate.getTime());
    cur <= endDate;
    cur = new Date(cur.getTime() + 86400000)
  ) {
    const year = cur.getUTCFullYear();
    const month = cur.getUTCMonth() + 1;
    const day = cur.getUTCDate();
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;

    const dayOfYear = Math.floor(
      (cur.getTime() - Date.UTC(year, 0, 1)) / 86400000
    );
    const angle = (2 * Math.PI * (dayOfYear - 20)) / 365.25;
    const yearsElapsed = dayIdx / 365.25;

    // Synoptic persistence (AR1)
    weatherMemory = 0.68 * weatherMemory + 0.72 * gaussianNoise(rng);

    const seasonalTemp = -Math.cos(angle) * profile.seasonalAmp;
    let tempMean =
      profile.baseTemp +
      seasonalTemp +
      profile.warmingPerYear * yearsElapsed +
      weatherMemory * 2.1;

    // Inject realistic multi-day heatwave or cold-snap episodes
    if (year === 2023 && month === profile.heatwaveMonth && day >= 14 && day <= 18) {
      tempMean += 7.8 + rng() * 2.1;
    }
    if (year === 2024 && month === 1 && day >= 11 && day <= 14) {
      tempMean -= 7.4 + rng() * 1.8;
    }

    const halfSpread = Math.max(
      1.8,
      profile.diurnalRange * 0.5 + gaussianNoise(rng) * 1.2
    );
    let tempMax = tempMean + halfSpread;
    let tempMin = tempMean - halfSpread;

    // Precipitation model with seasonal probability & gamma-like heavy tail
    const seasonalRainFactor =
      0.5 + 0.5 * Math.cos(angle - profile.rainPhaseShiftRad);
    let rainProb = Math.min(
      0.78,
      Math.max(0.02, profile.rainBaseProb * (0.45 + 1.15 * seasonalRainFactor))
    );
    // Dry summer suppression for maritime climate
    if (profile.id === 'seattle' && (month === 7 || month === 8)) {
      rainProb *= 0.32;
    }
    if (profile.id === 'phoenix' && (month === 4 || month === 5 || month === 6)) {
      rainProb *= 0.18;
    }

    let rainfall = 0;
    if (rng() < rainProb) {
      // Exponential squared tail for realistic heavy storm days
      const expDraw = -Math.log(Math.max(1e-6, rng()));
      rainfall = expDraw * profile.rainIntensity * (0.55 + 0.8 * seasonalRainFactor);
      if (month === profile.stormMonth && rng() < 0.08) {
        rainfall += 32 + rng() * 44; // Extreme storm event
      }
      // Rain cools daytime highs slightly
      tempMax -= Math.min(3.5, rainfall * 0.08);
    }

    // Humidity inversely correlated with temperature, positively with rainfall
    let humidity =
      profile.baseHumidity -
      seasonalTemp * 0.85 +
      (rainfall > 0.5 ? 12 + Math.min(14, rainfall * 0.35) : -3.5) +
      gaussianNoise(rng) * 6.5;
    humidity = Math.min(99, Math.max(8, humidity));

    // Wind speed
    let windSpeed =
      profile.baseWind +
      (rainfall > 5 ? 5.2 : 0) +
      Math.abs(gaussianNoise(rng) * 4.8);
    windSpeed = Math.max(1.2, windSpeed);

    // Round clean measurements to 1 decimal place
    tempMean = Math.round(tempMean * 10) / 10;
    tempMax = Math.round(Math.max(tempMax, tempMean + 0.6) * 10) / 10;
    tempMin = Math.round(Math.min(tempMin, tempMean - 0.6) * 10) / 10;
    rainfall = Math.round(rainfall * 10) / 10;
    humidity = Math.round(humidity * 10) / 10;
    windSpeed = Math.round(windSpeed * 10) / 10;

    // Inject realistic telemetry imperfections:
    // 1) 4-day sensor outage gap in 2022 and 3-day outage in 2024
    const isOutage =
      (year === 2022 && month === 5 && day >= 10 && day <= 13) ||
      (year === 2024 && month === 10 && day >= 3 && day <= 5);

    if (isOutage) {
      tempMean = Number.NaN;
      tempMax = Number.NaN;
      tempMin = Number.NaN;
      humidity = Number.NaN;
    } else {
      // 2) Scattered missing values (~2.4% temp, ~3.0% rain, ~2.0% humidity, ~1.8% wind)
      if (rng() < 0.024) tempMean = Number.NaN;
      if (rng() < 0.018) tempMax = Number.NaN;
      if (rng() < 0.018) tempMin = Number.NaN;
      if (rng() < 0.03) rainfall = Number.NaN;
      if (rng() < 0.02) humidity = Number.NaN;
      if (rng() < 0.018) windSpeed = Number.NaN;
    }

    // 3) Inject 5 distinct sensor glitch outliers across the 5-year record
    if (
      dayIdx === 187 ||
      dayIdx === 612 ||
      dayIdx === 1044 ||
      dayIdx === 1419
    ) {
      tempMean = dayIdx % 2 === 0 ? 74.8 : -39.5;
    }
    if (dayIdx === 845) {
      windSpeed = 148.6;
    }
    if (dayIdx === 1210) {
      humidity = 164.0;
    }

    records.push({
      date: dateStr,
      year,
      month,
      day,
      tempMean,
      tempMax,
      tempMin,
      rainfall,
      humidity,
      windSpeed,
    });

    dayIdx++;
  }

  return records;
}

export const SAMPLE_DATASETS: WeatherDataset[] = STATION_PROFILES.map((p) => ({
  id: p.id,
  name: p.name,
  location: p.location,
  coordinates: p.coordinates,
  elevation: p.elevation,
  filename: p.filename,
  records: generateStationRecords(p),
}));

export function serializeRecordsToCSV(
  dates: string[],
  arrays: {
    tempMean: Float64Array | number[];
    tempMax: Float64Array | number[];
    tempMin: Float64Array | number[];
    rainfall: Float64Array | number[];
    humidity: Float64Array | number[];
    windSpeed: Float64Array | number[];
  }
): string {
  const header = 'date,temp_mean_c,temp_max_c,temp_min_c,rainfall_mm,humidity_pct,wind_speed_kmh';
  const lines = [header];
  const fmt = (v: number) => (Number.isNaN(v) ? '' : v.toFixed(1));

  for (let i = 0; i < dates.length; i++) {
    lines.push(
      [
        dates[i],
        fmt(arrays.tempMean[i]),
        fmt(arrays.tempMax[i]),
        fmt(arrays.tempMin[i]),
        fmt(arrays.rainfall[i]),
        fmt(arrays.humidity[i]),
        fmt(arrays.windSpeed[i]),
      ].join(',')
    );
  }
  return lines.join('\n');
}

export function serializeDatasetRawCSV(dataset: WeatherDataset): string {
  const header = 'date,temp_mean_c,temp_max_c,temp_min_c,rainfall_mm,humidity_pct,wind_speed_kmh';
  const fmt = (v: number) => (Number.isNaN(v) ? '' : v.toFixed(1));
  const lines = [header];
  for (const r of dataset.records) {
    lines.push(
      [
        r.date,
        fmt(r.tempMean),
        fmt(r.tempMax),
        fmt(r.tempMin),
        fmt(r.rainfall),
        fmt(r.humidity),
        fmt(r.windSpeed),
      ].join(',')
    );
  }
  return lines.join('\n');
}
