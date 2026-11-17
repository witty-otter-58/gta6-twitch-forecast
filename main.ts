// gta6-twitch-ccu-forecast-01: forecast GTA VI's launch-day Twitch viewers, hour by hour.
//
// Idea: across the 38 comparable past launches in the kit, launch-day viewers do not stay
// flat at the hour-1 print — they follow a systematic UTC shape. They dip in the early UTC
// hours (before most of the world has unlocked) and climb into the evening as the unlock
// rolls through timezones into US prime time. The shape depends on whether hour 1 is already
// elevated above the category's pre-launch baseline:
//
//   r = p1 / baseline48h, baseline = median hourly viewers in the 48 h before day_start.
//   r >= 3  -> the day is already live: use the ELEVATED curve.
//   r <  3  -> hour 1 is still pre-unlock trickle: use the FLAT curve (wider spread,
//              because the day may explode at unlock).
//
// For each hour h = 2..24 and each level tau, the forecast is
//
//   q_tau(h) = p1 * exp(med[h] + z_tau * sig[h]),
//
// where med/sig are the median log-ratio and IQR-based log-spread of that hour's viewers
// relative to hour 1, measured over the big past launches, and z_tau is the standard normal
// quantile at the level. Quantiles are rounded to 2 decimals, forced non-decreasing and
// clamped to (0, 1e9]. The program is deterministic: same case, same bytes.
//
// Runs offline on Node 22, standard library only. Reads every <id>.in in the input
// directory (MAKEFUN_INPUT_DIR or /input) and writes <id>.out to the output directory
// (MAKEFUN_OUTPUT_DIR or /output):
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Hours 2..24, the ones this program forecasts. */
const HOURS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
/** How far above the pre-launch baseline hour 1 must sit to count as already live. */
const ELEVATED_RATIO = 3;
/** The pre-launch baseline window, in hours before day_start. */
const BASELINE_HOURS = 48;
/** A quantile is never printed below this, and never above this. */
const Q_MIN = 0.01;
const Q_MAX = 1e9;

/**
 * Median log-ratio of each hour's viewers to hour 1, and its log-spread, over the 19 big
 * launches whose hour 1 was already elevated (r >= 3). One entry per hour, hours 2..24.
 */
const ELEVATED_MED = [
  -0.142, -0.325, -0.354, -0.219, -0.019, -0.111, -0.075, -0.126, -0.164, -0.123,
  -0.033, 0.057, 0.166, 0.282, 0.334, 0.466, 0.448, 0.579, 0.705, 0.806, 0.768,
  0.656, 0.471,
];
const ELEVATED_SIG = [
  0.15, 0.257, 0.32, 0.307, 0.416, 0.469, 0.579, 0.66, 0.661, 0.71, 0.74, 0.819,
  0.843, 0.858, 0.829, 0.75, 0.699, 0.718, 0.681, 0.543, 0.653, 0.678, 0.571,
];

/**
 * Same, over the 12 big launches whose hour 1 was still pre-unlock trickle (r < 3).
 * The spread is wider: a flat hour 1 leaves the unlock's size genuinely uncertain.
 */
const FLAT_MED = [
  -0.076, -0.28, -0.307, -0.485, -0.418, -0.471, -0.393, -0.418, -0.409, -0.337,
  -0.17, -0.096, -0.024, 0.106, 0.175, 0.284, 0.387, 0.491, 0.37, 0.34, 0.401,
  0.438, 0.14,
];
const FLAT_SIG = [
  0.184, 0.207, 0.37, 0.48, 0.47, 0.576, 0.333, 0.493, 0.509, 0.535, 0.496,
  0.539, 0.578, 0.627, 0.65, 0.428, 0.385, 0.844, 1.03, 1.073, 1.046, 0.95, 0.702,
];

interface KnownRow {
  hour: number;
  viewers: number;
}

interface HistoryPoint {
  at?: string;
  from?: string;
  viewers: number;
}

interface Case {
  levels: number[];
  day_start: string;
  known: KnownRow[];
  forecast: Array<{ hour: number }>;
  history?: HistoryPoint[] | null;
  history_hourly?: HistoryPoint[] | null;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The median of a list of numbers; NaN when the list is empty. */
const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The category's pre-launch baseline: the median hourly viewers in the 48 h before
 * day_start. Prefers the whole-hour means; falls back to the raw history points when
 * there is no whole-hour mean in the window. Returns NaN when there is no history at
 * all in the window, which the caller treats as "already elevated".
 */
const baseline48h = (c: Case): number => {
  const start = Date.parse(c.day_start);
  const windowStart = start - BASELINE_HOURS * 3_600_000;
  const inWindow = (t: string): boolean => {
    const ms = Date.parse(t);
    return ms >= windowStart && ms < start;
  };
  const hourly = (c.history_hourly ?? [])
    .filter((p) => p.from !== undefined && inWindow(p.from))
    .map((p) => p.viewers);
  if (hourly.length > 0) return median(hourly);
  const raw = (c.history ?? [])
    .filter((p) => p.at !== undefined && inWindow(p.at))
    .map((p) => p.viewers);
  return median(raw);
};

/** One hour's five quantiles, from the hour-1 print and the chosen curve. */
const hourQuantiles = (p1: number, hourIndex: number, med: number[], sig: number[]): number[] => {
  const qs = Z.map((z) => round2(p1 * Math.exp(med[hourIndex] + z * sig[hourIndex])));
  // Rounding is monotone, but clamp and re-enforce the order so the row is valid
  // whatever the inputs do.
  let prev = -Infinity;
  return qs.map((q) => {
    const clamped = Math.min(Q_MAX, Math.max(Q_MIN, q));
    const v = Math.max(prev, clamped);
    prev = v;
    return v;
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);

  const baseline = baseline48h(c);
  const elevated = Number.isNaN(baseline) || baseline < 1 || p1 / baseline >= ELEVATED_RATIO;
  const med = elevated ? ELEVATED_MED : FLAT_MED;
  const sig = elevated ? ELEVATED_SIG : FLAT_SIG;

  const hours = c.forecast
    .map(({ hour }) => {
      const i = HOURS.indexOf(hour);
      if (i < 0) throw new Error(`${file} asks to forecast hour ${hour}, not 2..24`);
      return { hour, q: hourQuantiles(p1, i, med, sig) };
    })
    .sort((a, b) => a.hour - b.hour);
  if (hours.length !== HOURS.length) throw new Error(`${file} forecasts ${hours.length} hours, not 23`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
