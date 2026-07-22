import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight, Bot, Check, Coffee, Download, Dumbbell, Focus, Monitor as MonitorIcon, Play, PlugZap, RefreshCw } from "lucide-react";
import type { IAgentHaloBridgeCapabilities } from "@agent-halo/protocol";
import { HALO_PET_ROSTER, type HaloPetName } from "../session/HaloPet";
import { HALO_BOT_LOADOUT_LABELS, HALO_BOT_LOADOUTS, type HaloBotLoadout } from "../session/haloBot";
import { shortenPath } from "../session/activity";
import { displayResolutionLabel, type IDisplayStateSnapshot } from "./display";
import type { CompletionPetSize } from "../pet/preferences";

type SetupCategory = "connection" | "pet" | "display";
const SETUP_CATEGORIES: SetupCategory[] = ["connection", "pet", "display"];
const COMPLETION_PET_SIZES: CompletionPetSize[] = ["small", "medium", "large"];

const completionPetSizeLabel = (size: CompletionPetSize): string => size === "small" ? "1×" : size === "medium" ? "1.5×" : "2×";

const PET_LABELS: Record<HaloPetName, string> = {
  "halo-bot": "Halo Bot",
  pot: "Pot",
  crawler: "Crawler",
  bat: "Bat",
  jelly: "Jelly",
  cat: "Cat",
  crt: "CRT",
  cactus: "Cactus",
  nautilus: "Nautilus",
  turtle: "Turtle",
  lantern: "Lantern",
  kettle: "Kettle",
  dragonfly: "Dragonfly",
  giraffe: "Giraffe",
  scorpion: "Scorpion",
  squid: "Squid",
  "ember-starling": "Ember Starling",
};

const petPreviewStyle = (pet: HaloPetName, loadout: HaloBotLoadout, compact = false) => ({
  backgroundImage: pet === "halo-bot"
    ? `url("/mascots/agent-halo-roster/body/halo-bot/${loadout}/idle.png")`
    : `url("/mascots/agent-halo-roster/body/${pet}/idle.${pet === "ember-starling" ? "webp" : "png"}")`,
  ...(["ember-starling", "halo-bot"].includes(pet) ? compact
    ? { height: 32, backgroundSize: "96px 32px", backgroundPosition: "0 0", imageRendering: "auto" }
    : { height: 52, backgroundSize: "156px 52px", imageRendering: "auto" }
    : {}),
  ...(pet === "halo-bot" ? { imageRendering: "pixelated" } : {}),
}) as CSSProperties;

export interface ISetupPanelProps {
  capabilities: IAgentHaloBridgeCapabilities;
  canUseNativeControls: boolean;
  connectionTitle: string;
  guidance: { title: string; detail: string };
  isConnected: boolean;
  keepAwakeActive: boolean;
  keepAwakeEnabled: boolean;
  keepAwakeError: string | null;
  displayError: string | null;
  displayLoading: boolean;
  displayState: IDisplayStateSnapshot | null;
  modStatus: { path: string | null; installed: boolean | null };
  nativeAction: { bridgeOnline: boolean | null; message: string | null };
  pet: HaloPetName;
  haloBotLoadout: HaloBotLoadout;
  completionPetEnabled: boolean;
  completionPetSize: CompletionPetSize;
  movementBreakEnabled: boolean;
  petPreviewStatus: string | null;
  petPreviewState: "idle" | "showing" | "shown" | "stale" | "error";
  onCheckBridge: () => void;
  onInstallMod: () => void;
  onDisplayChange: (displayId: string) => Promise<void>;
  onDisplayRefresh: () => Promise<void>;
  onKeepAwakeChange: (enabled: boolean) => void;
  onPetChange: (pet: HaloPetName) => void;
  onHaloBotLoadoutChange: (loadout: HaloBotLoadout) => void;
  onCompletionPetEnabledChange: (enabled: boolean) => void;
  onCompletionPetSizeChange: (size: CompletionPetSize) => void;
  onMovementBreakEnabledChange: (enabled: boolean) => void;
  onShowPetPreview: () => Promise<void>;
}

export const SetupPanel = ({ capabilities, canUseNativeControls, completionPetEnabled, completionPetSize, connectionTitle, displayError, displayLoading, displayState, guidance, haloBotLoadout, isConnected, keepAwakeActive, keepAwakeEnabled, keepAwakeError, movementBreakEnabled, pet, petPreviewState, petPreviewStatus, modStatus, nativeAction, onCheckBridge, onCompletionPetEnabledChange, onCompletionPetSizeChange, onDisplayChange, onDisplayRefresh, onHaloBotLoadoutChange, onInstallMod, onKeepAwakeChange, onMovementBreakEnabledChange, onPetChange, onShowPetPreview }: ISetupPanelProps) => {
  const [activeCategory, setActiveCategory] = useState<SetupCategory>("connection");
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia("(max-width: 380px)").matches);
  const [petPickerOpen, setPetPickerOpen] = useState(false);
  const [loadoutPickerOpen, setLoadoutPickerOpen] = useState(false);
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false);
  const petPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const loadoutPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const displayPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const displayInteractionBusyRef = useRef(false);
  const displays = displayState?.displays ?? [];
  const activeDisplay = displays.find((display) => display.id === displayState?.activeDisplayId) ?? null;
  const displayRadioSelection = displayState?.selectedDisplayId ?? null;
  const displayFocusTarget = displayRadioSelection ?? displayState?.activeDisplayId ?? null;

  const focusPet = (selection: HaloPetName): void => {
    window.requestAnimationFrame(() => document.getElementById(`pet-option-${selection}`)?.focus());
  };

  const focusHaloBotLoadout = (selection: HaloBotLoadout): void => {
    window.requestAnimationFrame(() => document.getElementById(`halo-bot-loadout-${selection}`)?.focus());
  };

  const closePetPicker = (): void => {
    setPetPickerOpen(false);
    window.requestAnimationFrame(() => petPickerTriggerRef.current?.focus());
  };

  const closeDisplayPicker = (): void => {
    setDisplayPickerOpen(false);
    window.requestAnimationFrame(() => displayPickerTriggerRef.current?.focus());
  };

  const handlePetKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: HaloPetName): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePetPicker();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = HALO_PET_ROSTER.indexOf(current);
    const rowSize = 4;
    const delta = event.key === "ArrowLeft"
      ? -1
      : event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp"
          ? -rowSize
          : event.key === "ArrowDown"
            ? rowSize
            : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? HALO_PET_ROSTER.length - 1
        : (currentIndex + delta + HALO_PET_ROSTER.length) % HALO_PET_ROSTER.length;
    const nextPet = HALO_PET_ROSTER[nextIndex] ?? pet;
    onPetChange(nextPet);
    focusPet(nextPet);
  };

  const handleHaloBotLoadoutKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: HaloBotLoadout): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = HALO_BOT_LOADOUTS.indexOf(current);
    const rowSize = 5;
    const delta = event.key === "ArrowLeft"
      ? -1
      : event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp"
          ? -rowSize
          : event.key === "ArrowDown"
            ? rowSize
            : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? HALO_BOT_LOADOUTS.length - 1
        : (currentIndex + delta + HALO_BOT_LOADOUTS.length) % HALO_BOT_LOADOUTS.length;
    const next = HALO_BOT_LOADOUTS[nextIndex] ?? haloBotLoadout;
    onHaloBotLoadoutChange(next);
    focusHaloBotLoadout(next);
  };

  const handleDisplayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDisplayPicker();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || displays.length === 0 || displayInteractionBusyRef.current || displayLoading) return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? displays.length - 1
        : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + displays.length) % displays.length;
    const nextDisplay = displays[nextIndex];
    if (!nextDisplay) return;
    displayInteractionBusyRef.current = true;
    void onDisplayChange(nextDisplay.id).finally(() => {
      displayInteractionBusyRef.current = false;
    });
    window.requestAnimationFrame(() => document.getElementById(`display-option-${nextIndex}`)?.focus());
  };

  const selectCategory = (category: SetupCategory): void => {
    setPetPickerOpen(false);
    setLoadoutPickerOpen(false);
    setDisplayPickerOpen(false);
    setActiveCategory(category);
  };

  const handleCategoryKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: SetupCategory): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = SETUP_CATEGORIES.indexOf(current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? SETUP_CATEGORIES.length - 1 : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + SETUP_CATEGORIES.length) % SETUP_CATEGORIES.length;
    const next = SETUP_CATEGORIES[nextIndex] ?? "connection";
    selectCategory(next);
    window.requestAnimationFrame(() => document.getElementById(`setup-tab-${next}`)?.focus());
  };

  const handlePetSizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: CompletionPetSize): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = COMPLETION_PET_SIZES.indexOf(current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? COMPLETION_PET_SIZES.length - 1 : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + COMPLETION_PET_SIZES.length) % COMPLETION_PET_SIZES.length;
    const next = COMPLETION_PET_SIZES[nextIndex] ?? "large";
    onCompletionPetSizeChange(next);
    window.requestAnimationFrame(() => document.getElementById(`completion-pet-size-${next}`)?.focus());
  };

  useEffect(() => {
    if (petPickerOpen) focusPet(pet);
  }, [petPickerOpen]);

  useEffect(() => {
    if (pet !== "halo-bot") setLoadoutPickerOpen(false);
  }, [pet]);

  useEffect(() => {
    if (!displayPickerOpen || displayLoading) return;
    const selectedIndex = Math.max(0, displays.findIndex((display) => display.id === displayFocusTarget));
    window.requestAnimationFrame(() => document.getElementById(`display-option-${selectedIndex}`)?.focus());
  }, [displayPickerOpen, displayFocusTarget, displayLoading, displays.length]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 380px)");
    const update = () => setCompactNavigation(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className="setup-body">
      <div className="setup-layout">
        <div className="setup-sidebar" role="tablist" aria-label="Setup sections" aria-orientation={compactNavigation ? "horizontal" : "vertical"}>
          <button className="setup-side-tab" id="setup-tab-connection" type="button" role="tab" aria-selected={activeCategory === "connection"} aria-controls="setup-panel-connection" tabIndex={activeCategory === "connection" ? 0 : -1} data-active={activeCategory === "connection"} onClick={() => selectCategory("connection")} onKeyDown={(event) => handleCategoryKeyDown(event, "connection")}><PlugZap size={12} strokeWidth={2.2} /><span>Connection</span></button>
          <button className="setup-side-tab" id="setup-tab-pet" type="button" role="tab" aria-selected={activeCategory === "pet"} aria-controls="setup-panel-pet" tabIndex={activeCategory === "pet" ? 0 : -1} data-active={activeCategory === "pet"} onClick={() => selectCategory("pet")} onKeyDown={(event) => handleCategoryKeyDown(event, "pet")}><Bot size={12} strokeWidth={2.2} /><span>Pet</span></button>
          <button className="setup-side-tab" id="setup-tab-display" type="button" role="tab" aria-selected={activeCategory === "display"} aria-controls="setup-panel-display" tabIndex={activeCategory === "display" ? 0 : -1} data-active={activeCategory === "display"} onClick={() => selectCategory("display")} onKeyDown={(event) => handleCategoryKeyDown(event, "display")}><MonitorIcon size={12} strokeWidth={2.2} /><span>Display</span></button>
        </div>

        <div className="setup-category-panel" id={`setup-panel-${activeCategory}`} role="tabpanel" aria-labelledby={`setup-tab-${activeCategory}`}>
          {activeCategory === "connection" ? (
            <>
              <div className="setup-section-heading"><span>Connection</span><small>Bridge and Letta integration</small></div>
              <div className="setup-row"><span className="bridge-dot" data-connected={isConnected} title={connectionTitle} /><span className="setup-copy"><span className="setup-title">Bridge</span><span className="setup-detail">{connectionTitle}</span></span><button className="pill-btn" type="button" onClick={onCheckBridge} data-tauri-drag-region="false"><Check size={12} strokeWidth={2.3} />Check</button></div>
              <div className="setup-row"><span className="status-slot"><Download className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Letta mod</span><span className="setup-detail">{modStatus.installed === true ? `Installed · ${shortenPath(modStatus.path)}` : modStatus.installed === false ? `Not installed · ${shortenPath(modStatus.path)}` : canUseNativeControls ? "Checking install state" : "Tauri runtime needed"}</span></span><button className="pill-btn accent" type="button" onClick={onInstallMod} data-tauri-drag-region="false"><Download size={12} strokeWidth={2.3} />{modStatus.installed ? "Reinstall" : "Install"}</button></div>
              <div className="setup-row passive"><span className="status-slot"><ArrowRight className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">{guidance.title}</span><span className="setup-detail">{guidance.detail}</span></span></div>
              <div className="setup-row passive"><span className="status-slot"><Focus className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Session controls</span><span className="setup-detail">{canUseNativeControls ? "Ghostty focus available · end unavailable" : capabilities.sessionActions.focusTerminal || capabilities.sessionActions.endSession ? "Focus/end available from bridge" : "Focus/end unavailable in current bridge"}</span></span></div>
              {nativeAction.message ? <div className="notice-row" data-online={nativeAction.bridgeOnline === true} role="status" aria-live="polite">{nativeAction.message}</div> : null}
            </>
          ) : null}

          {activeCategory === "pet" ? (
            <>
              <div className="setup-section-heading"><span>Pet</span><small>Companion identity and completion preview</small></div>
              <div className="setup-row pet-setting-row"><span className="pet-current-preview" data-pet={pet} style={petPreviewStyle(pet, haloBotLoadout)} aria-hidden="true" /><span className="setup-copy"><span className="setup-title">{PET_LABELS[pet]}</span><span className="setup-detail" id="pet-preview-availability">{pet === "halo-bot" ? `${HALO_BOT_LOADOUT_LABELS[haloBotLoadout]} loadout · used across Agent Halo` : canUseNativeControls ? "Used across Agent Halo" : "Desktop runtime required to preview"}</span></span><span className="setup-row-actions"><button ref={petPickerTriggerRef} className="pill-btn" type="button" onClick={() => { if (petPickerOpen) closePetPicker(); else { setLoadoutPickerOpen(false); setPetPickerOpen(true); } }} data-tauri-drag-region="false" aria-controls="pet-picker" aria-expanded={petPickerOpen}><Bot size={12} strokeWidth={2.3} />{petPickerOpen ? "Close" : "Choose"}</button><button className={`pill-btn accent pet-preview-button ${petPreviewState === "stale" ? "is-stale" : ""}`} type="button" disabled={!canUseNativeControls || petPreviewState === "showing"} onClick={() => void onShowPetPreview()} data-tauri-drag-region="false" aria-label={petPreviewState === "stale" ? "Update Completion Pet preview" : "Show Completion Pet preview"} aria-describedby="pet-preview-availability">{petPreviewState === "stale" ? <RefreshCw size={12} strokeWidth={2.3} /> : petPreviewState === "shown" ? <Check size={12} strokeWidth={2.3} /> : <Play size={12} strokeWidth={2.3} />}{petPreviewState === "showing" ? "Showing…" : petPreviewState === "stale" ? "Update Pet" : petPreviewState === "shown" ? "Show again" : "Show Pet"}</button></span></div>
              {petPickerOpen ? (
                <div className="pet-picker" id="pet-picker" role="radiogroup" aria-label="Pet">
                  {HALO_PET_ROSTER.map((option) => (
                    <button className="pet-option" data-selected={option === pet} id={`pet-option-${option}`} type="button" role="radio" aria-checked={option === pet} tabIndex={option === pet ? 0 : -1} onClick={() => { onPetChange(option); closePetPicker(); }} onKeyDown={(event) => handlePetKeyDown(event, option)} data-tauri-drag-region="false" key={option} title={PET_LABELS[option]}><span className="pet-option-sprite" data-pet={option} style={petPreviewStyle(option, haloBotLoadout, true)} aria-hidden="true" /><span>{PET_LABELS[option]}</span></button>
                  ))}
                </div>
              ) : null}
              {pet === "halo-bot" && !petPickerOpen ? (
                <div className="halo-bot-loadout-disclosure">
                  <span>Loadout · {HALO_BOT_LOADOUT_LABELS[haloBotLoadout]}</span>
                  <button ref={loadoutPickerTriggerRef} className="pill-btn" type="button" aria-controls="halo-bot-loadout-picker" aria-expanded={loadoutPickerOpen} onClick={() => setLoadoutPickerOpen((current) => !current)} data-tauri-drag-region="false">{loadoutPickerOpen ? "Close" : "Change"}</button>
                </div>
              ) : null}
              {pet === "halo-bot" && loadoutPickerOpen && !petPickerOpen ? (
                <div className="halo-bot-loadout-picker" id="halo-bot-loadout-picker" role="radiogroup" aria-label="Halo Bot loadout">
                  {HALO_BOT_LOADOUTS.map((loadout) => (
                    <button className="pet-option halo-bot-loadout-option" data-selected={loadout === haloBotLoadout} id={`halo-bot-loadout-${loadout}`} type="button" role="radio" aria-checked={loadout === haloBotLoadout} tabIndex={loadout === haloBotLoadout ? 0 : -1} onClick={() => onHaloBotLoadoutChange(loadout)} onKeyDown={(event) => handleHaloBotLoadoutKeyDown(event, loadout)} data-tauri-drag-region="false" key={loadout} title={`${HALO_BOT_LOADOUT_LABELS[loadout]} · ${loadout}`}>
                      <span className="pet-option-sprite" style={petPreviewStyle("halo-bot", loadout, true)} aria-hidden="true" />
                      <span>{HALO_BOT_LOADOUT_LABELS[loadout]}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="setup-row"><span className="status-slot"><Bot className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Completion Pet size</span><span className="setup-detail">Changes only the floating Pet</span></span><span className="setup-size-options" role="radiogroup" aria-label="Completion Pet size">{COMPLETION_PET_SIZES.map((size) => <button id={`completion-pet-size-${size}`} type="button" role="radio" aria-checked={completionPetSize === size} tabIndex={completionPetSize === size ? 0 : -1} data-active={completionPetSize === size} onClick={() => onCompletionPetSizeChange(size)} onKeyDown={(event) => handlePetSizeKeyDown(event, size)} data-tauri-drag-region="false" key={size}>{completionPetSizeLabel(size)}</button>)}</span></div>
              <div className="setup-row"><span className="status-slot"><Bot className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Completion Pet</span><span className="setup-detail">{completionPetEnabled ? "Shows after a completed Focus" : "Off · uses a macOS notification"}</span></span><button className={`pill-btn ${completionPetEnabled ? "accent" : ""}`} type="button" role="switch" aria-checked={completionPetEnabled} onClick={() => onCompletionPetEnabledChange(!completionPetEnabled)} data-tauri-drag-region="false" aria-label={`${completionPetEnabled ? "Disable" : "Enable"} completion pet`}>{completionPetEnabled ? "On" : "Off"}</button></div>
              <div className="setup-row"><span className="status-slot"><Dumbbell className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Movement break</span><span className="setup-detail">{movementBreakEnabled ? "10 squats · camera only after you choose it" : "Off · hidden from future completions"}</span></span><button className={`pill-btn ${movementBreakEnabled ? "accent" : ""}`} type="button" role="switch" aria-checked={movementBreakEnabled} onClick={() => onMovementBreakEnabledChange(!movementBreakEnabled)} data-tauri-drag-region="false" aria-label={`${movementBreakEnabled ? "Disable" : "Enable"} movement break`}>{movementBreakEnabled ? "On" : "Off"}</button></div>
              {movementBreakEnabled ? <div className="notice-row movement-privacy-note" role="note">Camera opens only after 10 Squats is clicked. Pose analysis stays on this Mac; no video or audio is saved.</div> : null}
              {petPreviewStatus ? <div className="notice-row pet-preview-status" data-state={petPreviewState} data-online={petPreviewState === "shown"} role="status" aria-live="polite">{petPreviewStatus}</div> : null}
            </>
          ) : null}

          {activeCategory === "display" ? (
            <>
              <div className="setup-section-heading"><span>Display</span><small>Screen placement and power behavior</small></div>
              <div className="setup-row display-setting-row"><span className="status-slot"><MonitorIcon className="setup-icon" size={14} strokeWidth={2.2} /></span><span className="setup-copy"><span className="setup-title">Target display</span><span className="setup-detail">{!canUseNativeControls ? "Desktop runtime required" : displayLoading ? "Reading connected displays" : displayError ? displayError : displayState?.fallbackActive ? `${displayState.preferredDisplayName || "Saved display"} unavailable · using ${activeDisplay?.name ?? "Primary"}` : activeDisplay ? `${activeDisplay.name} · ${displayResolutionLabel(activeDisplay)}${activeDisplay.isPrimary ? " · Primary" : ""}` : "No connected display found"}</span></span><button ref={displayPickerTriggerRef} className="pill-btn" type="button" disabled={!canUseNativeControls || displays.length === 0} aria-busy={displayLoading} onClick={() => { if (displayPickerOpen) closeDisplayPicker(); else { setDisplayPickerOpen(true); void onDisplayRefresh(); } }} data-tauri-drag-region="false" aria-controls="display-picker" aria-expanded={displayPickerOpen}><MonitorIcon size={12} strokeWidth={2.2} />{displayPickerOpen ? "Close" : "Choose"}</button></div>
              {displayPickerOpen ? (
                <div className="display-picker" id="display-picker" role="radiogroup" aria-label="Display" aria-busy={displayLoading}>{displays.map((display, index) => <button className="display-option" data-selected={display.id === displayRadioSelection} disabled={displayLoading} id={`display-option-${index}`} type="button" role="radio" aria-checked={display.id === displayRadioSelection} tabIndex={display.id === displayFocusTarget ? 0 : -1} onClick={() => { if (displayInteractionBusyRef.current) return; displayInteractionBusyRef.current = true; void onDisplayChange(display.id).finally(() => { displayInteractionBusyRef.current = false; }); closeDisplayPicker(); }} onKeyDown={(event) => handleDisplayKeyDown(event, index)} data-tauri-drag-region="false" key={display.id}><MonitorIcon size={16} strokeWidth={2.1} aria-hidden="true" /><span className="display-option-copy"><span>{display.name}</span><small>{displayResolutionLabel(display)}{display.isPrimary ? " · Primary" : ""}</small></span><span className="display-option-mark" aria-hidden="true">{display.id === displayRadioSelection ? "✓" : ""}</span></button>)}</div>
              ) : null}
              <div className="setup-row"><span className="status-slot"><Coffee className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Keep display awake</span><span className="setup-detail">{!keepAwakeEnabled ? "Off · display follows macOS idle settings" : !canUseNativeControls ? "Desktop runtime required" : keepAwakeError ? `Unavailable · ${keepAwakeError}` : keepAwakeActive ? "Active · Letta is working" : "On · waiting for active work"}</span></span><button className={`pill-btn ${keepAwakeEnabled ? "accent" : ""}`} type="button" onClick={() => onKeepAwakeChange(!keepAwakeEnabled)} data-tauri-drag-region="false" aria-label={`${keepAwakeEnabled ? "Disable" : "Enable"} keep display awake`}>{keepAwakeEnabled ? "On" : "Off"}</button></div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
