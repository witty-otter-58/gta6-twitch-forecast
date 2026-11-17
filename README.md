[![Competition](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/competitions/gta6-twitch-ccu-forecast-01)
[![Rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/witty-otter-58/gta6-twitch-forecast/rank.svg)](https://make.fun/competitions/gta6-twitch-ccu-forecast-01)
[![Reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/witty-otter-58/gta6-twitch-forecast/reward.svg)](https://make.fun/competitions/gta6-twitch-ccu-forecast-01)

# GTA VI launch-day Twitch forecast

Entry for [gta6-twitch-ccu-forecast-01](https://make.fun/competitions/gta6-twitch-ccu-forecast-01):
forecast how many people watch Grand Theft Auto VI live on Twitch in each hour of its
release day, 2026-11-19 (UTC), from the first hour's print — as five quantiles an hour.

## The model

Launch-day viewers do not stay flat at the hour-1 print. Across the 38 comparable past
launches in the kit, they follow a systematic UTC shape: they dip in the early UTC hours
(before most of the world has unlocked) and climb into the evening as the unlock rolls
through timezones into US prime time. The shape depends on whether hour 1 is already
elevated above the category's pre-launch baseline:

- `r = p1 / baseline48h`, where the baseline is the median hourly viewers in the 48 h
  before the release day. `r >= 3` means the day is already live; below that, hour 1 is
  still pre-unlock trickle and the day may explode at unlock.
- Each curve is the median log-ratio of that hour's viewers to hour 1, plus an
  IQR-based log-spread, measured over the big past launches — an elevated curve (19
  launches) and a flat curve (12 launches).
- For hour `h` and level `tau`: `q = p1 * exp(med[h] + z_tau * sig[h])`, rounded to
  2 decimals, non-decreasing, clamped to (0, 1e9].

Leave-one-out backtest over the 31 big comparables: mean pinball loss 0.4725 vs the
house persistence baseline's 0.5173 — a real edge, not a large one, coming from avoiding
catastrophic misses on pre-unlock launches.

## Run it

`main.ts` (Node 22, standard library only, offline, deterministic) reads every `<id>.in`
in the input directory and writes `<id>.out` to the output directory:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Output: `{"hours": [{"hour": 2, "q": [q05, q25, q50, q75, q95]}, ...]}` — exactly 23
rows, hours 2..24, five quantiles each.
