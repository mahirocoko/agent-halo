# Performance baselines

Agent Halo treats performance claims as local regression evidence, not universal guarantees. Measure on the same machine, with the same deterministic workloads, and compare medians/p95 rather than one run.

## Baseline

Baseline commit: `4a5c0f1` (`feat: ✨ add state-directed sessions and Soft Cube mascot`).

| Surface | Baseline |
| --- | ---: |
| Desktop CSS gzip | 7,579 bytes |
| Desktop JavaScript gzip | 78,838 bytes |
| Desktop `dist/` | 573,055 bytes / 44 files |
| Legacy session-cat runtime | 245,616 bytes / 15 files |
| Production demo ready p50 / p95 | 30.3ms / 41.6ms |
| Post-DOM render-ready p50 / p95 | 9.5ms / 12.1ms |
| Native RSS observation | 37,632 KiB median |
| Live snapshot | 500 events / 271,820 bytes; 0.89ms p50 / 2.97ms p95 |

The browser/native timings above are bounded observations from Mahiro's Mac. They include local WebKit/Chrome state and are not CI budgets.

## Refactor workloads and budgets

`pnpm test:performance` builds the desktop and checks three evidence layers:

1. **Bundle budget** — no regression beyond the baseline CSS/dist sizes, a small JavaScript cushion, and no legacy session-cat files in `dist/`.
2. **Session model** — deterministic 3,200-existing + 500-incoming event merge across 100 conversations, summary derivation, and 1,000-session workspace grouping.
3. **Bridge** — temporary-`HOME` mod startup and 5,000-event publication with bounded startup/throughput and a real temporary NDJSON log.

The initial registry-native refactor measured:

| Operation | Before p95 | After p95 | Change |
| --- | ---: | ---: | ---: |
| Merge 500 events | 4.3ms | 1.4ms | −67.4% |
| Derive summaries | 0.30ms | 0.20ms | −33.3% |
| Group 1,000 sessions | 2.1ms | 0.9ms | −57.1% |

The `pomodoro-custom-v1` budget revision intentionally raises the primary bundle ceilings to 8,300 bytes CSS gzip and 89,000 bytes JavaScript gzip. The feature adds a persisted deadline/settings state machine, compact timer and custom-settings UI, collapsed-notch countdown, and native-notification orchestration; its final measured candidate build is 8,153 bytes CSS gzip and 87,262 bytes JavaScript gzip. The total `dist/` ceiling remains unchanged at 573,055 bytes, and legacy session-cat assets remain forbidden. This is an explicit product-feature allowance rather than an unreviewed regression.

The `runtime-monitor-v2` revision keeps those ceilings at 8,750 bytes CSS gzip and 91,000 bytes JavaScript gzip while adding automatic ended-identity cleanup, bounded recent-target selection, stale-sample guards, and accessible hidden-row feedback. Its measured candidate is 8,719 bytes CSS gzip and 90,846 bytes JavaScript gzip. The compact read-only Runtime tab still includes PID-aware event plumbing, pressure classification, native polling state, and browser-demo evidence; native `libproc` code remains outside the web bundle. The total `dist/` ceiling remains 573,055 bytes and legacy session-cat assets remain forbidden.

The `focus-stability-v1` revision keeps the CSS ceiling at 8,750 bytes and raises JavaScript gzip to 92,000 bytes for serialized native panel resize/focus intent, passive-hover focus protection, and status/Pomodoro focus-regression coverage. Its measured candidate is 8,719 bytes CSS gzip and 90,975 bytes JavaScript gzip. The total `dist/` and legacy-asset constraints remain unchanged.

The `runtime-palette-v1` revision raises CSS gzip to 8,900 bytes while keeping JavaScript at 92,000 bytes. It adds a semantic Runtime pressure hierarchy—green Normal, hollow amber Elevated, solid amber High, red Critical, and hollow dashed neutral Unavailable—plus inner-left alignment for the Pomodoro phase wing. Its measured candidate is 8,793 bytes CSS gzip and 90,984 bytes JavaScript gzip. The total `dist/` and legacy-asset constraints remain unchanged.

The `completion-pet-v1` revision raises CSS gzip to 9,300 bytes and JavaScript gzip to 95,000 bytes for the separate projection-only Pet surface, radial action menu, preference migration/toggle, and delayed notification-fallback orchestration. Its measured candidate is 9,234 bytes CSS gzip and 93,282 bytes JavaScript gzip. The main renderer remains the sole Pomodoro owner; the Pet route does not mount bridge/session/timer ownership. The total `dist/` and legacy-asset constraints remain unchanged.

The `completion-pet-controls-v2` revision raises CSS gzip to 10,500 bytes and JavaScript gzip to 97,000 bytes for the user-approved transparent 2× Pet, orbit-centered liquid squash/stretch reveal motion, pure-black borderless/shadowless smaller radial controls with larger icons, native-resize position compensation, three-section Setup sidebar, persisted floating-size controls, stateful Show-again/Update-Pet preview UX, and distinct Restart/Reset-progress Pomodoro controls. Its measured candidate is 10,235 bytes CSS gzip and 95,152 bytes JavaScript gzip. The main renderer still exclusively owns Pomodoro state and notification work; preview remains projection-only and cannot queue a break. The total `dist/` and legacy-asset constraints remain unchanged.

The low-risk bridge refactor's three-run median measured event duration `603.06ms → 574.18ms` (−4.79%) and throughput `33,164 → 34,832 events/s` (+5.03%) for 20,000 deterministic events. Startup stayed effectively flat; synchronous NDJSON durability and event ordering remain unchanged.

## Commands

```bash
pnpm benchmark:sessions
pnpm benchmark:bridge
pnpm test:performance

# Explicit bridge comparison against a Git ref
node scripts/benchmark-bridge.mjs --ref=HEAD --events=20000
```

Higher-risk work such as asynchronous/buffered NDJSON writes, log rotation, and replacing localStorage with a different persistence engine requires a separate durability/retention decision. Do not trade away event order or crash/reload recovery for a synthetic throughput win.
