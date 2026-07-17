export const COMPLETION_PET_ENABLED_STORAGE_KEY = "agent-halo.completion-pet-enabled";
export const COMPLETION_PET_SIZE_STORAGE_KEY = "agent-halo.completion-pet-size";
export type CompletionPetSize = "small" | "medium" | "large";
export const DEFAULT_COMPLETION_PET_SIZE: CompletionPetSize = "large";

export const readCompletionPetEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(COMPLETION_PET_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

export const writeCompletionPetEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(COMPLETION_PET_ENABLED_STORAGE_KEY, `${enabled}`);
  } catch {
    // The current renderer remains authoritative when storage is unavailable.
  }
};

export const readCompletionPetSize = (): CompletionPetSize => {
  try {
    const value = window.localStorage.getItem(COMPLETION_PET_SIZE_STORAGE_KEY);
    return value === "small" || value === "medium" || value === "large" ? value : DEFAULT_COMPLETION_PET_SIZE;
  } catch {
    return DEFAULT_COMPLETION_PET_SIZE;
  }
};

export const writeCompletionPetSize = (size: CompletionPetSize): void => {
  try {
    window.localStorage.setItem(COMPLETION_PET_SIZE_STORAGE_KEY, size);
  } catch {
    // The current renderer remains authoritative when storage is unavailable.
  }
};
