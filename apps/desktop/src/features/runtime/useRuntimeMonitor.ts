import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRuntimeSessionViews, buildRuntimeUsageTargets, createDemoLocalServices, createDemoRuntimeSnapshots, isTerminalRuntimeStatus, runtimeTargetKey, selectRuntimeSamplingTargets } from "./model";
import { mergeRuntimeEndedIdentities, readRuntimeEndedIdentities, reconcileRuntimeEndedIdentities, writeRuntimeEndedIdentities } from "./persistence";
import type { ILocalService, ILocalServiceOwnerTarget, ILocalServicesSnapshot, IRuntimeMonitorView, IRuntimeNativeTarget, IRuntimeTargetSource, IRuntimeUsageSnapshot, IRuntimeUsageTarget } from "./types";

const ACTIVE_REFRESH_MS = 5_000;

interface IUseRuntimeMonitorOptions extends IRuntimeTargetSource {
  processActive: boolean;
  servicesActive: boolean;
  canUseNativeControls: boolean;
  demoMode: boolean;
}

export const useRuntimeMonitor = ({ canUseNativeControls, demoMode, processActive, registry, servicesActive, sessions }: IUseRuntimeMonitorOptions): IRuntimeMonitorView => {
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
  const servicesLoadingRef = useRef(false);
  const processRequestVersionRef = useRef(0);
  const servicesRequestVersionRef = useRef(0);
  const [snapshots, setSnapshots] = useState<IRuntimeUsageSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampledAtMs, setSampledAtMs] = useState<number | null>(null);
  const [services, setServices] = useState<ILocalService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
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

  const refreshServices = useCallback(async () => {
    if (servicesLoadingRef.current) return;
    const requestVersion = servicesRequestVersionRef.current + 1;
    servicesRequestVersionRef.current = requestVersion;
    if (demoMode) {
      if (servicesRequestVersionRef.current === requestVersion) {
        setServices(createDemoLocalServices());
        setServicesError(null);
      }
      return;
    }
    if (!canUseNativeControls) {
      setServices([]);
      setServicesError("Local services need the native Agent Halo app");
      return;
    }
    servicesLoadingRef.current = true;
    setServicesLoading(true);
    try {
      const ownerTargets: ILocalServiceOwnerTarget[] = targetsRef.current.map(({ conversationId, processId, sourceStartedAtMs, project, herdrPaneId }) => ({
        conversationId,
        processId,
        expectedStartTimeMs: sourceStartedAtMs,
        project,
        herdrPaneId,
      }));
      const snapshot = await invoke<ILocalServicesSnapshot>("local_services", { ownerTargets });
      if (servicesRequestVersionRef.current !== requestVersion) return;
      setServices(snapshot.services);
      setServicesError(snapshot.error);
    } catch (reason) {
      if (servicesRequestVersionRef.current === requestVersion) {
        setServices([]);
        setServicesError(reason instanceof Error ? reason.message : "Could not inspect local services");
      }
    } finally {
      servicesLoadingRef.current = false;
      setServicesLoading(false);
    }
  }, [canUseNativeControls, demoMode]);

  const refreshProcesses = useCallback(async () => {
    const requestVersion = processRequestVersionRef.current + 1;
    processRequestVersionRef.current = requestVersion;
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
      if (processRequestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) acceptSnapshots(next, current);
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
      if (processRequestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) acceptSnapshots(next, current);
    } catch (reason) {
      if (processRequestVersionRef.current === requestVersion && targetKeyRef.current === requestTargetKey) setError(reason instanceof Error ? reason.message : "Could not sample local Letta processes");
    } finally {
      refreshingRef.current = false;
      setLoading(false);
      if (processRequestVersionRef.current !== requestVersion || targetKeyRef.current !== requestTargetKey) setRefreshNonce((currentNonce) => currentNonce + 1);
    }
  }, [acceptSnapshots, canUseNativeControls, demoMode]);

  useEffect(() => {
    if (!processActive) return undefined;
    void refreshProcesses();
    const timer = window.setInterval(() => void refreshProcesses(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [processActive, refreshNonce, refreshProcesses, targetKey]);

  useEffect(() => {
    if (!servicesActive) return undefined;
    void refreshServices();
    const timer = window.setInterval(() => void refreshServices(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshServices, servicesActive]);

  return {
    rows: useMemo(() => buildRuntimeSessionViews(targets, snapshots), [snapshots, targets]),
    services,
    servicesError,
    servicesLoading,
    endedCount,
    omittedCount,
    loading,
    error,
    sampledAtMs,
    refreshProcesses: () => void refreshProcesses(),
    refreshServices: () => void refreshServices(),
  };
};
