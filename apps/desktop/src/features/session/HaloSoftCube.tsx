import type { CSSProperties } from "react";
import type { ActivityKind, ISessionSummary } from "./types";

const FORMS = ["core", "cat-corner", "sprout"] as const;
const PALETTE_COUNT = 6;
type HaloPetForm = (typeof FORMS)[number];
type HaloPetState = "idle" | "working" | "attention" | "done" | "error";
export type HaloPetSignal =
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

const SIGNAL_BY_ACTIVITY: Record<ActivityKind, HaloPetSignal> = {
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

const hashSessionId = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
};
const getState = (status?: ISessionSummary["status"], kind?: ActivityKind): HaloPetState => {
  if (status === "error" || kind === "error") return "error";
  if (status === "attention" || kind === "attention" || kind === "asking") return "attention";
  if (status === "done" || kind === "done") return "done";
  return status === "working" ? "working" : "idle";
};

export const getHaloPetSignal = (
  status?: ISessionSummary["status"],
  kind: ActivityKind = "session",
): HaloPetSignal => {
  if (status === "error") return "error";
  if (status === "attention") return "attention-asking";
  if (status === "done") return "done";
  if (status === "idle" || status === "inactive") return "none";
  return SIGNAL_BY_ACTIVITY[kind];
};

const getStyle = (form: HaloPetForm, state: HaloPetState, signal: HaloPetSignal) => ({
  "--halo-pet-body": `url("/mascots/halo-soft-cube/body/${form}/${state}.png")`,
  ...(signal === "none" ? {} : { "--halo-pet-signal": `url("/mascots/halo-soft-cube/signals/${signal}.png")` }),
}) as CSSProperties & { "--halo-pet-body": string; "--halo-pet-signal"?: string };

export interface IHaloSoftCubeProps {
  activityKind?: ActivityKind;
  className: string;
  sessionId?: string | null;
  status?: ISessionSummary["status"];
}

export const HaloSoftCube = ({ activityKind, className, sessionId, status }: IHaloSoftCubeProps) => {
  const variant = hashSessionId(sessionId || "agent-halo") % PALETTE_COUNT;
  const form = FORMS[variant % FORMS.length] ?? "core";
  const state = getState(status, activityKind);
  const signal = getHaloPetSignal(status, activityKind);
  return (
    <span className={`${className} halo-soft-cube`} data-status={status ?? "idle"} data-kind={activityKind} data-state={state} data-signal={signal} data-form={form} data-palette={variant} style={getStyle(form, state, signal)} aria-hidden="true">
      <span className="halo-soft-cube-body" />
      {signal === "none" ? null : <span className="halo-soft-cube-signal" />}
    </span>
  );
};

export const ActivityMascot = (props: Omit<IHaloSoftCubeProps, "className">) => <HaloSoftCube className="activity-mascot" {...props} />;
export const SessionMascot = (props: Omit<IHaloSoftCubeProps, "className">) => <HaloSoftCube className="session-mascot" {...props} />;
