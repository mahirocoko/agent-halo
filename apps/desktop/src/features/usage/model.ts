import { USAGE_PROVIDERS } from './providers'
import type { IUsageProviderConfig, UsageProviderId } from './types'

export type UsageCardTone = 'mint' | 'lavender' | 'sand' | 'parchment'

export type UsageCardDefinition = {
  id: UsageProviderId
  provider: IUsageProviderConfig
  tone: UsageCardTone
  minWidth: number
  defaultRatio: number
}

export const USAGE_CARD_MIN_WIDTH = 190
export const USAGE_LAYOUT_STORAGE_KEY = 'agent-halo.usage-layout.v1'
export const USAGE_VISIBILITY_STORAGE_KEY = 'agent-halo.usage-visibility.v1'
let cachedUsageVisibleProviders: UsageProviderId[] | null = null

export const DEFAULT_USAGE_CARD_REGISTRY: UsageCardDefinition[] = [
  {
    id: 'codex',
    provider: USAGE_PROVIDERS.find((p) => p.id === 'codex') ?? USAGE_PROVIDERS[0],
    tone: 'mint',
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: 'agy',
    provider: USAGE_PROVIDERS.find((p) => p.id === 'agy') ?? USAGE_PROVIDERS[1],
    tone: 'lavender',
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: 'claude',
    provider: USAGE_PROVIDERS.find((p) => p.id === 'claude') ?? USAGE_PROVIDERS[2],
    tone: 'sand',
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
  {
    id: 'cursor',
    provider: USAGE_PROVIDERS.find((p) => p.id === 'cursor') ?? USAGE_PROVIDERS[3],
    tone: 'parchment',
    minWidth: USAGE_CARD_MIN_WIDTH,
    defaultRatio: 0.25,
  },
]

export const readUsageVisibleProviders = (): UsageProviderId[] => {
  const defaults = DEFAULT_USAGE_CARD_REGISTRY.map((card) => card.id)
  if (cachedUsageVisibleProviders) return [...cachedUsageVisibleProviders]
  try {
    const raw = window.localStorage.getItem(USAGE_VISIBILITY_STORAGE_KEY)
    if (!raw) {
      cachedUsageVisibleProviders = defaults
      return defaults
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      cachedUsageVisibleProviders = defaults
      return defaults
    }
    const visible = parsed.filter((id): id is UsageProviderId => defaults.includes(id as UsageProviderId))
    cachedUsageVisibleProviders = visible.length > 0 ? visible : defaults
    return [...cachedUsageVisibleProviders]
  } catch {
    cachedUsageVisibleProviders = defaults
    return defaults
  }
}

export const writeUsageVisibleProviders = (providerIds: UsageProviderId[]): void => {
  cachedUsageVisibleProviders = [...providerIds]
  try {
    window.localStorage.setItem(USAGE_VISIBILITY_STORAGE_KEY, JSON.stringify(providerIds))
  } catch {
    // In-memory visibility remains available when persistence fails.
  }
}
