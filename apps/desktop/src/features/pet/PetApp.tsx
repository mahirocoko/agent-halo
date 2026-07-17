import { invoke } from "@tauri-apps/api/core";
import { Clock3, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { HaloPet } from "../session/HaloPet";
import type { CompletionPetAction, ICompletionPetNativeState, ICompletionPetSummon } from "./types";

const POLL_MS = 200;
const DRAG_THRESHOLD_PX = 4;
const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const DEMO_PET = SEARCH_PARAMS.has("demoPet");

const DEMO_SUMMON: ICompletionPetSummon = {
  schemaVersion: 1,
  id: "demo-focus-complete",
  pet: "scorpion",
  petSize: "large",
  preview: false,
  nextPhase: "short-break",
  title: "Focus complete",
  actionLabel: "Start Short break",
};

const isNative = (): boolean => typeof window.__TAURI_INTERNALS__ !== "undefined";

export const PetApp = () => {
  const [summon, setSummon] = useState<ICompletionPetSummon | null>(DEMO_PET ? DEMO_SUMMON : null);
  const [expanded, setExpanded] = useState(SEARCH_PARAMS.has("demoPetExpanded"));
  const [busy, setBusy] = useState(false);
  const [rebaseOffset, setRebaseOffset] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const startActionRef = useRef<HTMLButtonElement | null>(null);
  const closeActionRef = useRef<HTMLButtonElement | null>(null);
  const companionRef = useRef<HTMLButtonElement | null>(null);
  const previousSummonIdRef = useRef<string | null>(summon?.id ?? null);
  const rebaseTimerRef = useRef<number | null>(null);

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
    setBusy(false);
  }, [summon?.id]);

  const setBubbleOpen = async (open: boolean, focusAction = false): Promise<void> => {
    let beforePetPosition: { x: number; y: number } | null = null;
    if (isNative()) {
      try {
        if (open) {
          beforePetPosition = { x: window.screenX + 58, y: window.screenY + 44 };
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
        y: beforePetPosition.y - (window.screenY + 116),
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
      setSummon(null);
      return;
    }
    try {
      await invoke("submit_completion_pet_action", { action });
      setSummon(null);
    } catch {
      setBusy(false);
    }
  };

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

  return (
    <main className="completion-pet-root" data-visible="true" data-expanded={expanded ? "true" : "false"} data-rebasing={rebaseOffset ? "true" : "false"} data-pet-size={summon.petSize} data-preview={summon.preview ? "true" : "false"} style={rebaseOffset ? { "--pet-rebase-x": `${rebaseOffset.x}px`, "--pet-rebase-y": `${rebaseOffset.y}px` } as CSSProperties : undefined} onKeyDown={(event) => {
      if (!expanded || event.key !== "Escape") return;
      event.preventDefault();
      void setBubbleOpen(false, true);
    }}>
      <span className="sr-only" role="status" aria-live="polite">{summon.preview ? "Pet preview." : `Focus complete. ${summon.nextPhase === "long-break" ? "Long break" : "Short break"} ready.`}</span>
      {expanded ? (
        <section className="completion-pet-radial" role="dialog" aria-label={summon.preview ? "Pet preview controls" : "Focus complete actions"} id="completion-pet-actions">
          <span className="completion-pet-orbit" aria-hidden="true" />
          {summon.preview ? null : (
            <>
              <button ref={startActionRef} className="completion-pet-option completion-pet-start" type="button" disabled={busy} onClick={() => void submit("start-break")} aria-label={summon.actionLabel}>
                <Play size={21} strokeWidth={2.4} />
                <span>{busy ? "…" : summon.nextPhase === "long-break" ? "Long" : "Start"}</span>
              </button>
              <button className="completion-pet-option completion-pet-later" type="button" disabled={busy} onClick={() => void hide()} aria-label="Not now">
                <Clock3 size={20} strokeWidth={2.2} />
                <span>Later</span>
              </button>
            </>
          )}
          <button ref={closeActionRef} className="completion-pet-option completion-pet-close" type="button" disabled={busy} onClick={() => void hide()} aria-label="Hide completion pet">
            <X size={20} strokeWidth={2.25} />
            <span>Close</span>
          </button>
          <span className="completion-pet-context">{summon.title}</span>
        </section>
      ) : null}

      <div className="completion-pet-dock">
        <button
          ref={companionRef}
          className="completion-pet-companion"
          type="button"
          aria-label={summon.preview ? "Pet preview. Open controls" : "Focus complete. Open break actions"}
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
          <HaloPet className="completion-pet-visual" pet={summon.pet} status="working" activityKind="session" />
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
