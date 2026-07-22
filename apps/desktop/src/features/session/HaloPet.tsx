import type { CSSProperties } from "react";
import { DEFAULT_HALO_BOT_LOADOUT, type HaloBotLoadout } from "./haloBot";
import type { ActivityKind, ISessionSummary } from "./types";

export const HALO_PET_ROSTER = [
  "halo-bot",
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
  "ember-starling",
] as const;
export type HaloPetName = (typeof HALO_PET_ROSTER)[number];
export const DEFAULT_HALO_PET: HaloPetName = "halo-bot";
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

export const isHaloPetName = (value: unknown): value is HaloPetName =>
  typeof value === "string" && (HALO_PET_ROSTER as readonly string[]).includes(value);

export const getHaloPetName = (value?: string | null): HaloPetName =>
  isHaloPetName(value) ? value : DEFAULT_HALO_PET;

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

const getStyle = (pet: HaloPetName, loadout: HaloBotLoadout, state: HaloPetState, signal: HaloPetSignal, activity: boolean) => ({
  "--halo-pet-body": pet === "halo-bot"
    ? `url("/mascots/agent-halo-roster/body/halo-bot/${loadout}/${state}.png")`
    : `url("/mascots/agent-halo-roster/body/${pet}/${state}.${pet === "ember-starling" ? "webp" : "png"}")`,
  ...(signal === "none" ? {} : { "--halo-pet-signal": `url("/mascots/agent-halo-roster/signals/${signal}.png")` }),
  ...(pet === "ember-starling" ? activity ? {
    "--halo-pet-frame-width": "30px",
    "--halo-pet-frame-height": "30px",
    "--halo-pet-three-frame-width": "90px",
    "--halo-pet-done-width": "120px",
    "--halo-pet-frame-1-x": "-30px",
    "--halo-pet-frame-2-x": "-60px",
    "--halo-pet-frame-3-x": "-90px",
    "--halo-pet-signal-left": "34px",
  } : {
    "--halo-pet-frame-width": "36px",
    "--halo-pet-frame-height": "36px",
    "--halo-pet-three-frame-width": "108px",
    "--halo-pet-done-width": "144px",
    "--halo-pet-frame-1-x": "-36px",
    "--halo-pet-frame-2-x": "-72px",
    "--halo-pet-frame-3-x": "-108px",
    "--halo-pet-signal-left": "40px",
  } : {}),
  ...(pet === "halo-bot" ? {
    "--halo-pet-hue": "0deg",
    "--halo-pet-saturation": "1",
    "--halo-pet-brightness": "1",
  } : {}),
}) as CSSProperties & { "--halo-pet-body": string; "--halo-pet-signal"?: string };

const EMBER_BODY_STYLE = {
  top: 0,
  imageRendering: "auto",
  filter: "drop-shadow(0 0 2px rgba(255, 119, 28, 0.44)) saturate(var(--halo-pet-saturation)) brightness(var(--halo-pet-brightness))",
} as CSSProperties;

const HALO_BOT_BODY_STYLE = {
  imageRendering: "pixelated",
  filter: "saturate(var(--halo-pet-saturation)) brightness(var(--halo-pet-brightness))",
} as CSSProperties;

export interface IHaloPetProps {
  activityKind?: ActivityKind;
  className: string;
  loadout?: HaloBotLoadout;
  pet?: HaloPetName;
  status?: ISessionSummary["status"];
  surface?: "ambient" | "session";
}

export const HaloPet = ({ activityKind, className, loadout, pet = DEFAULT_HALO_PET, status, surface = "session" }: IHaloPetProps) => {
  const state = getState(status, activityKind);
  const signal = getHaloPetSignal(status, activityKind);
  const visualStatus = status === "idle" || status === "inactive" ? status : state;
  const resolvedLoadout = pet === "halo-bot" ? loadout ?? DEFAULT_HALO_BOT_LOADOUT : DEFAULT_HALO_BOT_LOADOUT;
  return (
    <span className={`${className} halo-pet`} data-status={visualStatus} data-session-status={status ?? "idle"} data-kind={activityKind} data-state={state} data-signal={signal} data-pet={pet} data-loadout={pet === "halo-bot" ? resolvedLoadout : undefined} style={getStyle(pet, resolvedLoadout, state, signal, surface === "ambient")} aria-hidden="true">
      <span className="halo-pet-body" style={pet === "ember-starling" ? EMBER_BODY_STYLE : pet === "halo-bot" ? HALO_BOT_BODY_STYLE : undefined} />
      {signal === "none" ? null : <span className="halo-pet-signal" />}
    </span>
  );
};

export const ActivityPet = (props: Omit<IHaloPetProps, "className" | "surface">) => <HaloPet className="activity-pet" surface="ambient" {...props} />;
export const SessionPet = (props: Omit<IHaloPetProps, "className" | "surface">) => <HaloPet className="session-pet" surface="session" {...props} />;
