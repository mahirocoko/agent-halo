import type { CSSProperties } from "react";
import type { ActivityKind, ISessionSummary } from "./types";

const FORMS = ["core", "cat-corner", "sprout"] as const;
const PALETTE_COUNT = 6;
type HaloPetForm = (typeof FORMS)[number];
type HaloPetState = "idle" | "working" | "attention" | "done" | "error";

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
const getStyle = (form: HaloPetForm, state: HaloPetState) => ({
  "--halo-pet-body": `url("/mascots/halo-soft-cube/body/${form}/${state}.png")`,
  "--halo-pet-mote": `url("/mascots/halo-soft-cube/motes/${state}.png")`,
}) as CSSProperties & Record<"--halo-pet-body" | "--halo-pet-mote", string>;

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
  return (
    <span className={`${className} halo-soft-cube`} data-status={status ?? "idle"} data-kind={activityKind} data-state={state} data-form={form} data-palette={variant} style={getStyle(form, state)} aria-hidden="true">
      <span className="halo-soft-cube-body" />
      <span className="halo-soft-cube-mote" />
    </span>
  );
};

export const ActivityMascot = (props: Omit<IHaloSoftCubeProps, "className">) => <HaloSoftCube className="activity-mascot" {...props} />;
export const SessionMascot = (props: Omit<IHaloSoftCubeProps, "className">) => <HaloSoftCube className="session-mascot" {...props} />;
