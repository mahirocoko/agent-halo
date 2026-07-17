export const MOVEMENT_BREAK_ENABLED_STORAGE_KEY = "agent-halo.movement-break-enabled";

export const readMovementBreakEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(MOVEMENT_BREAK_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeMovementBreakEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(MOVEMENT_BREAK_ENABLED_STORAGE_KEY, `${enabled}`);
  } catch {
    // The current renderer remains authoritative when storage is unavailable.
  }
};
