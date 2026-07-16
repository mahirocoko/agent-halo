import type { CSSProperties } from "react";
import type { ActivityKind, ISessionSummary } from "./types";

export const HALO_MASCOT_ROSTER = [
  "pot",
  "crawler",
  "bat",
  "jelly",
  "cat",
  "crt",
  "cactus",
  "nautilus",
  "turtle",
  "lantern",
  "kettle",
  "dragonfly",
  "giraffe",
  "scorpion",
  "squid",
] as const;
export type HaloMascotName = (typeof HALO_MASCOT_ROSTER)[number];
type HaloMascotState = "idle" | "working" | "attention" | "done" | "error";
export type HaloMascotSignal =
  | "none"
  | "thinking-model"
  | "shell-tool-skill"
  | "editing"
  | "planning-goal"
  | "delegating"
  | "visual"
  | "memory"
  | "attention-asking"
  | "done"
  | "error";

const SIGNAL_BY_ACTIVITY: Record<ActivityKind, HaloMascotSignal> = {
  session: "none",
  bridge: "none",
  thinking: "thinking-model",
  model: "thinking-model",
  planning: "planning-goal",
  goal: "planning-goal",
  tool: "shell-tool-skill",
  shell: "shell-tool-skill",
  skill: "shell-tool-skill",
  editing: "editing",
  delegating: "delegating",
  visual: "visual",
  memory: "memory",
  compact: "memory",
  asking: "attention-asking",
  attention: "attention-asking",
  done: "done",
  error: "error",
};

const hashIdentityKey = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
};

export const getHaloMascotName = (identityKey?: string | null): HaloMascotName => {
  if (!identityKey) return "scorpion";
  return HALO_MASCOT_ROSTER[hashIdentityKey(identityKey) % HALO_MASCOT_ROSTER.length] ?? "scorpion";
};

const getState = (status?: ISessionSummary["status"], kind?: ActivityKind): HaloMascotState => {
  if (status === "error" || kind === "error") return "error";
  if (status === "attention" || kind === "attention" || kind === "asking") return "attention";
  if (status === "done" || kind === "done") return "done";
  return status === "working" ? "working" : "idle";
};

export const getHaloMascotSignal = (
  status?: ISessionSummary["status"],
  kind: ActivityKind = "session",
): HaloMascotSignal => {
  if (status === "error") return "error";
  if (status === "attention") return "attention-asking";
  if (status === "done") return "done";
  if (status === "idle" || status === "inactive") return "none";
  return SIGNAL_BY_ACTIVITY[kind];
};

const getStyle = (mascot: HaloMascotName, state: HaloMascotState, signal: HaloMascotSignal) => ({
  "--halo-mascot-body": `url("/mascots/agent-halo-roster/body/${mascot}/${state}.png")`,
  ...(signal === "none" ? {} : { "--halo-mascot-signal": `url("/mascots/agent-halo-roster/signals/${signal}.png")` }),
}) as CSSProperties & { "--halo-mascot-body": string; "--halo-mascot-signal"?: string };

export interface IHaloMascotProps {
  activityKind?: ActivityKind;
  className: string;
  identityKey?: string | null;
  sessionId?: string | null;
  status?: ISessionSummary["status"];
}

export const HaloMascot = ({ activityKind, className, identityKey, sessionId, status }: IHaloMascotProps) => {
  const mascot = getHaloMascotName(identityKey || sessionId);
  const state = getState(status, activityKind);
  const signal = getHaloMascotSignal(status, activityKind);
  const visualStatus = status === "idle" || status === "inactive" ? status : state;
  return (
    <span className={`${className} halo-mascot`} data-status={visualStatus} data-session-status={status ?? "idle"} data-kind={activityKind} data-state={state} data-signal={signal} data-mascot={mascot} style={getStyle(mascot, state, signal)} aria-hidden="true">
      <span className="halo-mascot-body" />
      {signal === "none" ? null : <span className="halo-mascot-signal" />}
    </span>
  );
};

export const ActivityMascot = (props: Omit<IHaloMascotProps, "className">) => <HaloMascot className="activity-mascot" {...props} />;
export const SessionMascot = (props: Omit<IHaloMascotProps, "className">) => <HaloMascot className="session-mascot" {...props} />;
