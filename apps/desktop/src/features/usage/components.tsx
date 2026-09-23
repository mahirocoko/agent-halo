import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ExternalLink, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { BoardScroll, BoardSurface } from "../../components/board-surface";
import { SurfaceControl } from "../../components/surface-control";
import { SurfaceStatus } from "../../components/surface-status";
import { createAgentUsageState } from "./adapters";
import {
  DEFAULT_USAGE_CARD_REGISTRY,
  normalizeUsageRatios,
  readUsageLayoutRatios,
  readUsageVisibleProviders,
  resetUsageLayoutRatios,
  writeUsageLayoutRatios,
  writeUsageVisibleProviders,
} from "./model";
import { USAGE_METRIC_GROUPS, USAGE_PROVIDERS } from "./providers";
import { formatAbsoluteTime, formatResetLabel } from "./settings";
import type {
  IAgentUsageState,
  IUsageMetric,
  IUsageMetricLine,
  IUsageProviderConfig,
  IUsageSettings,
  UsageProviderId,
  UsageResetMode,
} from "./types";

interface IProviderIconProps {
  provider: IUsageProviderConfig;
  size?: number;
}

interface IProviderIconStyle extends CSSProperties {
  "--provider-icon": string;
}

const ProviderIcon = ({ provider, size = 14 }: IProviderIconProps) => (
  <span
    className="usage-provider-icon"
    aria-hidden="true"
    style={
      {
        "--provider-icon": `url(${provider.iconPath})`,
        width: size,
        height: size,
      } as IProviderIconStyle
    }
  />
);

interface IMeterProps {
  metric: IUsageMetric;
}

const Meter = ({ metric: value }: IMeterProps) => (
  <div
    className="usage-meter"
    data-empty={value.value === null}
    data-level={value.statusLevel}
  >
    <div className="usage-meter-head">
      <span className="usage-meter-label">{value.limitLabel ?? value.label}</span>
      <SurfaceStatus
        className="usage-meter-status"
        tone={value.statusLevel === "ok" ? "success" : value.statusLevel === "unavailable" ? "neutral" : value.statusLevel}
      >
        <span className="usage-status-dot" aria-hidden="true" />
        {value.statusLabel}
      </SurfaceStatus>
    </div>
    <span
      className="usage-meter-track"
      role="progressbar"
      aria-label={`${value.limitLabel ?? value.label}: ${value.statusLabel}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value.value ?? undefined}
    >
      <span
        className="usage-meter-fill"
        aria-hidden="true"
        style={{ width: `${value.value ?? 0}%` }}
      />
    </span>
    <div className="usage-meter-foot">
      <span>{value.remainingLabel ?? "—"}</span>
      {value.resetLabel ? <span>{value.resetLabel}</span> : null}
    </div>
  </div>
);

interface ITrendProps {
  line: IUsageMetricLine | null;
  total: string | null;
}

const Trend = ({ line, total }: ITrendProps) => {
  const points =
    line?.points?.filter(
      (point) => Number.isFinite(point.value) && point.value >= 0,
    ) ?? [];

  if (!points.length) {
    return null;
  }

  const max = Math.max(...points.map((point) => point.value), 1);
  const latest = points.at(-1);
  const highest = points.reduce(
    (current, point) => (point.value > current.value ? point : current),
    points[0],
  );
  const description = [
    total ? `Past 30 days ${total}.` : "Past 30 days.",
    `Latest ${latest?.label}: ${latest?.valueLabel ?? latest?.value}.`,
    `Highest ${highest.label}: ${highest.valueLabel ?? highest.value}.`,
  ].join(" ");

  return (
    <figure className="usage-trend-card">
      <figcaption className="usage-trend-head">
        <span>Past 30 days</span>
        {total ? <strong>{total}</strong> : null}
      </figcaption>
      <div className="usage-trend-bars" aria-label={description} role="img">
        {points.map((point, index) => (
          <span
            className="usage-trend-bar"
            style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }}
            title={`${point.label}: ${point.valueLabel ?? point.value}`}
            key={`${point.label}-${index}`}
          />
        ))}
      </div>
      {line?.note ? <p className="usage-trend-note">{line.note}</p> : null}
    </figure>
  );
};

interface IProviderInsightsProps {
  provider: IUsageProviderConfig;
  usage: IAgentUsageState;
}

const ProviderInsights = ({ provider, usage }: IProviderInsightsProps) => {
  const hasHistory = Boolean(
    usage.today ||
      usage.yesterday ||
      usage.last30Days ||
      usage.usageTrend ||
      usage.modelShares.length ||
      usage.dailyTokenRows.length,
  );

  if (!hasHistory) return null;

  return (
    <section className="usage-local-history" aria-label={`${provider.label} usage history`}>
      <div className="usage-local-history-head">
        <span>{provider.id === "codex" ? "Local history" : "Usage history"}</span>
        {usage.latestTokenLog ? <small>Latest {usage.latestTokenLog}</small> : null}
      </div>
      {usage.today || usage.yesterday ? (
        <dl className="usage-history-pair">
          {usage.today ? (
            <div>
              <dt>Today</dt>
              <dd>{usage.today}</dd>
            </div>
          ) : null}
          {usage.yesterday ? (
            <div>
              <dt>Yesterday</dt>
              <dd>{usage.yesterday}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <Trend line={usage.usageTrend} total={usage.last30Days} />
      {usage.modelShares.length ? (
        <div className="usage-model-shares">
          <span className="usage-insight-label">Model mix</span>
          {usage.modelShares.slice(0, 3).map((row) => (
            <div className="usage-model-share" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {usage.dailyTokenRows.length ? (
        <details className="usage-daily-tokens">
          <summary>Daily detail · {usage.dailyTokenRows.length} days</summary>
          <dl>
            {usage.dailyTokenRows.map((row) => (
              <div className="usage-daily-token" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
};

interface IProviderLinksProps {
  links: IUsageProviderConfig["links"];
}

const ProviderLinks = ({ links }: IProviderLinksProps) => {
  if (!links?.length) {
    return null;
  }

  const open = (url: string): void => {
    if (typeof window.__TAURI_INTERNALS__ === "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      void invoke("open_external_url", { url }).catch(() =>
        window.open(url, "_blank", "noopener,noreferrer"),
      );
    }
  };

  return (
    <div className="usage-provider-links">
      {links.map((link) => (
        <button
          className="usage-provider-link"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            open(link.url);
          }}
          data-tauri-drag-region="false"
          key={link.url}
        >
          <span>{link.label}</span>
          <ExternalLink size={10} strokeWidth={2.4} />
        </button>
      ))}
    </div>
  );
};

interface IUsageValueRowsProps {
  rows: Array<{ label: string; value: string | null }>;
}

const UsageValueRows = ({ rows }: IUsageValueRowsProps) => {
  const visibleRows = rows.filter((row) => row.value);

  if (!visibleRows.length) return null;

  return (
    <dl className="usage-value-rows" aria-label="Usage details">
      {visibleRows.map((row) => (
        <div className="usage-value-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
};

interface IProviderDetailProps {
  provider: IUsageProviderConfig;
  settings: IUsageSettings;
  usage: IAgentUsageState;
}

const ProviderDetail = ({ provider, settings, usage }: IProviderDetailProps) => {
  const StatusIcon = usage.status === "loading" ? RefreshCw : TriangleAlert;
  const hasMetrics = usage.metrics.length > 0;
  const fetchedAt = usage.fetchedAt
    ? formatAbsoluteTime(usage.fetchedAt, settings.timeFormat)
    : null;
  const freshness = usage.stale
    ? fetchedAt
      ? `Outdated · ${fetchedAt}`
      : "Outdated"
    : usage.status === "online" && fetchedAt
      ? `Updated ${fetchedAt}`
      : null;
  const groups = USAGE_METRIC_GROUPS.map((group) => ({
    ...group,
    metrics: usage.metrics.filter((item) => item.groupLabel === group.label),
  }));

  return (
    <section className="usage-provider-card" data-status={usage.status}>
      <div className="usage-provider-head">
        <span className="usage-provider-title">
          <ProviderIcon provider={provider} />
          {provider.label}
        </span>
        {usage.status === "online" ? (
          <span className="usage-side-dot usage-card-status-dot" aria-hidden="true" />
        ) : null}
        {usage.plan ? <span className="usage-plan">{usage.plan}</span> : null}
        {freshness ? (
          <span className="usage-freshness" data-stale={usage.stale}>
            {freshness}
          </span>
        ) : null}
      </div>
      <ProviderLinks links={provider.links} />
      {hasMetrics ? (
        <>
          {usage.message ? (
            <div className="usage-provider-message usage-provider-note" role="status">
              <TriangleAlert size={13} strokeWidth={2.2} />
              <span>{usage.message}</span>
            </div>
          ) : null}
          <div className="usage-provider-metrics">
            {provider.id === "agy" ? (
              <div className="usage-group-list">
                {groups.map((group) => (
                  <section className="usage-metric-group" key={group.label}>
                    <div className="usage-group-title">{group.label}</div>
                    <div className="usage-group-models">
                      Models within this group: {group.models.join(", ")}
                    </div>
                    {group.metrics.length ? (
                      <div className="usage-group-meters">
                        {group.metrics.map((item) => (
                          <Meter
                            metric={item}
                            key={`${group.label}-${item.limitLabel ?? item.label}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="usage-group-empty">
                        No quota data from current source
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              usage.metrics.map((item) => (
                <Meter metric={item} key={item.label} />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="usage-provider-message" role="status">
          <StatusIcon size={13} strokeWidth={2.2} />
          <span>
            {usage.status === "loading"
              ? `Checking ${provider.label}`
              : usage.status === "online"
                ? "No quota data from current source"
              : usage.message ?? `${provider.label} usage unavailable`}
          </span>
        </div>
      )}
      {provider.id === "codex" ? (
        <UsageValueRows
          rows={[
            { label: "Rate Limit Resets", value: usage.rateLimitResets },
            { label: "Credits", value: usage.credits },
          ]}
        />
      ) : null}
      {["codex", "cursor"].includes(provider.id) && hasMetrics ? (
        <ProviderInsights provider={provider} usage={usage} />
      ) : null}
      {provider.id !== "codex" && (usage.credits || usage.rateLimitResets) ? (
        <div className="usage-provider-chips">
          {usage.credits ? (
            <span className="usage-chip" title="Credits">
              {usage.credits}
            </span>
          ) : null}
          {usage.rateLimitResets ? (
            <span className="usage-chip" title="Rate limit resets">
              {usage.rateLimitResets}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

interface ISegmentOption<T extends string> {
  label: string;
  value: T;
  sublabel?: string;
}

interface ISegmentProps<T extends string> {
  options: Array<ISegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

const Segment = <T extends string>({
  options,
  value,
  onChange,
}: ISegmentProps<T>) => (
  <div className="usage-setting-segment" role="radiogroup">
    {options.map((option, optionIndex) => (
      <button
        className="usage-setting-option"
        data-active={option.value === value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        tabIndex={option.value === value ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation();
          onChange(option.value);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (optionIndex + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
          onChange(options[nextIndex].value);
          const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
          window.requestAnimationFrame(() => buttons?.[nextIndex]?.focus());
        }}
        data-tauri-drag-region="false"
        key={option.value}
      >
        <span>{option.label}</span>
        {option.sublabel ? <small>{option.sublabel}</small> : null}
      </button>
    ))}
  </div>
);

interface ISettingsPanelProps {
  settings: IUsageSettings;
  onChange: (settings: IUsageSettings) => void;
}

const SettingsPanel = ({ settings, onChange }: ISettingsPanelProps) => {
  const sample = new Date(
    Date.now() + 5 * 60 * 60 * 1_000 + 12 * 60_000,
  ).toISOString();
  const set = (partial: Partial<IUsageSettings>): void =>
    onChange({ ...settings, ...partial });
  const group = (title: string, desc: string, node: ReactNode) => (
    <div className="usage-setting-group">
      <span className="usage-setting-title">{title}</span>
      <span className="usage-setting-desc">{desc}</span>
      {node}
    </div>
  );

  return (
    <section className="usage-settings-panel">
      <div className="usage-provider-head">
        <span className="usage-provider-title">
          <Settings size={14} strokeWidth={2.2} />
          Usage settings
        </span>
      </div>
      {group(
        "Auto refresh",
        "How often provider usage is refreshed",
        <Segment
          value={`${settings.refreshMs}`}
          onChange={(value) => set({ refreshMs: Number(value) })}
          options={[5, 15, 30, 60].map((value) => ({
            label: value === 60 ? "1 hour" : `${value} min`,
            value: `${value * 60_000}`,
          }))}
        />,
      )}
      {group(
        "Usage mode",
        "Whether bars show remaining or consumed quota",
        <Segment
          value={settings.usageMode}
          onChange={(usageMode) => set({ usageMode })}
          options={[
            { label: "Left", value: "left" },
            { label: "Used", value: "used" },
          ]}
        />,
      )}
      {group(
        "Reset timers",
        "Countdown or clock time",
        <Segment
          value={settings.resetMode}
          onChange={(resetMode: UsageResetMode) => set({ resetMode })}
          options={[
            {
              label: "Relative",
              value: "relative",
              sublabel: formatResetLabel(sample, {
                ...settings,
                resetMode: "relative",
              })?.replace("Resets in ", ""),
            },
            {
              label: "Absolute",
              value: "absolute",
              sublabel: formatResetLabel(sample, {
                ...settings,
                resetMode: "absolute",
              })?.replace("Reset at ", ""),
            },
          ]}
        />,
      )}
      {group(
        "Time format",
        "Used by absolute reset times",
        <Segment
          value={settings.timeFormat}
          onChange={(timeFormat) => set({ timeFormat })}
          options={[
            {
              label: "Auto",
              value: "auto",
              sublabel: formatAbsoluteTime(sample, "auto") ?? undefined,
            },
            {
              label: "12-hour",
              value: "12h",
              sublabel: formatAbsoluteTime(sample, "12h") ?? undefined,
            },
            {
              label: "24-hour",
              value: "24h",
              sublabel: formatAbsoluteTime(sample, "24h") ?? undefined,
            },
          ]}
        />,
      )}
    </section>
  );
};

export interface IAgentUsageListProps {
  onRefresh: () => void;
  onSettingsChange: (settings: IUsageSettings) => void;
  settings: IUsageSettings;
  usages: Record<UsageProviderId, IAgentUsageState>;
}

type UsageDragState = {
  divider: number;
  startX: number;
  startWidths: number[];
  totalAvail: number;
};

const USAGE_CARD_GAP = 12;
const usageCardScrollTops: Partial<Record<UsageProviderId, number>> = {};

export const AgentUsageList = ({
  onRefresh,
  onSettingsChange,
  settings,
  usages,
}: IAgentUsageListProps) => {
  const [visibleProviderIds, setVisibleProviderIds] = useState<UsageProviderId[]>(readUsageVisibleProviders);
  const cards = useMemo(
    () => DEFAULT_USAGE_CARD_REGISTRY.filter((card) =>
      visibleProviderIds.includes(card.id) && USAGE_PROVIDERS.some((provider) => provider.id === card.id),
    ),
    [visibleProviderIds],
  );
  const [ratios, setRatios] = useState<number[]>(() =>
    readUsageLayoutRatios(cards.length, cards.map((card) => card.defaultRatio)),
  );
  const ratiosRef = useRef(ratios);
  const trayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<UsageDragState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleProviderVisibility = (providerId: UsageProviderId) => {
    if (visibleProviderIds.includes(providerId)) {
      if (visibleProviderIds.length === 1) return;
      const next = visibleProviderIds.filter((id) => id !== providerId);
      setVisibleProviderIds(next);
      writeUsageVisibleProviders(next);
      return;
    }
    const next = [...visibleProviderIds, providerId];
    setVisibleProviderIds(next);
    writeUsageVisibleProviders(next);
  };

  useEffect(() => {
    writeUsageVisibleProviders(visibleProviderIds);
  }, [visibleProviderIds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      trayRef.current?.querySelectorAll<HTMLElement>("[data-usage-card]").forEach((scroller) => {
        const providerId = scroller.dataset.usageCard as UsageProviderId | undefined;
        if (providerId && typeof usageCardScrollTops[providerId] === "number") {
          scroller.scrollTop = usageCardScrollTops[providerId] ?? 0;
        }
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const next = normalizeUsageRatios(
      ratios,
      cards.length,
      cards.map((card) => card.defaultRatio),
    );
    if (next.some((value, index) => value !== ratios[index])) {
      ratiosRef.current = next;
      setRatios(next);
      return;
    }
    ratiosRef.current = next;
    writeUsageLayoutRatios(next);
  }, [cards, ratios]);

  const resetLayout = () => {
    const next = cards.map((card) => card.defaultRatio);
    resetUsageLayoutRatios();
    ratiosRef.current = next;
    setRatios(next);
  };

  const getLayoutWidth = () => {
    const width = trayRef.current?.getBoundingClientRect().width ?? 960;
    return Math.max(0, width - USAGE_CARD_GAP * Math.max(0, cards.length - 1));
  };

  const setWidths = (widths: number[], totalAvail: number) => {
    if (totalAvail <= 0) return;
    const next = normalizeUsageRatios(
      widths.map((width) => width / totalAvail),
      cards.length,
      cards.map((card) => card.defaultRatio),
    );
    ratiosRef.current = next;
    setRatios(next);
  };

  const handleDividerPointerDown = (
    divider: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const totalAvail = getLayoutWidth();
    if (totalAvail < cards.length * 190) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      divider,
      startX: event.clientX,
      startWidths: ratiosRef.current.map((ratio) => ratio * totalAvail),
      totalAvail,
    };
  };

  const handleDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    const left = drag.divider;
    const right = left + 1;
    const combined = drag.startWidths[left] + drag.startWidths[right];
    const nextLeft = Math.max(
      190,
      Math.min(combined - 190, drag.startWidths[left] + delta),
    );
    const widths = [...drag.startWidths];
    widths[left] = nextLeft;
    widths[right] = combined - nextLeft;
    setWidths(widths, drag.totalAvail);
  };

  const handleDividerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore a pointer that was cancelled by the browser or native shell.
    }
    dragRef.current = null;
  };

  const handleDividerKeyDown = (
    divider: number,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const totalAvail = getLayoutWidth();
    const widths = ratiosRef.current.map((ratio) => ratio * totalAvail);
    const combined = widths[divider] + widths[divider + 1];
    const nextLeft = Math.max(
      190,
      Math.min(
        combined - 190,
        widths[divider] + (event.key === "ArrowRight" ? 16 : -16),
      ),
    );
    widths[divider] = nextLeft;
    widths[divider + 1] = combined - nextLeft;
    setWidths(widths, totalAvail);
  };

  return (
    <div className="usage-dashboard" data-testid="usage-dashboard">
      <div className="usage-dashboard-toolbar">
        <div className="usage-dashboard-heading">
          <strong>{settingsOpen ? "Usage settings" : "Usage"}</strong>
          <span>{settingsOpen ? "Refresh, quota display, and visible provider cards" : `${cards.length} providers · resize cards to fit your view`}</span>
        </div>
        <div className="usage-dashboard-actions">
          {settingsOpen ? (
            <SurfaceControl
              className="usage-toolbar-button"
              surfaceControlShape="rounded"
              surfaceControlSize="compact"
              surfaceControlVariant="subtle"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSettingsOpen(false);
              }}
              data-tauri-drag-region="false"
              aria-label="Back to Usage"
            >
              <ArrowLeft size={12} strokeWidth={2.2} />
              Back to Usage
            </SurfaceControl>
          ) : (
            <>
              <SurfaceControl
                className="usage-toolbar-button"
                surfaceControlShape="rounded"
                surfaceControlSize="compact"
                surfaceControlVariant="subtle"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  resetLayout();
                }}
                data-tauri-drag-region="false"
                title="Reset Usage card layout"
                aria-label="Reset Usage card layout"
              >
                Reset layout
              </SurfaceControl>
              <SurfaceControl
                className="usage-toolbar-button"
                surfaceControlShape="circle"
                surfaceControlSize="icon"
                surfaceControlVariant="subtle"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSettingsOpen(true);
                }}
                data-tauri-drag-region="false"
                title="Usage settings"
                aria-label="Usage settings"
                aria-expanded={settingsOpen}
              >
                <Settings size={12} strokeWidth={2.2} />
              </SurfaceControl>
              <SurfaceControl
                className="usage-toolbar-button"
                surfaceControlShape="circle"
                surfaceControlSize="icon"
                surfaceControlVariant="subtle"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
                data-tauri-drag-region="false"
                title="Refresh usage"
                aria-label="Refresh usage"
              >
                <RefreshCw size={12} strokeWidth={2.2} />
              </SurfaceControl>
            </>
          )}
        </div>
      </div>
      {settingsOpen ? (
        <BoardSurface className="usage-settings-page" tone="parchment" aria-label="Usage settings">
          <BoardScroll>
            <SettingsPanel settings={settings} onChange={onSettingsChange} />
            <fieldset className="usage-provider-visibility">
              <legend>Visible providers</legend>
              <span className="usage-provider-visibility-help">Choose which cards stay on the Usage board.</span>
              <div className="usage-provider-visibility-options">
                {USAGE_PROVIDERS.map((provider) => {
                  const checked = visibleProviderIds.includes(provider.id);
                  return (
                    <label className="usage-provider-visibility-option" key={provider.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={checked && visibleProviderIds.length === 1}
                        onChange={() => toggleProviderVisibility(provider.id)}
                      />
                      <ProviderIcon provider={provider} size={12} />
                      <span>{provider.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </BoardScroll>
        </BoardSurface>
      ) : <div className="usage-tray" data-testid="usage-tray" aria-label="Usage providers" ref={trayRef}>
        {cards.map((card, index) => {
          const provider = card.provider;
          return (
            <div className="usage-card-slot" key={card.id} style={{ flex: `${ratios[index] ?? card.defaultRatio} 0 0px`, minInlineSize: `${card.minWidth}px` }}>
              <BoardSurface className="usage-card usage-provider-surface" tone={card.tone} aria-label={`${provider.label} usage`}>
                <BoardScroll
                  data-usage-card={provider.id}
                  onScroll={(event) => {
                    usageCardScrollTops[provider.id] = event.currentTarget.scrollTop;
                  }}
                >
                  <ProviderDetail
                    provider={provider}
                    settings={settings}
                    usage={usages[provider.id] ?? createAgentUsageState(provider.id)}
                  />
                </BoardScroll>
              </BoardSurface>
            </div>
          );
        }).flatMap((card, index, all) => index < all.length - 1 ? [card, (
          <div
            className="usage-divider card-resize-divider"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={`Resize ${cards[index].provider.label} and ${cards[index + 1].provider.label} cards`}
            aria-valuemin={190}
            aria-valuemax={Math.round(Math.max(190, ((ratios[index] ?? cards[index].defaultRatio) + (ratios[index + 1] ?? cards[index + 1].defaultRatio)) * getLayoutWidth() - 190))}
            aria-valuenow={Math.round((ratios[index] ?? cards[index].defaultRatio) * getLayoutWidth())}
            onPointerDown={(event) => handleDividerPointerDown(index, event)}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            onPointerCancel={handleDividerPointerUp}
            onKeyDown={(event) => handleDividerKeyDown(index, event)}
            onDoubleClick={resetLayout}
            key={`divider-${cards[index].id}`}
          >
            <div className="usage-grip card-resize-grip" aria-hidden="true" />
          </div>
        )] : [card])}
      </div>}
    </div>
  );
};
