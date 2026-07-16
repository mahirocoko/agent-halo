import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRight, Bot, Check, Coffee, Download, Focus, Monitor as MonitorIcon } from "lucide-react";
import type { IAgentHaloBridgeCapabilities } from "@agent-halo/protocol";
import { HALO_MASCOT_ROSTER, type HaloMascotName } from "../session/HaloMascot";
import { shortenPath } from "../session/activity";
import { displayResolutionLabel, type IDisplayStateSnapshot } from "./display";

const MASCOT_LABELS: Record<HaloMascotName, string> = {
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
};

const mascotPreviewStyle = (mascot: HaloMascotName) => ({
  backgroundImage: `url("/mascots/agent-halo-roster/body/${mascot}/idle.png")`,
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
  mascot: HaloMascotName;
  onCheckBridge: () => void;
  onInstallMod: () => void;
  onDisplayChange: (displayId: string) => Promise<void>;
  onDisplayRefresh: () => Promise<void>;
  onKeepAwakeChange: (enabled: boolean) => void;
  onMascotChange: (mascot: HaloMascotName) => void;
}

export const SetupPanel = ({ capabilities, canUseNativeControls, connectionTitle, displayError, displayLoading, displayState, guidance, isConnected, keepAwakeActive, keepAwakeEnabled, keepAwakeError, mascot, modStatus, nativeAction, onCheckBridge, onDisplayChange, onDisplayRefresh, onInstallMod, onKeepAwakeChange, onMascotChange }: ISetupPanelProps) => {
  const [mascotPickerOpen, setMascotPickerOpen] = useState(false);
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false);
  const mascotPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const displayPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const displayInteractionBusyRef = useRef(false);
  const displays = displayState?.displays ?? [];
  const activeDisplay = displays.find((display) => display.id === displayState?.activeDisplayId) ?? null;
  const displayRadioSelection = displayState?.selectedDisplayId ?? null;
  const displayFocusTarget = displayRadioSelection ?? displayState?.activeDisplayId ?? null;

  const focusMascot = (selection: HaloMascotName): void => {
    window.requestAnimationFrame(() => document.getElementById(`mascot-option-${selection}`)?.focus());
  };

  const closeMascotPicker = (): void => {
    setMascotPickerOpen(false);
    window.requestAnimationFrame(() => mascotPickerTriggerRef.current?.focus());
  };

  const closeDisplayPicker = (): void => {
    setDisplayPickerOpen(false);
    window.requestAnimationFrame(() => displayPickerTriggerRef.current?.focus());
  };

  const handleMascotKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: HaloMascotName): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMascotPicker();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = HALO_MASCOT_ROSTER.indexOf(current);
    const rowSize = 8;
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
        ? HALO_MASCOT_ROSTER.length - 1
        : (currentIndex + delta + HALO_MASCOT_ROSTER.length) % HALO_MASCOT_ROSTER.length;
    const nextMascot = HALO_MASCOT_ROSTER[nextIndex] ?? mascot;
    onMascotChange(nextMascot);
    focusMascot(nextMascot);
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

  useEffect(() => {
    if (mascotPickerOpen) focusMascot(mascot);
  }, [mascotPickerOpen]);

  useEffect(() => {
    if (!displayPickerOpen || displayLoading) return;
    const selectedIndex = Math.max(0, displays.findIndex((display) => display.id === displayFocusTarget));
    window.requestAnimationFrame(() => document.getElementById(`display-option-${selectedIndex}`)?.focus());
  }, [displayPickerOpen, displayFocusTarget, displayLoading, displays.length]);

  return (
    <div className="setup-body">
      <div className="setup-row"><span className="bridge-dot" data-connected={isConnected} title={connectionTitle} /><span className="setup-copy"><span className="setup-title">Bridge</span><span className="setup-detail">{connectionTitle}</span></span><button className="pill-btn" type="button" onClick={onCheckBridge} data-tauri-drag-region="false"><Check size={12} strokeWidth={2.3} />Check</button></div>
      <div className="setup-row"><span className="status-slot"><Download className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Letta mod</span><span className="setup-detail">{modStatus.installed === true ? `Installed · ${shortenPath(modStatus.path)}` : modStatus.installed === false ? `Not installed · ${shortenPath(modStatus.path)}` : canUseNativeControls ? "Checking install state" : "Tauri runtime needed"}</span></span><button className="pill-btn accent" type="button" onClick={onInstallMod} data-tauri-drag-region="false"><Download size={12} strokeWidth={2.3} />{modStatus.installed ? "Reinstall" : "Install"}</button></div>
      <div className="setup-row passive"><span className="status-slot"><ArrowRight className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">{guidance.title}</span><span className="setup-detail">{guidance.detail}</span></span></div>
      <div className="setup-row passive"><span className="status-slot"><Focus className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Session controls</span><span className="setup-detail">{canUseNativeControls ? "Ghostty focus available · end unavailable" : capabilities.sessionActions.focusTerminal || capabilities.sessionActions.endSession ? "Focus/end available from bridge" : "Focus/end unavailable in current bridge"}</span></span></div>
      <div className="setup-row mascot-setting-row"><span className="mascot-current-preview" style={mascotPreviewStyle(mascot)} aria-hidden="true" /><span className="setup-copy"><span className="setup-title">Mascot</span><span className="setup-detail">{MASCOT_LABELS[mascot]} · used for every session</span></span><button ref={mascotPickerTriggerRef} className="pill-btn" type="button" onClick={() => { if (mascotPickerOpen) closeMascotPicker(); else { setDisplayPickerOpen(false); setMascotPickerOpen(true); } }} data-tauri-drag-region="false" aria-controls="mascot-picker" aria-expanded={mascotPickerOpen}><Bot size={12} strokeWidth={2.3} />{mascotPickerOpen ? "Close" : "Choose"}</button></div>
      {mascotPickerOpen ? (
        <div className="mascot-picker" id="mascot-picker" role="radiogroup" aria-label="Mascot">
          {HALO_MASCOT_ROSTER.map((option) => (
            <button className="mascot-option" data-selected={option === mascot} id={`mascot-option-${option}`} type="button" role="radio" aria-checked={option === mascot} tabIndex={option === mascot ? 0 : -1} onClick={() => { onMascotChange(option); closeMascotPicker(); }} onKeyDown={(event) => handleMascotKeyDown(event, option)} data-tauri-drag-region="false" key={option} title={MASCOT_LABELS[option]}>
              <span className="mascot-option-sprite" style={mascotPreviewStyle(option)} aria-hidden="true" />
              <span>{MASCOT_LABELS[option]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="setup-row display-setting-row"><span className="status-slot"><MonitorIcon className="setup-icon" size={14} strokeWidth={2.2} /></span><span className="setup-copy"><span className="setup-title">Display</span><span className="setup-detail">{!canUseNativeControls ? "Desktop runtime required" : displayLoading ? "Reading connected displays" : displayError ? displayError : displayState?.fallbackActive ? `${displayState.preferredDisplayName || "Saved display"} unavailable · using ${activeDisplay?.name ?? "Primary"}` : activeDisplay ? `${activeDisplay.name} · ${displayResolutionLabel(activeDisplay)}${activeDisplay.isPrimary ? " · Primary" : ""}` : "No connected display found"}</span></span><button ref={displayPickerTriggerRef} className="pill-btn" type="button" disabled={!canUseNativeControls || displays.length === 0} aria-busy={displayLoading} onClick={() => { if (displayPickerOpen) closeDisplayPicker(); else { setMascotPickerOpen(false); setDisplayPickerOpen(true); void onDisplayRefresh(); } }} data-tauri-drag-region="false" aria-controls="display-picker" aria-expanded={displayPickerOpen}><MonitorIcon size={12} strokeWidth={2.2} />{displayPickerOpen ? "Close" : "Choose"}</button></div>
      {displayPickerOpen ? (
        <div className="display-picker" id="display-picker" role="radiogroup" aria-label="Display" aria-busy={displayLoading}>
          {displays.map((display, index) => (
            <button className="display-option" data-selected={display.id === displayRadioSelection} disabled={displayLoading} id={`display-option-${index}`} type="button" role="radio" aria-checked={display.id === displayRadioSelection} tabIndex={display.id === displayFocusTarget ? 0 : -1} onClick={() => { if (displayInteractionBusyRef.current) return; displayInteractionBusyRef.current = true; void onDisplayChange(display.id).finally(() => { displayInteractionBusyRef.current = false; }); closeDisplayPicker(); }} onKeyDown={(event) => handleDisplayKeyDown(event, index)} data-tauri-drag-region="false" key={display.id}>
              <MonitorIcon size={16} strokeWidth={2.1} aria-hidden="true" />
              <span className="display-option-copy"><span>{display.name}</span><small>{displayResolutionLabel(display)}{display.isPrimary ? " · Primary" : ""}</small></span>
              <span className="display-option-mark" aria-hidden="true">{display.id === displayRadioSelection ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="setup-row"><span className="status-slot"><Coffee className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Keep display awake</span><span className="setup-detail">{!keepAwakeEnabled ? "Off · display follows macOS idle settings" : !canUseNativeControls ? "Desktop runtime required" : keepAwakeError ? `Unavailable · ${keepAwakeError}` : keepAwakeActive ? "Active · Letta is working" : "On · waiting for active work"}</span></span><button className={`pill-btn ${keepAwakeEnabled ? "accent" : ""}`} type="button" onClick={() => onKeepAwakeChange(!keepAwakeEnabled)} data-tauri-drag-region="false" aria-label={`${keepAwakeEnabled ? "Disable" : "Enable"} keep display awake`}>{keepAwakeEnabled ? "On" : "Off"}</button></div>
      {nativeAction.message ? <div className="notice-row" data-online={nativeAction.bridgeOnline === true} role="status" aria-live="polite">{nativeAction.message}</div> : null}
    </div>
  );
};
