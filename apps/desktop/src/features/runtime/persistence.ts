import { runtimeTargetKey } from "./model";
import type { IRuntimeUsageTarget } from "./types";

export const RUNTIME_ENDED_IDENTITIES_STORAGE_KEY = "agent-halo.runtime-ended-identities";
const MAX_ENDED_IDENTITIES = 512;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

interface IRuntimeEndedIdentityEntry {
  key: string;
  endedAt: number;
}

interface IRuntimeEndedIdentityState {
  schemaVersion: 1;
  entries: IRuntimeEndedIdentityEntry[];
}

const readValidEntries = (value: unknown, now = Date.now()): IRuntimeEndedIdentityEntry[] => {
  if (!value || typeof value !== "object") return [];
  const candidate = value as Partial<IRuntimeEndedIdentityState>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) return [];
  const byKey = new Map<string, IRuntimeEndedIdentityEntry>();
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<IRuntimeEndedIdentityEntry>;
    if (typeof item.key !== "string" || item.key.length === 0 || item.key.length > 512) continue;
    if (typeof item.endedAt !== "number" || !Number.isSafeInteger(item.endedAt) || item.endedAt < 0 || item.endedAt > now + MAX_FUTURE_SKEW_MS) continue;
    const previous = byKey.get(item.key);
    if (!previous || item.endedAt > previous.endedAt) byKey.set(item.key, { key: item.key, endedAt: item.endedAt });
  }
  return [...byKey.values()].sort((a, b) => b.endedAt - a.endedAt);
};

const normalizeEntries = (value: unknown, now = Date.now()): IRuntimeEndedIdentityEntry[] =>
  readValidEntries(value, now).slice(0, MAX_ENDED_IDENTITIES);

const retainReferencedEntries = (
  entries: IRuntimeEndedIdentityEntry[],
  targets: IRuntimeUsageTarget[],
): IRuntimeEndedIdentityEntry[] => {
  const referencedKeys = new Set(targets.map(runtimeTargetKey));
  const referenced = entries.filter((entry) => referencedKeys.has(entry.key));
  const orphaned = entries.filter((entry) => !referencedKeys.has(entry.key));
  return [...referenced, ...orphaned].slice(0, MAX_ENDED_IDENTITIES);
};

export const readRuntimeEndedIdentities = (): Map<string, number> => {
  try {
    const raw = window.localStorage.getItem(RUNTIME_ENDED_IDENTITIES_STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(normalizeEntries(JSON.parse(raw)).map((entry) => [entry.key, entry.endedAt]));
  } catch {
    return new Map();
  }
};

export const writeRuntimeEndedIdentities = (identities: Map<string, number>): void => {
  try {
    const state: IRuntimeEndedIdentityState = {
      schemaVersion: 1,
      entries: normalizeEntries({
        schemaVersion: 1,
        entries: [...identities].map(([key, endedAt]) => ({ key, endedAt })),
      }),
    };
    window.localStorage.setItem(RUNTIME_ENDED_IDENTITIES_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Runtime cleanup remains an in-memory optimization when storage is unavailable.
  }
};

export const mergeRuntimeEndedIdentities = (
  current: Map<string, number>,
  endedTargets: IRuntimeUsageTarget[],
  referencedTargets: IRuntimeUsageTarget[],
  endedAt = Date.now(),
): Map<string, number> => {
  const next = new Map(current);
  for (const target of endedTargets) next.set(runtimeTargetKey(target), endedAt);
  const entries = readValidEntries({
    schemaVersion: 1,
    entries: [...next].map(([key, timestamp]) => ({ key, endedAt: timestamp })),
  });
  return new Map(retainReferencedEntries(entries, referencedTargets).map((entry) => [entry.key, entry.endedAt]));
};

export const reconcileRuntimeEndedIdentities = (
  current: Map<string, number>,
  targets: IRuntimeUsageTarget[],
): Map<string, number> => {
  const entries = readValidEntries({
    schemaVersion: 1,
    entries: [...current].map(([key, endedAt]) => ({ key, endedAt })),
  });
  return new Map(retainReferencedEntries(entries, targets).map((entry) => [entry.key, entry.endedAt]));
};
