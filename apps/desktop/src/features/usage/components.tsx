import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createAgentUsageState } from "./adapters";
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
  UsageSidebarSelection,
} from "./types";

interface IProviderIconProps {
  provider: IUsageProviderConfig;
  size?: number;
}

interface IProviderIconStyle extends CSSProperties {
  "--provider-icon": string;
  "--provider-color": string;
}

const ProviderIcon = ({ provider, size = 14 }: IProviderIconProps) => (
  <span
    className="usage-provider-icon"
    aria-hidden="true"
    style={
      {
        "--provider-icon": `url(${provider.iconPath})`,
        "--provider-color": provider.color,
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
  <div className="usage-meter" data-empty={value.value === null}>
    <div className="usage-meter-head">
      <span className="usage-meter-label">{value.limitLabel ?? value.label}</span>
      <span className="usage-status-dot" data-level={value.statusLevel} />
    </div>
    <span className="usage-meter-track" aria-hidden="true">
      <span
        className="usage-meter-fill"
        style={{ width: `${value.value ?? 0}%` }}
      />
    </span>
    <div className="usage-meter-foot">
      <span>{value.remainingLabel ?? "—"}</span>
      {value.resetLabel ? <span>{value.resetLabel}</span> : null}
    </div>
  </div>
);

interface ITextRow {
  label: string;
  value: string | null;
}

interface ITextRowsProps {
  rows: ITextRow[];
}

const TextRows = ({ rows }: ITextRowsProps) => {
  const visible = rows.filter((row) => row.value);

  return visible.length ? (
    <div className="usage-text-rows">
      {visible.map((row) => (
        <div className="usage-text-row" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  ) : null;
};

interface ITrendProps {
  line: IUsageMetricLine | null;
}

const Trend = ({ line }: ITrendProps) => {
  const points =
    line?.points?.filter(
      (point) => Number.isFinite(point.value) && point.value >= 0,
    ) ?? [];

  if (!points.length) {
    return null;
  }

  const max = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="usage-trend-card">
      <div className="usage-trend-head">
        <span>{line?.label ?? "Usage Trend"}</span>
        {line?.note ? <small title={line.note}>ⓘ</small> : null}
      </div>
      <div className="usage-trend-bars" aria-label="Codex usage trend">
        {points.map((point, index) => (
          <span
            className="usage-trend-bar"
            style={{
              height: `${Math.max(8, (point.value / max) * 100)}%`,
              backgroundColor: line?.color,
            }}
            title={`${point.label}: ${point.valueLabel ?? point.value}`}
            key={`${point.label}-${index}`}
          />
        ))}
      </div>
    </div>
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

interface IProviderDetailProps {
  provider: IUsageProviderConfig;
  usage: IAgentUsageState;
}

const ProviderDetail = ({ provider, usage }: IProviderDetailProps) => {
  const StatusIcon = usage.status === "loading" ? RefreshCw : TriangleAlert;
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
        {usage.plan ? <span className="usage-plan">{usage.plan}</span> : null}
      </div>
      <ProviderLinks links={provider.links} />
      {usage.status === "online" && usage.metrics.length ? (
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
              : usage.message ?? `${provider.label} usage unavailable`}
          </span>
        </div>
      )}
      {provider.id === "codex" && usage.status === "online" ? (
        <>
          <TextRows
            rows={[
              { label: "Credits", value: usage.credits },
              { label: "Rate Limit Resets", value: usage.rateLimitResets },
              { label: "Today", value: usage.today },
              { label: "Yesterday", value: usage.yesterday },
              { label: "Latest Token Log", value: usage.latestTokenLog },
              { label: "Last 30 Days", value: usage.last30Days },
            ]}
          />
          <Trend line={usage.usageTrend} />
          {usage.dailyTokenRows.length ? (
            <div className="usage-daily-tokens">
              <div className="usage-daily-title">Daily Tokens</div>
              {usage.dailyTokenRows.map((row) => (
                <div className="usage-daily-token" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {usage.modelShares.length ? (
            <div className="usage-model-shares">
              {usage.modelShares.map((row) => (
                <div className="usage-model-share" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {usage.credits || usage.rateLimitResets ? (
        <div
          className="usage-provider-chips"
          data-hidden={provider.id === "codex"}
        >
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

export const AgentUsageList = ({
  onRefresh,
  onSettingsChange,
  settings,
  usages,
}: IAgentUsageListProps) => {
  const [selectedId, setSelectedId] =
    useState<UsageSidebarSelection | null>(null);
  const providers = useMemo(() => USAGE_PROVIDERS, []);
  const selected =
    selectedId === "settings"
      ? null
      : providers.find((provider) => provider.id === selectedId) ??
        providers[0] ??
        null;
  const active: UsageSidebarSelection =
    selectedId === "settings" ? "settings" : (selected?.id ?? "settings");

  useEffect(() => {
    if (!providers.length) {
      setSelectedId("settings");
    } else if (
      selectedId !== "settings" &&
      (!selectedId || !providers.some((provider) => provider.id === selectedId))
    ) {
      setSelectedId(providers[0].id);
    }
  }, [selectedId, providers]);

  const selectAndFocus = (selection: UsageSidebarSelection) => {
    setSelectedId(selection);
    window.requestAnimationFrame(() => document.getElementById(`usage-tab-${selection}`)?.focus());
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: UsageSidebarSelection) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const selections: UsageSidebarSelection[] = [...providers.map((provider) => provider.id), "settings"];
    const currentIndex = selections.indexOf(current);
    const next = event.key === "Home"
      ? selections[0]
      : event.key === "End"
        ? selections.at(-1) ?? selections[0]
        : selections[(currentIndex + (event.key === "ArrowDown" ? 1 : -1) + selections.length) % selections.length];
    selectAndFocus(next);
  };

  return (
    <div className="usage-list" aria-label="Usage providers">
      <div className="usage-list-topline">
        <span>Usage</span>
        <button
          className="usage-refresh"
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
        </button>
      </div>
      <div className="usage-layout">
        <div
          className="usage-sidebar"
          role="tablist"
          aria-label="Usage providers"
        >
          {providers.map((provider) => (
            <button
              id={`usage-tab-${provider.id}`}
              className="usage-side-tab"
              data-active={active === provider.id}
              type="button"
              role="tab"
              aria-selected={active === provider.id}
              aria-controls="usage-provider-panel"
              tabIndex={active === provider.id ? 0 : -1}
              onKeyDown={(event) => handleTabKeyDown(event, provider.id)}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedId(provider.id);
              }}
              data-tauri-drag-region="false"
              key={provider.id}
              title={provider.label}
            >
              <ProviderIcon provider={provider} size={13} />
              <span>{provider.label}</span>
              {usages[provider.id]?.status === "online" ? (
                <><span className="usage-side-dot" aria-hidden="true" /><span className="sr-only">Online</span></>
              ) : null}
            </button>
          ))}
          <button
            id="usage-tab-settings"
            className="usage-side-tab usage-side-settings"
            data-active={active === "settings"}
            type="button"
            role="tab"
            aria-selected={active === "settings"}
            aria-controls="usage-provider-panel"
            tabIndex={active === "settings" ? 0 : -1}
            onKeyDown={(event) => handleTabKeyDown(event, "settings")}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId("settings");
            }}
            data-tauri-drag-region="false"
            title="Usage settings"
          >
            <Settings size={13} strokeWidth={2.2} />
            <span>Settings</span>
          </button>
        </div>
        <div id="usage-provider-panel" className="usage-detail-panel" role="tabpanel" aria-labelledby={`usage-tab-${active}`}>
          {active === "settings" ? (
            <SettingsPanel settings={settings} onChange={onSettingsChange} />
          ) : selected ? (
            <ProviderDetail
              provider={selected}
              usage={usages[selected.id] ?? createAgentUsageState(selected.id)}
            />
          ) : (
            <div className="usage-empty">No local usage providers found</div>
          )}
        </div>
      </div>
    </div>
  );
};
