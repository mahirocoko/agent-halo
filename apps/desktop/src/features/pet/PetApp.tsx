import { invoke } from "@tauri-apps/api/core";
import { Clock3, Dumbbell, Play, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { IMovementPoseSnapshot } from "../movement/types";
import { HaloPet } from "../session/HaloPet";
import type { CompletionPetSize } from "./preferences";
import type { CompletionPetAction, ICompletionPetNativeState, ICompletionPetSummon } from "./types";

const POLL_MS = 200;
const DRAG_THRESHOLD_PX = 4;
const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const DEMO_EMBER_PREVIEW = SEARCH_PARAMS.has("demoEmberPet");
const DEMO_EMBER_PET = DEMO_EMBER_PREVIEW || SEARCH_PARAMS.has("demoEmberCompletion");
const DEMO_PET = SEARCH_PARAMS.has("demoPet") || DEMO_EMBER_PET;
const DEMO_PET_SIZE = ((value: string | null): CompletionPetSize => value === "small" || value === "medium" ? value : "large")(SEARCH_PARAMS.get("demoPetSize"));
const EMBER_PREVIEW_GEOMETRY: Record<CompletionPetSize, { collapsed: { width: number; height: number }; visual: { width: number; height: number }; expanded: { left: number; top: number } }> = {
  small: { collapsed: { width: 56, height: 66 }, visual: { width: 44, height: 54 }, expanded: { left: 102, top: 87 } },
  medium: { collapsed: { width: 78, height: 93 }, visual: { width: 66, height: 81 }, expanded: { left: 91, top: 73.5 } },
  large: { collapsed: { width: 100, height: 120 }, visual: { width: 88, height: 108 }, expanded: { left: 80, top: 60 } },
};
const MovementChallenge = lazy(async () => {
  const module = await import("../movement/MovementChallenge");
  return { default: module.MovementChallenge };
});

const DEMO_SUMMON: ICompletionPetSummon = {
  schemaVersion: 1,
  id: "demo-focus-complete",
  pet: DEMO_EMBER_PET ? "ember-starling" : "scorpion",
  petSize: DEMO_PET_SIZE,
  visual: DEMO_EMBER_PET ? "ember-starling" : undefined,
  preview: DEMO_EMBER_PREVIEW,
  movementBreakEnabled: !DEMO_EMBER_PREVIEW,
  nextPhase: "short-break",
  title: DEMO_EMBER_PREVIEW ? "Pet preview" : "Focus complete",
  actionLabel: DEMO_EMBER_PREVIEW ? "" : "Start Short break",
};

const INITIAL_MOVEMENT_SNAPSHOT: IMovementPoseSnapshot = {
  status: "idle",
  repCount: 0,
  targetReps: 10,
  guidance: "Camera starts only after you choose 10 Squats",
  permission: "notDetermined",
  sessionId: null,
  shoulderLineY: null,
  targetLineY: 0.86,
  depthProgress: 0,
  error: null,
};

const isNative = (): boolean => typeof window.__TAURI_INTERNALS__ !== "undefined";

export const PetApp = () => {
  const [summon, setSummon] = useState<ICompletionPetSummon | null>(DEMO_PET ? DEMO_SUMMON : null);
  const [expanded, setExpanded] = useState(SEARCH_PARAMS.has("demoPetExpanded"));
  const [movementActive, setMovementActive] = useState(false);
  const [movementSnapshot, setMovementSnapshot] = useState<IMovementPoseSnapshot>(INITIAL_MOVEMENT_SNAPSHOT);
  const [busy, setBusy] = useState(false);
  const [rebaseOffset, setRebaseOffset] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const startActionRef = useRef<HTMLButtonElement | null>(null);
  const closeActionRef = useRef<HTMLButtonElement | null>(null);
  const companionRef = useRef<HTMLButtonElement | null>(null);
  const movementActionRef = useRef<HTMLButtonElement | null>(null);
  const previousSummonIdRef = useRef<string | null>(summon?.id ?? null);
  const rebaseTimerRef = useRef<number | null>(null);
  const movementActiveRef = useRef(false);
  const movementCompletionSubmittedRef = useRef(false);
  const movementAttemptRef = useRef(0);

  useEffect(() => {
    if (DEMO_PET || !isNative()) return undefined;
    let disposed = false;
    const refresh = async () => {
      try {
        const snapshot = await invoke<ICompletionPetNativeState>("completion_pet_state");
        if (!disposed) setSummon(snapshot.summon);
      } catch {
        // The native window remains hidden when its projection cannot be read.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (summon?.id === previousSummonIdRef.current) return;
    previousSummonIdRef.current = summon?.id ?? null;
    if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current);
    rebaseTimerRef.current = null;
    setRebaseOffset(null);
    setExpanded(false);
    movementActiveRef.current = false;
    setMovementActive(false);
    setMovementSnapshot(INITIAL_MOVEMENT_SNAPSHOT);
    movementCompletionSubmittedRef.current = false;
    setBusy(false);
  }, [summon?.id]);

  useEffect(() => {
    movementActiveRef.current = movementActive;
  }, [movementActive]);

  const setBubbleOpen = async (open: boolean, focusAction = false): Promise<void> => {
    let beforePetPosition: { x: number; y: number } | null = null;
    const emberPreview = summon?.visual === "ember-starling";
    const emberGeometry = emberPreview && summon ? EMBER_PREVIEW_GEOMETRY[summon.petSize] : null;
    const collapsedCenter = emberGeometry ? { x: emberGeometry.collapsed.width / 2, y: emberGeometry.collapsed.height / 2 } : { x: 58, y: 44 };
    if (isNative()) {
      try {
        if (open) {
          beforePetPosition = {
            x: window.screenX + collapsedCenter.x,
            y: window.screenY + collapsedCenter.y,
          };
          await invoke("activate_completion_pet");
        }
        await invoke("set_completion_pet_expanded", { expanded: open });
      } catch {
        setExpanded(false);
        return;
      }
    }
    if (open && beforePetPosition) {
      setRebaseOffset({
        x: beforePetPosition.x - (window.screenX + 130),
        y: beforePetPosition.y - (window.screenY + (emberPreview ? 120 : 116)),
      });
      if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current);
      rebaseTimerRef.current = window.setTimeout(() => {
        setRebaseOffset(null);
        rebaseTimerRef.current = null;
      }, 420);
    } else if (!open) {
      setRebaseOffset(null);
    }
    setExpanded(open);
    if (open && focusAction) window.requestAnimationFrame(() => (summon?.preview ? closeActionRef.current : startActionRef.current)?.focus());
    if (!open && focusAction) window.requestAnimationFrame(() => companionRef.current?.focus());
  };

  const hide = async (): Promise<void> => {
    movementActiveRef.current = false;
    setMovementActive(false);
    setSummon(null);
    setExpanded(false);
    if (DEMO_PET || !isNative()) return;
    await invoke("hide_completion_pet").catch(() => undefined);
  };

  const submit = async (action: CompletionPetAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    if (DEMO_PET || !isNative()) {
      window.__AGENT_HALO_PET_ACTIONS__ = [...(window.__AGENT_HALO_PET_ACTIONS__ ?? []), action];
      movementActiveRef.current = false;
      setMovementActive(false);
      setSummon(null);
      return;
    }
    try {
      await invoke("submit_completion_pet_action", { action });
      movementActiveRef.current = false;
      setMovementActive(false);
      setSummon(null);
    } catch {
      setBusy(false);
    }
  };

  const startMovement = async (): Promise<void> => {
    if (busy || summon?.preview || !summon?.movementBreakEnabled) return;
    setBusy(true);
    const movementAttempt = movementAttemptRef.current + 1;
    movementAttemptRef.current = movementAttempt;
    movementCompletionSubmittedRef.current = false;
    setMovementSnapshot({ ...INITIAL_MOVEMENT_SNAPSHOT, status: "requesting", sessionId: `${summon.id}:${movementAttempt}`, guidance: "Waiting for Camera permission…" });
    if (DEMO_PET || !isNative()) {
      setMovementActive(true);
      setExpanded(false);
      setMovementSnapshot({ ...INITIAL_MOVEMENT_SNAPSHOT, status: "tracking", guidance: "Stand tall to begin" });
      setBusy(false);
      return;
    }
    try {
      await invoke("set_completion_pet_movement", { active: true, summonId: summon.id });
      movementActiveRef.current = true;
      setMovementActive(true);
      setExpanded(false);
      setBusy(false);
      if (SEARCH_PARAMS.has("demoMovementCompleted")) {
        setMovementSnapshot({ ...INITIAL_MOVEMENT_SNAPSHOT, status: "completed", repCount: 10, sessionId: `${summon.id}:${movementAttempt}`, guidance: "10 squats complete", depthProgress: 1 });
      } else if (SEARCH_PARAMS.has("demoCameraOff")) {
        setMovementSnapshot({ ...INITIAL_MOVEMENT_SNAPSHOT, status: "tracking", permission: "authorized", sessionId: `${summon.id}:${movementAttempt}`, guidance: "Stand tall to arm the counter" });
      }
      return;
    } catch (error) {
      setMovementSnapshot({
        ...INITIAL_MOVEMENT_SNAPSHOT,
        status: "error",
        guidance: "Camera could not start",
        error: error instanceof Error ? error.message : "Could not start the local pose session",
      });
      movementActiveRef.current = false;
      setMovementActive(false);
    } finally {
      setBusy(false);
    }
  };

  const cancelMovement = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    movementActiveRef.current = false;
    setMovementActive(false);
    setExpanded(true);
    setMovementSnapshot(INITIAL_MOVEMENT_SNAPSHOT);
    window.requestAnimationFrame(() => movementActionRef.current?.focus());
    if (DEMO_PET || !isNative()) {
      setBusy(false);
      return;
    }
    try {
      await invoke("set_completion_pet_movement", { active: false, summonId: summon?.id });
    } catch {
      setSummon(null);
      await invoke("hide_completion_pet").catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!movementActive || movementSnapshot.status !== "completed" || movementCompletionSubmittedRef.current) return undefined;
    movementCompletionSubmittedRef.current = true;
    const timer = window.setTimeout(() => void submit("movement-complete"), 1_600);
    return () => window.clearTimeout(timer);
  }, [movementActive, movementSnapshot.status]);

  const beginPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (expanded || event.button !== 0) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    draggingRef.current = false;
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragStartRef.current;
    if (!origin || expanded || draggingRef.current) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
    draggingRef.current = true;
    suppressClickRef.current = true;
    if (isNative()) void invoke("drag_completion_pet").catch(() => undefined);
  };

  const endPointer = (): void => {
    dragStartRef.current = null;
    if (draggingRef.current) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    draggingRef.current = false;
  };

  if (!summon) return <main className="completion-pet-root" data-visible="false" />;

  if (movementActive) {
    return (
      <main className="completion-pet-root" data-visible="true" data-movement="true">
        <Suspense fallback={<div className="movement-loading" role="status">Preparing local pose…</div>}>
          <MovementChallenge
            snapshot={movementSnapshot}
            busy={busy}
            cameraPreviewEnabled={isNative() && !SEARCH_PARAMS.has("demoCameraOff")}
            demoPoseEnabled={SEARCH_PARAMS.has("demoPose")}
            onCancel={() => void cancelMovement()}
            onRetry={() => void startMovement()}
            onSnapshot={setMovementSnapshot}
            onStartBreak={() => void submit("start-break")}
          />
        </Suspense>
      </main>
    );
  }

  const emberGeometry = summon.visual === "ember-starling" ? EMBER_PREVIEW_GEOMETRY[summon.petSize] : null;
  const emberOptionStyle = emberGeometry ? { zIndex: 4, border: "1px solid rgba(255, 255, 255, 0.2)" } : undefined;

  return (
    <main className="completion-pet-root" data-visible="true" data-expanded={expanded ? "true" : "false"} data-rebasing={rebaseOffset ? "true" : "false"} data-pet-size={summon.petSize} data-preview={summon.preview ? "true" : "false"} data-visual={summon.visual ?? "roster"} data-movement-option={summon.movementBreakEnabled ? "true" : "false"} style={rebaseOffset ? { "--pet-rebase-x": `${rebaseOffset.x}px`, "--pet-rebase-y": `${rebaseOffset.y}px` } as CSSProperties : undefined} onKeyDown={(event) => {
      if (!expanded || event.key !== "Escape") return;
      event.preventDefault();
      void setBubbleOpen(false, true);
    }}>
      <span className="sr-only" role="status" aria-live="polite">{summon.preview ? summon.visual === "ember-starling" ? "Ember Starling preview." : "Pet preview." : `Focus complete. ${summon.nextPhase === "long-break" ? "Long break" : "Short break"} ready.`}</span>
      {expanded ? (
        <section className="completion-pet-radial" role="dialog" aria-label={summon.preview ? summon.visual === "ember-starling" ? "Ember Starling preview controls" : "Pet preview controls" : "Focus complete actions"} id="completion-pet-actions">
          {summon.visual === "ember-starling" ? null : <span className="completion-pet-orbit" aria-hidden="true" />}
          {summon.preview ? null : (
            <>
              <button ref={startActionRef} className="completion-pet-option completion-pet-start" style={emberOptionStyle} type="button" disabled={busy} onClick={() => void submit("start-break")} aria-label={summon.actionLabel}>
                <Play size={21} strokeWidth={2.4} />
                <span>{busy ? "…" : <>{summon.nextPhase === "long-break" ? "Long" : "Short"}<br />break</>}</span>
              </button>
              {summon.movementBreakEnabled ? (
                <button ref={movementActionRef} className="completion-pet-option completion-pet-movement" style={emberGeometry ? { ...emberOptionStyle, top: 178, left: 102, width: 56, height: 56 } : undefined} type="button" disabled={busy} onClick={() => void startMovement()} aria-label="Start 10 Squats movement break">
                  <Dumbbell size={20} strokeWidth={2.3} />
                  <span>10×<br />Squats</span>
                </button>
              ) : null}
              <button className="completion-pet-option completion-pet-later" style={emberOptionStyle} type="button" disabled={busy} onClick={() => void hide()} aria-label="Not now">
                <Clock3 size={20} strokeWidth={2.2} />
                <span>Later</span>
              </button>
            </>
          )}
          <button ref={closeActionRef} className="completion-pet-option completion-pet-close" style={emberOptionStyle} type="button" disabled={busy} onClick={() => void hide()} aria-label={summon.preview && summon.visual === "ember-starling" ? "Hide Ember Starling preview" : "Hide completion pet"}>
            <X size={20} strokeWidth={2.25} />
            <span>Close</span>
          </button>
          {summon.visual === "ember-starling" && summon.preview ? null : <span className="completion-pet-context" style={emberGeometry ? { right: "auto", bottom: 8, left: "50%", width: "max-content", padding: "3px 7px", border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: 6, color: "#fff", background: "#000", transform: "translateX(-50%)" } : undefined}>{emberGeometry ? `${summon.nextPhase === "long-break" ? "Long" : "Short"} break ready` : summon.title}</span>}
        </section>
      ) : null}

      <div className="completion-pet-dock">
        <button
          ref={companionRef}
          className="completion-pet-companion"
          style={emberGeometry ? { width: emberGeometry.collapsed.width, height: emberGeometry.collapsed.height, ...(expanded ? emberGeometry.expanded : {}) } : undefined}
          type="button"
          aria-label={summon.preview ? summon.visual === "ember-starling" ? "Ember Starling preview. Open controls" : "Pet preview. Open controls" : "Focus complete. Open break actions"}
          aria-expanded={expanded}
          aria-controls="completion-pet-actions"
          onClick={() => {
            if (suppressClickRef.current) return;
            void setBubbleOpen(!expanded, true);
          }}
          onKeyDown={(event) => {
            if (!expanded && ["Enter", " "].includes(event.key)) {
              event.preventDefault();
              void setBubbleOpen(true, true);
            }
          }}
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          data-tauri-drag-region="false"
        >
          {emberGeometry ? <span className="completion-pet-ember-starling" style={emberGeometry.visual} aria-hidden="true" /> : <HaloPet className="completion-pet-visual" loadout={summon.loadout} pet={summon.pet} status="working" activityKind="session" />}
        </button>
      </div>
    </main>
  );
};

declare global {
  interface Window {
    __AGENT_HALO_PET_ACTIONS__?: CompletionPetAction[];
  }
}
