import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  createAgentUsageState,
  createDemoAgentUsage,
  parseAgentUsageSnapshot,
} from "./adapters";
import { USAGE_PROVIDERS } from "./providers";
import type {
  IAgentUsageSnapshot,
  IAgentUsageState,
  IUsageProviderConfig,
  IUsageSettings,
  UsageProviderId,
} from "./types";

export interface IAgentUsageListResult {
  refresh: () => void;
  usages: Record<UsageProviderId, IAgentUsageState>;
}

const createInitialUsageStates = (): Record<
  UsageProviderId,
  IAgentUsageState
> =>
  Object.fromEntries(
    USAGE_PROVIDERS.map((provider) => [
      provider.id,
      createAgentUsageState(provider.id),
    ]),
  ) as Record<UsageProviderId, IAgentUsageState>;

export const useAgentUsageList = (
  settings: IUsageSettings,
  demoMode: boolean,
): IAgentUsageListResult => {
  const settingsRef = useRef(settings);
  const [usages, setUsages] = useState(createInitialUsageStates);
  const [snapshots, setSnapshots] = useState<
    Partial<Record<UsageProviderId, IAgentUsageSnapshot>>
  >({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refreshProvider = async (
    provider: IUsageProviderConfig,
  ): Promise<void> => {
    if (demoMode) {
      setUsages((current) => ({
        ...current,
        [provider.id]: createDemoAgentUsage(provider),
      }));
      return;
    }

    if (typeof window.__TAURI_INTERNALS__ === "undefined") {
      setSnapshots((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setUsages((current) => ({
        ...current,
        [provider.id]: createAgentUsageState(provider.id, {
          status: "offline",
          message: "Agent Halo desktop runtime needed",
        }),
      }));
      return;
    }

    try {
      const snapshot = await invoke<IAgentUsageSnapshot>(provider.command);
      setSnapshots((current) => ({
        ...current,
        [provider.id]: snapshot,
      }));
      setUsages((current) => ({
        ...current,
        [provider.id]: parseAgentUsageSnapshot(
          provider.id,
          snapshot,
          settingsRef.current,
        ),
      }));
    } catch (error) {
      setSnapshots((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setUsages((current) => ({
        ...current,
        [provider.id]: createAgentUsageState(provider.id, {
          status: "offline",
          message:
            error instanceof Error
              ? error.message
              : String(error || `${provider.label} usage unavailable`),
        }),
      }));
    }
  };

  const refresh = (): void => {
    for (const provider of USAGE_PROVIDERS) {
      void refreshProvider(provider);
    }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, settings.refreshMs);
    return () => window.clearInterval(timer);
  }, [settings.refreshMs]);

  useEffect(() => {
    if (settings.resetMode !== "relative") {
      return;
    }

    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [settings.resetMode]);

  useEffect(() => {
    if (!Object.keys(snapshots).length) {
      return;
    }

    setUsages((current) => {
      const next = { ...current };

      for (const provider of USAGE_PROVIDERS) {
        const snapshot = snapshots[provider.id];
        if (snapshot) {
          next[provider.id] = parseAgentUsageSnapshot(
            provider.id,
            snapshot,
            settings,
          );
        }
      }

      return next;
    });
  }, [
    tick,
    settings.resetMode,
    settings.timeFormat,
    settings.usageMode,
    snapshots,
  ]);

  return { refresh, usages };
};
