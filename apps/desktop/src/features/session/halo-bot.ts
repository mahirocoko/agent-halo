export const HALO_BOT_LOADOUT_STORAGE_KEY = 'agent-halo.halo-bot-loadout'

export const HALO_BOT_PART_CATALOG = {
  eyes: [
    { name: 'big-face', frames: 1, kind: 'static' },
    { name: 'cheeky-terminal', frames: 16, kind: 'sequence' },
    { name: 'glasses', frames: 2, kind: 'blink' },
    { name: 'human', frames: 2, kind: 'blink' },
    { name: 'human-2', frames: 2, kind: 'blink' },
    { name: 'monitor', frames: 1, kind: 'static' },
    { name: 'monitor-round', frames: 1, kind: 'static' },
    { name: 'mustache', frames: 1, kind: 'static' },
    { name: 'terminal', frames: 2, kind: 'blink' },
    { name: 'terminal-green', frames: 2, kind: 'blink' },
    { name: 'terminal-light', frames: 1, kind: 'static' },
    { name: 'terminal-round', frames: 2, kind: 'blink' },
    { name: 'tight-visor', frames: 8, kind: 'sequence' },
    { name: 'visor', frames: 8, kind: 'sequence' },
    { name: 'wayfarer', frames: 4, kind: 'sequence' },
    { name: 'wayfarer-face', frames: 8, kind: 'sequence' },
  ],
  heads: [
    { name: 'ac', frames: 1, kind: 'static' },
    { name: 'blob', frames: 1, kind: 'static' },
    { name: 'blob-blue', frames: 1, kind: 'static' },
    { name: 'bowl', frames: 1, kind: 'static' },
    { name: 'box', frames: 1, kind: 'static' },
    { name: 'commodore', frames: 1, kind: 'static' },
    { name: 'frame', frames: 1, kind: 'static' },
    { name: 'punch-bowl', frames: 1, kind: 'static' },
  ],
  body: [
    { name: 'backpack', frames: 1, kind: 'static' },
    { name: 'claws', frames: 1, kind: 'static' },
    { name: 'heart', frames: 1, kind: 'static' },
    { name: 'swag', frames: 1, kind: 'static' },
    { name: 'tank', frames: 1, kind: 'static' },
    { name: 'wings', frames: 1, kind: 'static' },
    { name: 'fire', frames: 1, kind: 'static' },
  ],
  top: [
    { name: 'antenna', frames: 1, kind: 'static' },
    { name: 'bulb', frames: 1, kind: 'static' },
    { name: 'bunny-ears', frames: 1, kind: 'static' },
    { name: 'disco', frames: 1, kind: 'static' },
    { name: 'leaf', frames: 1, kind: 'static' },
    { name: 'lollypop', frames: 1, kind: 'static' },
    { name: 'mohawk', frames: 1, kind: 'static' },
    { name: 'plant', frames: 1, kind: 'static' },
    { name: 'radar', frames: 1, kind: 'static' },
    { name: 'bun', frames: 1, kind: 'static' },
    { name: 'horns', frames: 1, kind: 'static' },
    { name: 'spikes', frames: 1, kind: 'static' },
  ],
} as const

export type HaloBotPartCategory = keyof typeof HALO_BOT_PART_CATALOG
export type HaloBotLoadout = string
export type HaloBotPartKind = 'static' | 'blink' | 'sequence'

export interface IHaloBotPartSelection {
  index: number
  name: string
  frames: number
  kind: HaloBotPartKind
}

export type HaloBotParts = Record<HaloBotPartCategory, IHaloBotPartSelection>

export const HALO_BOT_PART_CATEGORIES: HaloBotPartCategory[] = ['eyes', 'heads', 'body', 'top']
export const HALO_BOT_LAYER_ORDER: HaloBotPartCategory[] = ['top', 'body', 'heads', 'eyes']
export const HALO_BOT_COMBINATION_COUNT = HALO_BOT_PART_CATEGORIES.reduce(
  (total, category) => total * HALO_BOT_PART_CATALOG[category].length,
  1,
)

export const DEFAULT_HALO_BOT_LOADOUT: HaloBotLoadout = '3051'

const CURATED_HALO_BOT_LOADOUT_LABELS: Record<string, string> = {
  '3051': 'Researcher',
  '1462': 'UX',
  '5324': 'Editorial',
  c160: 'Social',
  '2515': 'Creative',
  '4232': 'Brand',
  d351: 'Marketing',
  '6124': 'Print',
  '9132': 'Content',
  f061: 'SEO',
}

const canonicalizeHaloBotLoadout = (value: string): string => value.toLowerCase()

export const isHaloBotLoadout = (value: unknown): value is HaloBotLoadout => {
  if (typeof value !== 'string' || !/^[0-9a-z]{4}$/i.test(value)) return false
  const normalized = canonicalizeHaloBotLoadout(value)
  return HALO_BOT_PART_CATEGORIES.every((category, index) => {
    const partIndex = Number.parseInt(normalized[index] ?? '', 36)
    return Number.isInteger(partIndex) && partIndex < HALO_BOT_PART_CATALOG[category].length
  })
}

export const getHaloBotLoadout = (value?: string | null): HaloBotLoadout =>
  value && isHaloBotLoadout(value) ? canonicalizeHaloBotLoadout(value) : DEFAULT_HALO_BOT_LOADOUT

export const getHaloBotParts = (loadout: HaloBotLoadout): HaloBotParts => {
  const normalized = getHaloBotLoadout(loadout)
  return Object.fromEntries(
    HALO_BOT_PART_CATEGORIES.map((category, index) => {
      const partIndex = Number.parseInt(normalized[index] ?? '0', 36)
      const part = HALO_BOT_PART_CATALOG[category][partIndex] ?? HALO_BOT_PART_CATALOG[category][0]
      return [category, { index: partIndex, ...part }]
    }),
  ) as HaloBotParts
}

export const setHaloBotPart = (
  loadout: HaloBotLoadout,
  category: HaloBotPartCategory,
  partIndex: number,
): HaloBotLoadout => {
  const normalized = getHaloBotLoadout(loadout)
  const categoryIndex = HALO_BOT_PART_CATEGORIES.indexOf(category)
  const boundedIndex = Math.min(Math.max(0, partIndex), HALO_BOT_PART_CATALOG[category].length - 1)
  return `${normalized.slice(0, categoryIndex)}${boundedIndex.toString(36)}${normalized.slice(categoryIndex + 1)}`
}

export const getHaloBotLoadoutLabel = (loadout: HaloBotLoadout): string => {
  const normalized = getHaloBotLoadout(loadout)
  return CURATED_HALO_BOT_LOADOUT_LABELS[normalized] ?? `Pixabot ${normalized.toUpperCase()}`
}

export const readHaloBotLoadoutPreference = (): HaloBotLoadout => {
  try {
    const stored = window.localStorage.getItem(HALO_BOT_LOADOUT_STORAGE_KEY)
    const normalized = getHaloBotLoadout(stored)
    if (stored !== normalized) window.localStorage.setItem(HALO_BOT_LOADOUT_STORAGE_KEY, normalized)
    return normalized
  } catch {
    return DEFAULT_HALO_BOT_LOADOUT
  }
}

export const writeHaloBotLoadoutPreference = (loadout: HaloBotLoadout): void => {
  try {
    window.localStorage.setItem(HALO_BOT_LOADOUT_STORAGE_KEY, getHaloBotLoadout(loadout))
  } catch {
    // Current in-memory selection remains active when storage is unavailable.
  }
}
