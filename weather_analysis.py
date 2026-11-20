"""
ClimaNum — Weather Data Analysis System (Pure NumPy Vectorized Pipeline)

Usage:
    python weather_analysis.py
    python weather_analysis.py data/openmeteo_london_2021_2025.csv
    python weather_analysis.py data/vega_seattle_weather.csv --window 30 --sigma 2.2 --save-plot report.png
"""
import argparse
import re
import sys
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns


def load_weather_csv(path: str):
    """Load historical weather CSV into NumPy float64 arrays with header auto-detection.
    Supports Open-Meteo metadata preambles, Vega/NOAA schemas, and standard CSVs.
    """
    with open(path, "r", encoding="utf-8") as f:
        raw_lines = [line.strip() for line in f]

    def norm(col: str) -> str:
        return re.sub(r"[^a-z0-9]", "", re.sub(r"\(.*?\)", "", col.lower()))

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

    if not cols:
        raise ValueError(f"Could not detect date and temperature columns in {path}")

    c_date = find_col(cols, ["date", "timestamp", "datetime", "day", "time"])
    c_tmean = find_col(
        cols,
        ["temperature2mmean", "tempmeanc", "tempmean", "tavg", "meantemp", "temperature", "temp"],
        ("max", "min", "high", "low"),
    )
    c_tmax = find_col(cols, ["temperature2mmax", "tempmaxc", "tempmax", "tmax", "maxtemp", "high"])
    c_tmin = find_col(cols, ["temperature2mmin", "tempminc", "tempmin", "tmin", "mintemp", "low"])
    c_rain = find_col(
        cols,
        ["precipitationsum", "rainsum", "rainfallmm", "rainfall", "precipitation", "precip", "prcp", "rain"],
    )
    c_humid = find_col(cols, ["relativehumidity2mmean", "humiditypct", "humidity", "rh"])
    c_wind = find_col(cols, ["windspeed10mmax", "windspeed10mmean", "windspeedkmh", "windspeed", "wind", "awnd"])

    raw_dates = np.genfromtxt(path, delimiter=",", skip_header=header_idx + 1, usecols=c_date, dtype="U10")

    def read_col(col_idx: int, default_val: float) -> np.ndarray:
        if col_idx == -1:
            return np.full(len(raw_dates), default_val, dtype=np.float64)
        return np.genfromtxt(path, delimiter=",", skip_header=header_idx + 1, usecols=col_idx, dtype=np.float64)

    tmax = read_col(c_tmax, np.nan)
    tmin = read_col(c_tmin, np.nan)
    tmean = read_col(c_tmean, np.nan) if c_tmean != -1 else (tmax + tmin) / 2.0
    if c_tmax == -1:
        tmax = tmean + 3.5
    if c_tmin == -1:
        tmin = tmean - 3.5
    rain = read_col(c_rain, 0.0)
    humid = read_col(c_humid, 60.0)
    wind = read_col(c_wind, 12.0)

    order = np.argsort(raw_dates)
    matrix = np.column_stack([tmean, tmax, tmin, rain, humid, wind])[order]
    return raw_dates[order], matrix


def clip_robust_outliers(arr: np.ndarray, sigma: float = 3.0, lo_cap=None, hi_cap=None) -> np.ndarray:
    """Clip extreme sensor spikes using IQR-scaled robust sigma."""
    q25, med, q75 = np.nanpercentile(arr, [25, 50, 75])
    robust_std = max((q75 - q25) / 1.349, 1e-6)
    lo = med - sigma * robust_std
    hi = med + sigma * robust_std
    if lo_cap is not None:
        lo = max(lo, lo_cap)
    if hi_cap is not None:
        hi = min(hi, hi_cap)
    return np.clip(arr, lo, hi)


def impute_linear(arr: np.ndarray) -> np.ndarray:
    """Vectorized linear interpolation for missing NaN values via np.interp."""
    valid = ~np.isnan(arr)
    if not np.any(valid):
        return np.zeros_like(arr)
    idx = np.arange(len(arr))
    return np.interp(idx, idx[valid], arr[valid])


def longest_true_run(mask: np.ndarray, dates: np.ndarray):
    """Vectorized run-length encoding via np.diff to locate the longest consecutive True streak."""
    padded = np.concatenate(([0], mask.astype(np.int8), [0]))
    edges = np.diff(padded)
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    if len(starts) == 0:
        return 0, "—", "—"
    lengths = ends - starts
    best = int(np.argmax(lengths))
    return int(lengths[best]), str(dates[starts[best]]), str(dates[ends[best] - 1])


def analyze_weather(csv_path: str, window: int = 30, anomaly_sigma: float = 2.2, clip: bool = True, save_plot: str = ""):
    dates, data = load_weather_csv(csv_path)
    raw_temp, raw_tmax, raw_tmin, raw_rain, raw_humid, raw_wind = data.T

    total_nans = int(np.isnan(data).sum())
    print(f"Dataset: {csv_path}")
    print(f"Array shape: {data.shape} (float64) | Date range: {dates[0]} -> {dates[-1]} | Raw NaNs: {total_nans}")

    # Clean outliers and impute missing values
    if clip:
        raw_temp = clip_robust_outliers(raw_temp)
        raw_tmax = clip_robust_outliers(raw_tmax)
        raw_tmin = clip_robust_outliers(raw_tmin)
        raw_humid = clip_robust_outliers(raw_humid, lo_cap=0.0, hi_cap=100.0)
        raw_wind = clip_robust_outliers(raw_wind, lo_cap=0.0)

    temp_mean = impute_linear(raw_temp)
    temp_max = impute_linear(raw_tmax)
    temp_min = impute_linear(raw_tmin)
    humidity = impute_linear(raw_humid)
    wind = impute_linear(raw_wind)
    rainfall = np.nan_to_num(raw_rain, nan=0.0)

    # Moving average via discrete convolution
    kernel = np.ones(window, dtype=np.float64) / window
    rolling_temp = np.convolve(temp_mean, kernel, mode="same")

    # Ordinary least squares linear trend
    t_days = np.arange(len(temp_mean), dtype=np.float64)
    slope_per_day, intercept = np.polyfit(t_days, temp_mean, 1)
    trend_line = slope_per_day * t_days + intercept
    ss_res = np.sum((temp_mean - trend_line) ** 2)
    ss_tot = np.sum((temp_mean - np.mean(temp_mean)) ** 2)
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-12 else 0.0

    # Vectorized Z-score anomalies
    z_temp = (temp_mean - np.mean(temp_mean)) / max(np.std(temp_mean), 1e-9)
    anomaly_idx = np.flatnonzero(np.abs(z_temp) >= anomaly_sigma)

    # Dry spell & heatwave run-length encoding
    p95_temp = float(np.percentile(temp_mean, 95))
    dry_days, dry_start, dry_end = longest_true_run(rainfall < 0.2, dates)
    heat_days, heat_start, heat_end = longest_true_run(temp_mean >= p95_temp, dates)

    # Correlation matrix
    clean_matrix = np.vstack([temp_mean, temp_max, temp_min, rainfall, humidity, wind])
    corr_matrix = np.nan_to_num(np.corrcoef(clean_matrix), nan=0.0)

    annual_rain = float(np.sum(rainfall) / max(len(rainfall) / 365.25, 0.1))

    print(f"Mean Temp:          {np.mean(temp_mean):.2f} °C (std={np.std(temp_mean):.2f} °C, P95={p95_temp:.1f} °C)")
    print(f"Linear Trend:       {slope_per_day * 365.25:+.3f} °C/year (R²={r2:.4f})")
    print(f"Annual Rainfall:    {annual_rain:.1f} mm/year")
    print(f"Anomalies (|z|>={anomaly_sigma:.1f}): {len(anomaly_idx)} days")
    print(f"Longest Dry Spell:  {dry_days} days ({dry_start} -> {dry_end})")
    print(f"Longest Heatwave:   {heat_days} days ({heat_start} -> {heat_end}, >= {p95_temp:.1f} °C)")

    # Plot summary charts
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    axes[0].plot(t_days, temp_mean, alpha=0.35, lw=0.8, color="#64748B", label="Daily Mean °C")
    axes[0].plot(t_days, rolling_temp, lw=2.0, color="#1D4ED8", label=f"{window}d Moving Avg")
    axes[0].plot(t_days, trend_line, "--", lw=1.6, color="#DC2626", label=f"Trend ({slope_per_day * 365.25:+.2f} °C/yr)")
    axes[0].scatter(anomaly_idx, temp_mean[anomaly_idx], s=16, color="#D97706", zorder=5, label=f"Anomalies (|z|>={anomaly_sigma:.1f})")
    axes[0].set_title(f"Temperature Trend — {csv_path}")
    axes[0].set_xlabel("Observation Day Index")
    axes[0].set_ylabel("Temperature (°C)")
    axes[0].legend()

    labels = ["T_mean", "T_max", "T_min", "Rain", "Humid", "Wind"]
    sns.heatmap(
        corr_matrix,
        annot=True,
        fmt=".2f",
        cmap="coolwarm",
        vmin=-1,
        vmax=1,
        xticklabels=labels,
        yticklabels=labels,
        ax=axes[1],
    )
    axes[1].set_title("Pearson Correlation Matrix (np.corrcoef)")
    plt.tight_layout()

    if save_plot:
        plt.savefig(save_plot, dpi=150)
        print(f"Saved plot to {save_plot}")
    else:
        plt.show()


def main():
    parser = argparse.ArgumentParser(description="Weather Data Analysis System (NumPy Mastery)")
    parser.add_argument(
        "csv_path",
        nargs="?",
        default="data/openmeteo_london_2021_2025.csv",
        help="Path to historical weather CSV file",
    )
    parser.add_argument("--window", type=int, default=30, help="Rolling average convolution window in days")
    parser.add_argument("--sigma", type=float, default=2.2, help="Z-score anomaly threshold")
    parser.add_argument("--no-clip", action="store_true", help="Disable IQR robust outlier clipping")
    parser.add_argument("--save-plot", type=str, default="", help="Save chart image path instead of interactive window")
    args = parser.parse_args()

    try:
        analyze_weather(
            csv_path=args.csv_path,
            window=args.window,
            anomaly_sigma=args.sigma,
            clip=not args.no_clip,
            save_plot=args.save_plot,
        )
    except FileNotFoundError:
        print(f"Error: CSV file not found at '{args.csv_path}'", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
