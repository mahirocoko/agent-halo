export type UsageProviderId = "codex" | "agy" | "claude" | "cursor" | "grok";
export type UsageMode = "left" | "used";
export type UsageResetMode = "relative" | "absolute";
export type UsageTimeFormat = "auto" | "12h" | "24h";
export type UsageSidebarSelection = UsageProviderId | "settings";

export interface IUsageProviderLink {
  label: string;
  url: string;
}

export interface IUsageProviderConfig {
  id: UsageProviderId;
  label: string;
  command: "codex_usage" | "agy_usage" | "claude_usage" | "cursor_usage" | "grok_usage";
  iconPath: string;
  color: string;
  links?: IUsageProviderLink[];
}

export interface IUsageSettings {
  refreshMs: number;
  usageMode: UsageMode;
  resetMode: UsageResetMode;
  timeFormat: UsageTimeFormat;
}

export interface IUsageChartPoint {
  label: string;
  value: number;
  valueLabel?: string;
}

export interface IUsageMetricLine {
  type: "text" | "progress" | "badge" | "barChart" | string;
  label: string;
  used?: number;
  limit?: number;
  value?: string;
  text?: string;
  points?: IUsageChartPoint[];
  note?: string;
  color?: string;
  resetsAt?: string;
}

export interface IAgentUsageSnapshot {
  providerId: string;
  displayName?: string;
  plan?: string | null;
  lines?: IUsageMetricLine[];
  fetchedAt?: string;
}

export interface IUsageMetric {
  label: string;
  groupLabel: string | null;
  groupModels: string[];
  limitLabel: string | null;
  value: number | null;
  statusLevel: "ok" | "warning" | "danger";
  remainingLabel: string | null;
  resetLabel: string | null;
}

export interface IUsageMetricGroup {
  label: string;
  models: string[];
  metrics: IUsageMetric[];
}

export interface IAgentUsageState {
  status: "loading" | "online" | "offline" | "error";
  providerId: UsageProviderId;
  message: string | null;
  fetchedAt: string | null;
  plan: string | null;
  metrics: IUsageMetric[];
  sessionPercent: number | null;
  weeklyPercent: number | null;
  reviewsPercent: number | null;
  rateLimitResets: string | null;
  credits: string | null;
  today: string | null;
  yesterday: string | null;
  latestTokenLog: string | null;
  last30Days: string | null;
  usageTrend: IUsageMetricLine | null;
  dailyTokenRows: Array<{ label: string; value: string }>;
  modelShares: Array<{ label: string; value: string }>;
}
