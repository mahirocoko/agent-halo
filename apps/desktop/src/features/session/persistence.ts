import {
  DELETED_SESSIONS_STORAGE_KEY,
  DISMISSED_SESSIONS_STORAGE_KEY,
  SESSION_EVENTS_STORAGE_KEY,
} from "./constants";
import { isSessionEventRegistry, normalizeSessionEventRegistry } from "./eventRegistry";
import type {
  DeletedSessionRegistry,
  DismissedSessionRegistry,
  SessionEventRegistry,
} from "./types";

export const readSessionEventRegistry = (): SessionEventRegistry => {
  try {
    const raw = window.localStorage.getItem(SESSION_EVENTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!isSessionEventRegistry(parsed)) return {};

    const normalized = normalizeSessionEventRegistry(parsed);
    window.localStorage.setItem(SESSION_EVENTS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return {};
  }
};

export const writeSessionEventRegistry = (registry: SessionEventRegistry) => {
  try {
    window.localStorage.setItem(SESSION_EVENTS_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // The in-memory registry remains available when persistence is unavailable.
  }
};

const readTimestampRegistry = (
  key: string,
  allowLegacyArray: boolean,
): Record<string, number> => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (allowLegacyArray && Array.isArray(parsed)) {
      return Object.fromEntries(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((id) => [id, 0]),
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
};

const writeTimestampRegistry = (key: string, registry: Record<string, number>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(registry));
  } catch {
    // The current runtime still owns the in-memory tombstones.
  }
};

export const readDismissedSessionIds = (): DismissedSessionRegistry =>
  readTimestampRegistry(DISMISSED_SESSIONS_STORAGE_KEY, true);

export const writeDismissedSessionIds = (registry: DismissedSessionRegistry) =>
  writeTimestampRegistry(DISMISSED_SESSIONS_STORAGE_KEY, registry);

export const readDeletedSessionIds = (): DeletedSessionRegistry =>
  readTimestampRegistry(DELETED_SESSIONS_STORAGE_KEY, false);

export const writeDeletedSessionIds = (registry: DeletedSessionRegistry) =>
  writeTimestampRegistry(DELETED_SESSIONS_STORAGE_KEY, registry);

const isRegistryEntryAfter = (
  registry: Record<string, number>,
  conversationId: string | null | undefined,
  latestEventAt: string | null | undefined,
) => {
  if (!conversationId || !latestEventAt || typeof registry[conversationId] !== "number") {
    return false;
  }
  const latestEventMs = Date.parse(latestEventAt);
  return Number.isFinite(latestEventMs) && registry[conversationId] >= latestEventMs;
};

export const isDismissedAfter = isRegistryEntryAfter;
export const isDeletedAfter = isRegistryEntryAfter;
