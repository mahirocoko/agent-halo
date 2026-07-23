export const HALO_PET_MOTIONS = ["idle", "working", "attention", "done", "error"] as const;

export type HaloPetMotion = (typeof HALO_PET_MOTIONS)[number];
export type HaloPetSemanticState = HaloPetMotion;
export type HaloPetMotionMapping = Record<HaloPetSemanticState, HaloPetMotion>;

export const PET_MOTION_MAPPING_STORAGE_KEY = "agent-halo.pet-motion-map";

export const DEFAULT_HALO_PET_MOTION_MAPPING: HaloPetMotionMapping = {
  idle: "idle",
  working: "working",
  attention: "attention",
  done: "done",
  error: "error",
};

const isHaloPetMotion = (value: unknown): value is HaloPetMotion =>
  typeof value === "string" && (HALO_PET_MOTIONS as readonly string[]).includes(value);

export const normalizeHaloPetMotionMapping = (value: unknown): HaloPetMotionMapping => {
  const candidate = value && typeof value === "object" && "mapping" in value
    ? (value as { mapping?: unknown }).mapping
    : value;
  const mapping = candidate && typeof candidate === "object"
    ? candidate as Partial<Record<HaloPetSemanticState, unknown>>
    : {};
  return Object.fromEntries(HALO_PET_MOTIONS.map((state) => [
    state,
    isHaloPetMotion(mapping[state]) ? mapping[state] : DEFAULT_HALO_PET_MOTION_MAPPING[state],
  ])) as HaloPetMotionMapping;
};

const serializeHaloPetMotionMapping = (mapping: HaloPetMotionMapping): string => JSON.stringify({
  schemaVersion: 1,
  mapping,
});

export const readHaloPetMotionMapping = (): HaloPetMotionMapping => {
  try {
    const stored = window.localStorage.getItem(PET_MOTION_MAPPING_STORAGE_KEY);
    let parsed: unknown = null;
    if (stored) {
      try {
        parsed = JSON.parse(stored) as unknown;
      } catch {
        parsed = null;
      }
    }
    const mapping = normalizeHaloPetMotionMapping(parsed);
    const normalized = serializeHaloPetMotionMapping(mapping);
    if (stored !== normalized) window.localStorage.setItem(PET_MOTION_MAPPING_STORAGE_KEY, normalized);
    return mapping;
  } catch {
    return { ...DEFAULT_HALO_PET_MOTION_MAPPING };
  }
};

export const writeHaloPetMotionMapping = (mapping: HaloPetMotionMapping): void => {
  try {
    window.localStorage.setItem(PET_MOTION_MAPPING_STORAGE_KEY, serializeHaloPetMotionMapping(normalizeHaloPetMotionMapping(mapping)));
  } catch {
    // Current in-memory mapping remains active when storage is unavailable.
  }
};

export const resolveHaloPetMotion = (
  state: HaloPetSemanticState,
  mapping: HaloPetMotionMapping = DEFAULT_HALO_PET_MOTION_MAPPING,
): HaloPetMotion => mapping[state];
