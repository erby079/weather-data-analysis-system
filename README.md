# ClimaNum — Weather Data Analysis System (NumPy Mastery)

An end-to-end **Weather Data Analysis System** designed around vectorized **NumPy** operations for historical climate CSV ingestion, missing-value cleaning, outlier clipping, pattern analysis, and interactive trend visualization.

Includes both:
1. **Interactive Web Analysis Workbench** (React + TypeScript `Float64Array` engine mirroring NumPy primitives in real time + interactive SVG scientific visualizations).
2. **Standalone Python + NumPy Pipeline** (`weather_analysis.py` + `requirements.txt`) runnable directly on historical weather CSV datasets, plus live synchronized `.py` script generation inside the web app.

---

## Key Features

- **Flexible Historical CSV Ingestion**
  - Upload or drag-and-drop any historical weather CSV — automatically detects header rows (including Open-Meteo metadata preambles), strips unit annotations like `(°C)` / `(mm)`, and derives mean temperature from `(temp_max + temp_min) / 2` when absent.
  - Ships with three built-in 5-year daily station profiles (Seattle, Phoenix, Tokyo) with realistic sensor outages (`NaN`) and glitch spikes, plus two real downloaded internet datasets in `data/`.
- **Vectorized Missing-Value Cleaning & Outlier Clipping**
  - Continuous arrays (temperature, humidity, wind): `np.interp` (time-linear interpolation), `np.nanmedian` (monthly seasonal median), `np.nanmean` (global mean), or forward-fill (`np.maximum.accumulate`).
  - Rainfall array: `np.nan_to_num(nan=0.0)`, monthly median, or linear interpolation.
  - Robust IQR-scaled outlier clipping (`np.nanpercentile` + `np.clip`) with adjustable `±2.0σ`–`±4.0σ` bounds and full before-vs-after `μ`/`σ` audit.
- **Climate Pattern & Trend Analysis**
  - **Moving Averages (`np.convolve`)**: Configurable `7d`, `14d`, `30d`, and `60d` discrete convolution kernels.
  - **Linear Warming/Cooling Fit (`np.polyfit`)**: Ordinary least squares trend slope (`°C/year`) and $R^2$.
  - **Z-Score Anomaly Detection**: Vectorized `(x - μ) / σ` flagging heatwaves, cold snaps, and extreme rainfall storms.
  - **Seasonal Distributions (`np.percentile`)**: 5th / 25th / 50th / 75th / 95th percentile box-and-whisker comparisons across Winter, Spring, Summer, and Autumn.
  - **Extreme Streaks (`np.diff`)**: Vectorized boolean run-length encoding for longest dry spells, wet spells, and heatwaves (`> P95`).
  - **Feature Correlation Matrix (`np.corrcoef`)**: Annotated 6×6 Pearson correlation heatmap across temperature, rainfall, humidity, and wind.
- **Live Export**
  - Export cleaned CSV datasets, raw sample CSVs, `requirements.txt`, and dynamically parameterized Python scripts directly from the interface.

---

## Project Structure

```text
.
├── data/
│   ├── openmeteo_london_2021_2025.csv   # Real 5-year daily archive (1,826 rows, Open-Meteo)
│   └── vega_seattle_weather.csv         # Real 4-year daily archive (1,461 rows, NOAA/Vega)
├── src/
│   ├── components/
│   │   ├── TrendCharts.tsx              # Time-series crosshair chart, heatmap & anomaly ledger
│   │   ├── RainfallCharts.tsx           # Dual-axis climograph, seasonal boxplots & streaks
│   │   ├── CleaningAndMatrixView.tsx    # Audit table, np.corrcoef heatmap & array inspector
│   │   └── NumPyCodeLab.tsx             # NumPy operation breakdown & live .py / requirements export
│   ├── data/
│   │   └── sampleDatasets.ts            # Deterministic multi-year stations + CSV serializers
│   ├── engine/
│   │   └── numpyWeatherEngine.ts        # Vectorized Float64Array NumPy engine + Python generator
│   ├── types/
│   │   └── weather.ts                   # TypeScript interfaces
│   └── App.tsx                          # Asymmetric split-console workspace
├── weather_analysis.py                  # Standalone Python + NumPy CLI analysis & plotting script
├── requirements.txt                     # Python dependencies (numpy, matplotlib, seaborn, pandas)
├── package.json                         # Web app dependencies & scripts
└── README.md
```

---

## Running the Python + NumPy Pipeline

### Prerequisites
- Python 3.9+

### Install Dependencies & Run
```bash
pip install -r requirements.txt

# Analyze Open-Meteo London 2021–2025 dataset (default)
python weather_analysis.py data/openmeteo_london_2021_2025.csv

# Analyze NOAA/Vega Seattle 2012–2015 dataset and save chart to PNG
python weather_analysis.py data/vega_seattle_weather.csv --window 30 --sigma 2.2 --save-plot seattle_report.png
```

---

## Running the Interactive Web Workbench

### Prerequisites
- Node.js 18+

### Install & Start
```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. Click **Load CSV** (or drag and drop any CSV from `data/` or your computer) to analyze it interactively.

---

## Verified Benchmark Results (Included Internet Datasets)

| Dataset | Rows | Mean Temp | Linear Trend (`np.polyfit`) | Annual Rainfall | Longest Dry Spell |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Open-Meteo London (2021–2025)** | 1,826 | 11.70 °C | +0.509 °C/yr | 746.9 mm/yr | 23 days (`2023-05-20` → `2023-06-11`) |
| **Vega / NOAA Seattle (2012–2015)** | 1,461 | 12.34 °C | +0.821 °C/yr | 1,106.5 mm/yr | 48 days (`2012-07-23` → `2012-09-08`) |

---

## Tech Stack

- **Python / Data Science:** NumPy, Matplotlib, Seaborn, Pandas (optional tabular extension)
- **Web Workbench:** React 19, TypeScript, Tailwind CSS v4, Vite, Lucide Icons
