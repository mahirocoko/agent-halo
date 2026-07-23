import type { HaloPetName } from "../session/HaloPet";
import type { HaloBotLoadout } from "../session/haloBot";
import type { CompletionPetSize } from "./preferences";

export type CompletionPetBreakPhase = "short-break" | "long-break";

export interface ICompletionPetSummon {
  schemaVersion: 1;
  id: string;
  pet: HaloPetName;
  loadout?: HaloBotLoadout;
  petSize: CompletionPetSize;
  preview: boolean;
  movementBreakEnabled?: boolean;
  nextPhase: CompletionPetBreakPhase;
  title: "Focus complete" | "Pet preview";
  actionLabel: "Start Short break" | "Start Long break" | "";
}

export interface ICompletionPetNativeState {
  summon: ICompletionPetSummon | null;
}

export type CompletionPetAction = "movement-complete" | "start-break";

export interface ICompletionPetActionRequest {
  action: CompletionPetAction;
  summonId: string;
  nextPhase: CompletionPetBreakPhase;
}
