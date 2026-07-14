import {
  getUsageMetricGroupLabel,
  getUsageMetricGroupModels,
} from "./providers";
import { formatResetLabel } from "./settings";
import type {
  IAgentUsageSnapshot,
  IAgentUsageState,
  IUsageMetric,
  IUsageMetricLine,
  IUsageProviderConfig,
  IUsageSettings,
  UsageProviderId,
} from "./types";

export {
  formatAbsoluteTime,
  formatResetLabel,
  readUsageSettings,
  writeUsageSettings,
} from "./settings";

const clampPercent = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
};

const findMetricLine = (
  lines: IUsageMetricLine[],
  label: string,
): IUsageMetricLine | null =>
  lines.find((line) => line.label.toLowerCase() === label.toLowerCase()) ?? null;

const getProgressPercent = (line: IUsageMetricLine | null): number | null => {
  if (!line || line.type !== "progress" || typeof line.used !== "number") {
    return null;
  }

  const progress =
    typeof line.limit === "number" && line.limit > 0 && line.limit !== 100
      ? (line.used / line.limit) * 100
      : line.used;

  return clampPercent(progress);
};

const getTextValue = (line: IUsageMetricLine | null): string | null => {
  if (typeof line?.value === "string" && line.value.trim()) {
    return line.value.trim();
  }

  if (typeof line?.text === "string" && line.text.trim()) {
    return line.text.trim();
  }

  return null;
};

const getStatusLevel = (
  used: number | null,
  left: number | null,
  settings: IUsageSettings,
): IUsageMetric["statusLevel"] => {
  if (used === null) {
    return "ok";
  }

  if (settings.usageMode === "used") {
    if (used >= 80) {
      return "danger";
    }

    return used >= 55 ? "warning" : "ok";
  }

  if (left !== null && left <= 20) {
    return "danger";
  }

  return left !== null && left <= 45 ? "warning" : "ok";
};

const normalizeMetric = (
  line: IUsageMetricLine,
  settings: IUsageSettings,
): IUsageMetric => {
  const used = getProgressPercent(line);
  const left = used === null ? null : Math.max(0, 100 - used);
  const value = settings.usageMode === "used" ? used : left;
  const groupLabel = getUsageMetricGroupLabel(line.label);
  const normalizedLabel = line.label.toLowerCase();
  const limitLabel = groupLabel
    ? normalizedLabel.includes("five") || normalizedLabel.includes("5h")
      ? "Five Hour Limit"
      : "Weekly Limit"
    : null;
  const hasAvailableQuota =
    groupLabel !== null &&
    limitLabel === "Five Hour Limit" &&
    settings.usageMode === "left" &&
    left === 100;

  return {
    label: line.label,
    groupLabel,
    groupModels: getUsageMetricGroupModels(groupLabel),
    limitLabel,
    value,
    statusLevel: getStatusLevel(used, left, settings),
    remainingLabel: hasAvailableQuota
      ? "Quota available"
      : value === null
        ? null
        : `${value}% ${
            groupLabel && settings.usageMode === "left"
              ? "remaining"
              : settings.usageMode
          }`,
    resetLabel: hasAvailableQuota
      ? null
      : formatResetLabel(line.resetsAt, settings),
  };
};

export const createAgentUsageState = (
  providerId: UsageProviderId,
  partial: Partial<IAgentUsageState> = {},
): IAgentUsageState => ({
  status: "loading",
  providerId,
  message: null,
  fetchedAt: null,
  plan: null,
  metrics: [],
  sessionPercent: null,
  weeklyPercent: null,
  reviewsPercent: null,
  rateLimitResets: null,
  credits: null,
  today: null,
  yesterday: null,
  latestTokenLog: null,
  last30Days: null,
  usageTrend: null,
  dailyTokenRows: [],
  modelShares: [],
  ...partial,
});

export const parseAgentUsageSnapshot = (
  providerId: UsageProviderId,
  snapshot: IAgentUsageSnapshot,
  settings: IUsageSettings,
): IAgentUsageState => {
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const knownTextLabels = new Set([
    "rate limit resets",
    "credits",
    "today",
    "yesterday",
    "latest token log",
    "last 30 days",
  ]);

  return createAgentUsageState(providerId, {
    status: "online",
    message: getTextValue(findMetricLine(lines, "Status")),
    fetchedAt: snapshot.fetchedAt ?? new Date().toISOString(),
    plan: snapshot.plan ?? null,
    metrics: lines
      .filter((line) => line.type === "progress")
      .map((line) => normalizeMetric(line, settings)),
    sessionPercent: getProgressPercent(findMetricLine(lines, "Session")),
    weeklyPercent: getProgressPercent(findMetricLine(lines, "Weekly")),
    reviewsPercent: getProgressPercent(findMetricLine(lines, "Reviews")),
    rateLimitResets: getTextValue(findMetricLine(lines, "Rate Limit Resets")),
    credits: getTextValue(findMetricLine(lines, "Credits")),
    today: getTextValue(findMetricLine(lines, "Today")),
    yesterday: getTextValue(findMetricLine(lines, "Yesterday")),
    latestTokenLog: getTextValue(findMetricLine(lines, "Latest Token Log")),
    last30Days: getTextValue(findMetricLine(lines, "Last 30 Days")),
    usageTrend:
      lines.find(
        (line) =>
          line.type === "barChart" && line.label.toLowerCase() === "usage trend",
      ) ?? null,
    dailyTokenRows:
      providerId === "codex"
        ? lines
            .filter(
              (line) =>
                line.type === "text" &&
                line.label.toLowerCase().startsWith("daily "),
            )
            .map((line) => ({
              label: line.label.replace(/^Daily\s+/i, ""),
              value: getTextValue(line) ?? "",
            }))
            .filter((line) => line.value)
        : [],
    modelShares:
      providerId === "codex"
        ? lines
            .filter(
              (line) =>
                line.type === "text" &&
                !knownTextLabels.has(line.label.toLowerCase()) &&
                !line.label.toLowerCase().startsWith("daily "),
            )
            .map((line) => ({
              label: line.label,
              value: getTextValue(line) ?? "",
            }))
            .filter((line) => /%$/.test(line.value))
        : [],
  });
};

export const createDemoAgentUsage = (
  provider: IUsageProviderConfig,
): IAgentUsageState => {
  const createMetric = (
    label: string,
    value: number,
    remainingLabel: string,
    resetLabel: string | null,
    statusLevel: IUsageMetric["statusLevel"] = "ok",
  ): IUsageMetric => {
    const groupLabel = getUsageMetricGroupLabel(label);

    return {
      label,
      groupLabel,
      groupModels: getUsageMetricGroupModels(groupLabel),
      limitLabel: groupLabel ? "Weekly Limit" : null,
      value,
      statusLevel,
      remainingLabel,
      resetLabel,
    };
  };

  return createAgentUsageState(provider.id, {
    status: "online",
    fetchedAt: new Date().toISOString(),
    plan: provider.id === "codex" ? "Pro" : "Max",
    metrics:
      provider.id === "codex"
        ? [
            createMetric("Session", 73, "73% left", "Resets in 2h 18m"),
            createMetric("Weekly", 91, "91% left", "Resets in 4d 7h"),
            createMetric("Reviews", 96, "96% left", null),
          ]
        : [
            createMetric(
              "Gemini models",
              82,
              "82% left",
              "Resets in 4h 31m",
            ),
            createMetric(
              "Claude and GPT models",
              42,
              "42% left",
              "Resets in 1d 19h",
              "warning",
            ),
          ],
    sessionPercent: provider.id === "codex" ? 27 : null,
    weeklyPercent: provider.id === "codex" ? 9 : null,
    reviewsPercent: provider.id === "codex" ? 4 : null,
    rateLimitResets: provider.id === "codex" ? "1 available" : null,
    credits: provider.id === "codex" ? "$0.00 · 0 credits" : null,
  });
};
