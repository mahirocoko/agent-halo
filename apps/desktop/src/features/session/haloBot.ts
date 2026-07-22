export const HALO_BOT_LOADOUT_STORAGE_KEY = "agent-halo.halo-bot-loadout";

export const HALO_BOT_LOADOUTS = [
  "3051",
  "1462",
  "5324",
  "c160",
  "2515",
  "4232",
  "d351",
  "6124",
  "9132",
  "f061",
] as const;

export type HaloBotLoadout = (typeof HALO_BOT_LOADOUTS)[number];

export const DEFAULT_HALO_BOT_LOADOUT: HaloBotLoadout = "3051";

export const HALO_BOT_LOADOUT_LABELS: Record<HaloBotLoadout, string> = {
  "3051": "Researcher",
  "1462": "UX",
  "5324": "Editorial",
  c160: "Social",
  "2515": "Creative",
  "4232": "Brand",
  d351: "Marketing",
  "6124": "Print",
  "9132": "Content",
  f061: "SEO",
};

export const isHaloBotLoadout = (value: unknown): value is HaloBotLoadout =>
  typeof value === "string" && (HALO_BOT_LOADOUTS as readonly string[]).includes(value);

export const getHaloBotLoadout = (value?: string | null): HaloBotLoadout =>
  isHaloBotLoadout(value) ? value : DEFAULT_HALO_BOT_LOADOUT;

export const readHaloBotLoadoutPreference = (): HaloBotLoadout => {
  try {
    const stored = window.localStorage.getItem(HALO_BOT_LOADOUT_STORAGE_KEY);
    const normalized = getHaloBotLoadout(stored);
    if (stored !== normalized) window.localStorage.setItem(HALO_BOT_LOADOUT_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return DEFAULT_HALO_BOT_LOADOUT;
  }
};

export const writeHaloBotLoadoutPreference = (loadout: HaloBotLoadout): void => {
  try {
    window.localStorage.setItem(HALO_BOT_LOADOUT_STORAGE_KEY, loadout);
  } catch {
    // Current in-memory selection remains active when storage is unavailable.
  }
};
