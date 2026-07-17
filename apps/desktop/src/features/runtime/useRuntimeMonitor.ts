import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRuntimeSessionViews, buildRuntimeUsageTargets, createDemoRuntimeSnapshots } from "./model";
import type { IRuntimeMonitorView, IRuntimeNativeTarget, IRuntimeTargetSource, IRuntimeUsageSnapshot } from "./types";

const ACTIVE_REFRESH_MS = 5_000;

interface IUseRuntimeMonitorOptions extends IRuntimeTargetSource {
  active: boolean;
  canUseNativeControls: boolean;
  demoMode: boolean;
}

export const useRuntimeMonitor = ({ active, canUseNativeControls, demoMode, registry, sessions }: IUseRuntimeMonitorOptions): IRuntimeMonitorView => {
  const targets = useMemo(() => buildRuntimeUsageTargets({ registry, sessions }), [registry, sessions]);
  const targetKey = useMemo(() => targets.map((target) => `${target.processId}:${target.sourceStartedAtMs}:${target.conversationId}:${target.runtimeEventId}:${target.cwd ?? ""}`).join("|"), [targets]);
  const targetsRef = useRef(targets);
  const refreshingRef = useRef(false);
  const [snapshots, setSnapshots] = useState<IRuntimeUsageSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampledAtMs, setSampledAtMs] = useState<number | null>(null);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const refresh = useCallback(async () => {
    const current = targetsRef.current;
    if (current.length === 0) {
      setSnapshots([]);
      setSampledAtMs(null);
      setError(null);
      return;
    }
    if (demoMode) {
      const next = createDemoRuntimeSnapshots(current);
      setSnapshots(next);
      setSampledAtMs(Date.now());
      setError(null);
      return;
    }
    if (!canUseNativeControls) {
      setSnapshots([]);
      setError("Runtime metrics need the native Agent Halo app");
      return;
    }
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setLoading(true);
    try {
      const nativeTargets: IRuntimeNativeTarget[] = current.map(({ conversationId, runtimeEventId, processId, sourceStartedAtMs, cwd }) => ({ conversationId, eventId: runtimeEventId, processId, expectedStartTimeMs: sourceStartedAtMs, cwd }));
      const next = await invoke<IRuntimeUsageSnapshot[]>("runtime_usage", { targets: nativeTargets });
      setSnapshots(next);
      setSampledAtMs(Math.max(...next.map((snapshot) => snapshot.sampledAtMs), Date.now()));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sample local Letta processes");
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  }, [canUseNativeControls, demoMode]);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh, targetKey]);

  return {
    rows: useMemo(() => buildRuntimeSessionViews(targets, snapshots), [snapshots, targets]),
    loading,
    error,
    sampledAtMs,
    refresh: () => void refresh(),
  };
};
