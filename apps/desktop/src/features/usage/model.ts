import { USAGE_PROVIDERS } from "./providers";
import type {
  IAgentUsageState,
  IUsageProviderConfig,
  UsageProviderId,
} from "./types";

export type UsageCardTone = "mint" | "lavender" | "sand" | "parchment";

export type UsageCardDefinition = {
  id: UsageProviderId;
  provider: IUsageProviderConfig;
  tone: UsageCardTone;
  minWidth: number;
  defaultRatio: number;
};

export type UsageCardViewModel = {
  id: UsageProviderId;
  provider: IUsageProviderConfig;
  tone: UsageCardTone;
  usage: IAgentUsageState;
  minWidth: number;
  ratio: number;
};

export const USAGE_CARD_MIN_WIDTH = 190;
export const USAGE_LAYOUT_STORAGE_KEY = "agent-halo.usage-layout.v1";
export const USAGE_VISIBILITY_STORAGE_KEY = "agent-halo.usage-visibility.v1";
let cachedUsageVisibleProviders: UsageProviderId[] | null = null;

export const DEFAULT_USAGE_CARD_REGISTRY: UsageCardDefinition[] = [
  {
    id: "codex",
    provider: USAGE_PROVIDERS.find((p) => p.id === "codex") ?? USAGE_PROVIDERS[0],
    tone: "mint",
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: "agy",
    provider: USAGE_PROVIDERS.find((p) => p.id === "agy") ?? USAGE_PROVIDERS[1],
    tone: "lavender",
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: "claude",
    provider: USAGE_PROVIDERS.find((p) => p.id === "claude") ?? USAGE_PROVIDERS[2],
    tone: "sand",
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: "cursor",
    provider: USAGE_PROVIDERS.find((p) => p.id === "cursor") ?? USAGE_PROVIDERS[3],
    tone: "parchment",
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
];

export const normalizeUsageRatios = (
  ratios: number[],
  count: number = DEFAULT_USAGE_CARD_REGISTRY.length,
  defaultRatios: number[] = DEFAULT_USAGE_CARD_REGISTRY.map((c) => c.defaultRatio),
): number[] => {
  const defaultSum = defaultRatios.reduce((acc, val) => acc + val, 0);
  const normalizedDefaults = defaultSum > 0 ? defaultRatios.map((val) => val / defaultSum) : defaultRatios;
  if (!Array.isArray(ratios) || ratios.length !== count) return normalizedDefaults;
  if (!ratios.every((val) => typeof val === "number" && Number.isFinite(val) && val > 0.04 && val < 0.96)) {
    return normalizedDefaults;
  }
  const sum = ratios.reduce((acc, val) => acc + val, 0);
  if (sum <= 0 || Math.abs(sum - 1) > 0.1) return normalizedDefaults;
  return ratios.map((val) => val / sum);
};

export const readUsageLayoutRatios = (
  count: number = DEFAULT_USAGE_CARD_REGISTRY.length,
  defaultRatios: number[] = DEFAULT_USAGE_CARD_REGISTRY.map((c) => c.defaultRatio),
): number[] => {
  try {
    const raw = window.localStorage.getItem(USAGE_LAYOUT_STORAGE_KEY);
    if (!raw) return defaultRatios;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultRatios;
    return normalizeUsageRatios(parsed as number[], count, defaultRatios);
  } catch {
    return defaultRatios;
  }
};

export const writeUsageLayoutRatios = (ratios: number[]): void => {
  try {
    window.localStorage.setItem(USAGE_LAYOUT_STORAGE_KEY, JSON.stringify(ratios));
  } catch {
    // The current runtime retains the in-memory ratios when persistence fails.
  }
};

export const resetUsageLayoutRatios = (): void => {
  try {
    window.localStorage.removeItem(USAGE_LAYOUT_STORAGE_KEY);
  } catch {
    // The current runtime resets in-memory ratios even if storage fails.
  }
};

export const readUsageVisibleProviders = (): UsageProviderId[] => {
  const defaults = DEFAULT_USAGE_CARD_REGISTRY.map((card) => card.id);
  if (cachedUsageVisibleProviders) return [...cachedUsageVisibleProviders];
  try {
    const raw = window.localStorage.getItem(USAGE_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      cachedUsageVisibleProviders = defaults;
      return defaults;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedUsageVisibleProviders = defaults;
      return defaults;
    }
    const visible = parsed.filter((id): id is UsageProviderId => defaults.includes(id as UsageProviderId));
    cachedUsageVisibleProviders = visible.length > 0 ? visible : defaults;
    return [...cachedUsageVisibleProviders];
  } catch {
    cachedUsageVisibleProviders = defaults;
    return defaults;
  }
};

export const writeUsageVisibleProviders = (providerIds: UsageProviderId[]): void => {
  cachedUsageVisibleProviders = [...providerIds];
  try {
    window.localStorage.setItem(USAGE_VISIBILITY_STORAGE_KEY, JSON.stringify(providerIds));
  } catch {
    // In-memory visibility remains available when persistence fails.
  }
};
