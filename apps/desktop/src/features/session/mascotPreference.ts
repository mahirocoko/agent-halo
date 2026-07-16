import {
  DEFAULT_HALO_MASCOT,
  getHaloMascotName,
  type HaloMascotName,
} from "./HaloMascot";

export const MASCOT_STORAGE_KEY = "agent-halo.mascot";

export const readHaloMascotPreference = (): HaloMascotName => {
  try {
    return getHaloMascotName(window.localStorage.getItem(MASCOT_STORAGE_KEY));
  } catch {
    return DEFAULT_HALO_MASCOT;
  }
};

export const writeHaloMascotPreference = (mascot: HaloMascotName): void => {
  try {
    window.localStorage.setItem(MASCOT_STORAGE_KEY, mascot);
  } catch {
    // Current in-memory selection remains active when storage is unavailable.
  }
};
