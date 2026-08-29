import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLocalServiceOwnerTargets, buildRuntimeLivenessTargets, buildRuntimeSessionViews, buildRuntimeUsageTargets, createDemoLocalServices, createDemoRuntimeSnapshots, isTerminalRuntimeStatus, localServiceProcessKey, runtimeTargetKey, selectRuntimeMonitorTargets, selectRuntimeSamplingTargets } from "./model";
import { mergeRuntimeEndedIdentities, readRuntimeEndedIdentities, reconcileRuntimeEndedIdentities, writeRuntimeEndedIdentities } from "./persistence";
import type { ILocalService, ILocalServiceControlRequest, ILocalServiceControlResult, ILocalServiceOwnerTarget, ILocalServicesSnapshot, IRuntimeMonitorView, IRuntimeNativeTarget, IRuntimeTargetSource, IRuntimeUsageSnapshot, IRuntimeUsageTarget } from "./types";

const ACTIVE_REFRESH_MS = 5_000;

interface IUseRuntimeMonitorOptions extends IRuntimeTargetSource {
  processActive: boolean;
  livenessActive: boolean;
  servicesActive: boolean;
  canUseNativeControls: boolean;
  demoMode: boolean;
}

export const useRuntimeMonitor = ({ canUseNativeControls, demoMode, livenessActive, processActive, registry, servicesActive, sessions }: IUseRuntimeMonitorOptions): IRuntimeMonitorView => {
  const allTargets = useMemo(() => buildRuntimeUsageTargets({ registry, sessions }), [registry, sessions]);
  const livenessCandidates = useMemo(() => buildRuntimeLivenessTargets({ registry, sessions }), [registry, sessions]);
  const serviceOwnerTargets = useMemo(() => buildLocalServiceOwnerTargets({ registry, sessions }), [registry, sessions]);
  const [endedIdentities, setEndedIdentities] = useState<Map<string, number>>(readRuntimeEndedIdentities);
  const eligibleTargets = useMemo(() => allTargets.filter((target) => !endedIdentities.has(runtimeTargetKey(target))), [allTargets, endedIdentities]);
  const runtimeTargets = useMemo(() => selectRuntimeSamplingTargets(allTargets, endedIdentities), [allTargets, endedIdentities]);
  const livenessTargets = useMemo(
    () => selectRuntimeSamplingTargets(livenessCandidates, endedIdentities),
    [endedIdentities, livenessCandidates],
  );
  const samplingTargets = useMemo(
    () => selectRuntimeMonitorTargets(runtimeTargets, livenessTargets, processActive, livenessActive),
    [livenessActive, livenessTargets, processActive, runtimeTargets],
  );
  const referencedTargets = useMemo(() => {
    const byIdentity = new Map([...allTargets, ...livenessCandidates].map((target) => [runtimeTargetKey(target), target]));
    return [...byIdentity.values()];
  }, [allTargets, livenessCandidates]);
  const endedCount = allTargets.length - eligibleTargets.length;
  const omittedCount = eligibleTargets.length - runtimeTargets.length;
  const endedConversationIds = useMemo(
    () => !canUseNativeControls || demoMode
      ? new Set<string>()
      : new Set(
      livenessCandidates
        .filter((target) => endedIdentities.has(runtimeTargetKey(target)))
        .map((target) => target.conversationId),
    ),
    [canUseNativeControls, demoMode, endedIdentities, livenessCandidates],
  );
  const targetKey = useMemo(() => samplingTargets.map((target) => `${target.processId}:${target.sourceStartedAtMs}:${target.conversationId}:${target.runtimeEventId}:${target.cwd ?? ""}`).join("|"), [samplingTargets]);
  const targetsRef = useRef(samplingTargets);
  const allTargetsRef = useRef(referencedTargets);
  const serviceOwnerTargetsRef = useRef(serviceOwnerTargets);
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
  const refreshingRef = useRef(false);
  const servicesLoadingRef = useRef(false);
  const servicesControlInFlightRef = useRef(false);
  const processRequestVersionRef = useRef(0);
  const servicesRequestVersionRef = useRef(0);
  const demoStoppedProcessKeysRef = useRef(new Set<string>());
  const [snapshots, setSnapshots] = useState<IRuntimeUsageSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampledAtMs, setSampledAtMs] = useState<number | null>(null);
  const [services, setServices] = useState<ILocalService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    targetsRef.current = samplingTargets;
    allTargetsRef.current = referencedTargets;
    serviceOwnerTargetsRef.current = serviceOwnerTargets;
  }, [referencedTargets, samplingTargets, serviceOwnerTargets]);

  useEffect(() => {
    setEndedIdentities((previous) => reconcileRuntimeEndedIdentities(previous, referencedTargets));
  }, [referencedTargets]);

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
    if (servicesLoadingRef.current || servicesControlInFlightRef.current) return;
    const requestVersion = servicesRequestVersionRef.current + 1;
    servicesRequestVersionRef.current = requestVersion;
    if (demoMode) {
      if (servicesRequestVersionRef.current === requestVersion) {
        setServices(createDemoLocalServices().filter((service) => !demoStoppedProcessKeysRef.current.has(localServiceProcessKey(service))));
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
      const ownerTargets: ILocalServiceOwnerTarget[] = serviceOwnerTargetsRef.current;
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

  const controlLocalService = useCallback(async (request: ILocalServiceControlRequest): Promise<ILocalServiceControlResult> => {
    if (demoMode) {
      const result: ILocalServiceControlResult = {
        processId: request.processId,
        bindAddress: request.bindAddress,
        port: request.port,
        status: request.mode === "stop" ? "stillRunning" : "killed",
        signal: request.mode === "stop" ? "SIGTERM" : "SIGKILL",
        stillListening: request.mode === "stop",
        error: null,
      };
      if (request.mode === "forceKill") {
        const processKey = `${request.processId}:${request.processStartTimeMs}`;
        demoStoppedProcessKeysRef.current.add(processKey);
        setServices((current) => current.filter((service) => localServiceProcessKey(service) !== processKey));
      }
      return result;
    }
    if (!canUseNativeControls) {
      return {
        processId: request.processId,
        bindAddress: request.bindAddress,
        port: request.port,
        status: "unsupported",
        signal: null,
        stillListening: false,
        error: "Local service control needs the native Agent Halo app",
      };
    }
    if (servicesControlInFlightRef.current) {
      return {
        processId: request.processId,
        bindAddress: request.bindAddress,
        port: request.port,
        status: "failed",
        signal: null,
        stillListening: true,
        error: "Another service control is still running",
      };
    }
    servicesControlInFlightRef.current = true;
    try {
      const result = await invoke<ILocalServiceControlResult>("control_local_service", { request });
      if (["stopped", "killed", "alreadyStopped"].includes(result.status)) {
        const processKey = `${request.processId}:${request.processStartTimeMs}`;
        setServices((current) => current.filter((service) => localServiceProcessKey(service) !== processKey));
        window.setTimeout(() => void refreshServices(), 150);
      } else if (result.status === "listenerStopped") {
        setServices((current) => current.filter((service) => !(
          service.processId === request.processId &&
          service.processStartTimeMs === request.processStartTimeMs &&
          service.bindAddress === request.bindAddress &&
          service.port === request.port
        )));
        window.setTimeout(() => void refreshServices(), 150);
      } else if (["identityChanged", "notAllowed"].includes(result.status)) {
        window.setTimeout(() => void refreshServices(), 150);
      }
      return result;
    } catch (reason) {
      return {
        processId: request.processId,
        bindAddress: request.bindAddress,
        port: request.port,
        status: "failed",
        signal: null,
        stillListening: true,
        error: reason instanceof Error ? reason.message : "Could not control the local service",
      };
    } finally {
      servicesControlInFlightRef.current = false;
    }
  }, [canUseNativeControls, demoMode, refreshServices]);

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
    const hasBackgroundLivenessTarget = livenessActive && livenessTargets.length > 0;
    if (!processActive && !hasBackgroundLivenessTarget) return undefined;
    void refreshProcesses();
    const timer = window.setInterval(() => void refreshProcesses(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [livenessActive, livenessTargets.length, processActive, refreshNonce, refreshProcesses, targetKey]);

  useEffect(() => {
    if (!servicesActive) return undefined;
    void refreshServices();
    const timer = window.setInterval(() => void refreshServices(), ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshServices, servicesActive]);

  return {
    rows: useMemo(() => buildRuntimeSessionViews(runtimeTargets, snapshots), [runtimeTargets, snapshots]),
    endedConversationIds,
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
    controlLocalService,
  };
};
