import { ArrowRight, Check, Coffee, Download, Focus } from "lucide-react";
import type { IAgentHaloBridgeCapabilities } from "@agent-halo/protocol";
import { shortenPath } from "../session/activity";

export interface ISetupPanelProps {
  capabilities: IAgentHaloBridgeCapabilities;
  canUseNativeControls: boolean;
  connectionTitle: string;
  guidance: { title: string; detail: string };
  isConnected: boolean;
  keepAwakeActive: boolean;
  keepAwakeEnabled: boolean;
  keepAwakeError: string | null;
  modStatus: { path: string | null; installed: boolean | null };
  nativeAction: { bridgeOnline: boolean | null; message: string | null };
  onCheckBridge: () => void;
  onInstallMod: () => void;
  onKeepAwakeChange: (enabled: boolean) => void;
}

export const SetupPanel = ({ capabilities, canUseNativeControls, connectionTitle, guidance, isConnected, keepAwakeActive, keepAwakeEnabled, keepAwakeError, modStatus, nativeAction, onCheckBridge, onInstallMod, onKeepAwakeChange }: ISetupPanelProps) => (
  <div className="setup-body">
    <div className="setup-row"><span className="bridge-dot" data-connected={isConnected} title={connectionTitle} /><span className="setup-copy"><span className="setup-title">Bridge</span><span className="setup-detail">{connectionTitle}</span></span><button className="pill-btn" type="button" onClick={onCheckBridge} data-tauri-drag-region="false"><Check size={12} strokeWidth={2.3} />Check</button></div>
    <div className="setup-row"><span className="status-slot"><Download className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Letta mod</span><span className="setup-detail">{modStatus.installed === true ? `Installed · ${shortenPath(modStatus.path)}` : modStatus.installed === false ? `Not installed · ${shortenPath(modStatus.path)}` : canUseNativeControls ? "Checking install state" : "Tauri runtime needed"}</span></span><button className="pill-btn accent" type="button" onClick={onInstallMod} data-tauri-drag-region="false"><Download size={12} strokeWidth={2.3} />{modStatus.installed ? "Reinstall" : "Install"}</button></div>
    <div className="setup-row passive"><span className="status-slot"><ArrowRight className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">{guidance.title}</span><span className="setup-detail">{guidance.detail}</span></span></div>
    <div className="setup-row passive"><span className="status-slot"><Focus className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Session controls</span><span className="setup-detail">{canUseNativeControls ? "Ghostty focus available · end unavailable" : capabilities.sessionActions.focusTerminal || capabilities.sessionActions.endSession ? "Focus/end available from bridge" : "Focus/end unavailable in current bridge"}</span></span></div>
    <div className="setup-row"><span className="status-slot"><Coffee className="setup-icon" size={14} strokeWidth={2.3} /></span><span className="setup-copy"><span className="setup-title">Keep display awake</span><span className="setup-detail">{!keepAwakeEnabled ? "Off · display follows macOS idle settings" : !canUseNativeControls ? "Desktop runtime required" : keepAwakeError ? `Unavailable · ${keepAwakeError}` : keepAwakeActive ? "Active · Letta is working" : "On · waiting for active work"}</span></span><button className={`pill-btn ${keepAwakeEnabled ? "accent" : ""}`} type="button" onClick={() => onKeepAwakeChange(!keepAwakeEnabled)} data-tauri-drag-region="false" aria-label={`${keepAwakeEnabled ? "Disable" : "Enable"} keep display awake`}>{keepAwakeEnabled ? "On" : "Off"}</button></div>
    {nativeAction.message ? <div className="notice-row" data-online={nativeAction.bridgeOnline === true} role="status" aria-live="polite">{nativeAction.message}</div> : null}
  </div>
);
