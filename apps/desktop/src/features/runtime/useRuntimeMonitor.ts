import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRuntimeSessionViews, buildRuntimeUsageTargets, createDemoRuntimeSnapshots, isTerminalRuntimeStatus, runtimeTargetKey, selectRuntimeSamplingTargets } from "./model";
import { mergeRuntimeEndedIdentities, readRuntimeEndedIdentities, reconcileRuntimeEndedIdentities, writeRuntimeEndedIdentities } from "./persistence";
import type { IRuntimeMonitorView, IRuntimeNativeTarget, IRuntimeTargetSource, IRuntimeUsageSnapshot, IRuntimeUsageTarget } from "./types";

const ACTIVE_REFRESH_MS = 5_000;

interface IUseRuntimeMonitorOptions extends IRuntimeTargetSource {
  active: boolean;
  canUseNativeControls: boolean;
  demoMode: boolean;
}

export const useRuntimeMonitor = ({ active, canUseNativeControls, demoMode, registry, sessions }: IUseRuntimeMonitorOptions): IRuntimeMonitorView => {
  const allTargets = useMemo(() => buildRuntimeUsageTargets({ registry, sessions }), [registry, sessions]);
  const [endedIdentities, setEndedIdentities] = useState<Map<string, number>>(readRuntimeEndedIdentities);
  const eligibleTargets = useMemo(() => allTargets.filter((target) => !endedIdentities.has(runtimeTargetKey(target))), [allTargets, endedIdentities]);
  const targets = useMemo(() => selectRuntimeSamplingTargets(allTargets, endedIdentities), [allTargets, endedIdentities]);
  const endedCount = allTargets.length - eligibleTargets.length;
  const omittedCount = eligibleTargets.length - targets.length;
  const targetKey = useMemo(() => targets.map((target) => `${target.processId}:${target.sourceStartedAtMs}:${target.conversationId}:${target.runtimeEventId}:${target.cwd ?? ""}`).join("|"), [targets]);
  const targetsRef = useRef(targets);
  const allTargetsRef = useRef(allTargets);
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
  const refreshingRef = useRef(false);
  const requestVersionRef = useRef(0);
  const [snapshots, setSnapshots] = useState<IRuntimeUsageSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampledAtMs, setSampledAtMs] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    targetsRef.current = targets;
    allTargetsRef.current = allTargets;
  }, [allTargets, targets]);

  useEffect(() => {
    setEndedIdentities((previous) => reconcileRuntimeEndedIdentities(previous, allTargets));
  }, [allTargets]);

  useEffect(() => {
    writeRuntimeEndedIdentities(endedIdentities);
  }, [endedIdentities]);

  useEffect(() => {
    setSnapshots([]);
    setSampledAtMs(null);
  }, [targetKey]);

  const acceptSnapshots = useCallback((next: IRuntimeUsageSnapshot[], current: IRuntimeUsageTarget[]) => {
    const targetsByNativeIdentity = new Map(current.map((target) => [`${target.processId}:${target.conversationId}`, target]));
    const attributed = next.map((snapshot) => ({
      ...snapshot,
      targetSourceStartedAtMs: targetsByNativeIdentity.get(`${snapshot.processId}:${snapshot.conversationId}`)?.sourceStartedAtMs ?? null,
    }));
    const terminalIdentities = new Set(
      attributed
        .filter((snapshot) => isTerminalRuntimeStatus(snapshot.status))
        .map((snapshot) => `${snapshot.processId}:${snapshot.conversationId}`),
    );
    const endedTargets = current.filter((target) => terminalIdentities.has(`${target.processId}:${target.conversationId}`));
    if (endedTargets.length > 0) setEndedIdentities((previous) => mergeRuntimeEndedIdentities(previous, endedTargets, allTargetsRef.current));
    setSnapshots(attributed.filter((snapshot) => !isTerminalRuntimeStatus(snapshot.status)));
    setSampledAtMs(Math.max(...attributed.map((snapshot) => snapshot.sampledAtMs), Date.now()));
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const requestTargetKey = targetKeyRef.current;
    const current = targetsRef.current;
    if (current.length === 0) {
      setSnapshots([]);
      setSampledAtMs(null);
      setError(null);
      return;
    }
    if (demoMode) {
      const next = createDemoRuntimeSnapshots(current);
      if (requestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) acceptSnapshots(next, current);
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
      if (requestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) acceptSnapshots(next, current);
    } catch (reason) {
      if (requestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) setError(reason instanceof Error ? reason.message : "Could not sample local Letta processes");
    } finally {
      refreshingRef.current = false;
      setLoading(false);
      if (requestVersionRef.current !== requestVersion || targetKeyRef.current !== requestTargetKey) setRefreshNonce((currentNonce) => currentNonce + 1);
    }
  }, [acceptSnapshots, canUseNativeControls, demoMode]);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh, refreshNonce, targetKey]);

  return {
    rows: useMemo(() => buildRuntimeSessionViews(targets, snapshots), [snapshots, targets]),
    endedCount,
    omittedCount,
    loading,
    error,
    sampledAtMs,
    refresh: () => void refresh(),
  };
};
