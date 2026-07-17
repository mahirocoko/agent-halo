import {
  DEFAULT_HALO_PET,
  getHaloPetName,
  type HaloPetName,
} from "./HaloPet";

export const PET_STORAGE_KEY = "agent-halo.pet";
export const LEGACY_MASCOT_STORAGE_KEY = "agent-halo.mascot";

export const readHaloPetPreference = (): HaloPetName => {
  try {
    const current = window.localStorage.getItem(PET_STORAGE_KEY);
    if (current) return getHaloPetName(current);
    const migrated = getHaloPetName(window.localStorage.getItem(LEGACY_MASCOT_STORAGE_KEY));
    window.localStorage.setItem(PET_STORAGE_KEY, migrated);
    return migrated;
  } catch {
    return DEFAULT_HALO_PET;
  }
};

export const writeHaloPetPreference = (pet: HaloPetName): void => {
  try {
    window.localStorage.setItem(PET_STORAGE_KEY, pet);
  } catch {
    // Current in-memory selection remains active when storage is unavailable.
  }
};
