export type MovementPoseStatus = "idle" | "requesting" | "tracking" | "completed" | "denied" | "unavailable" | "error";

export interface IMovementPoseSnapshot {
  status: MovementPoseStatus;
  repCount: number;
  targetReps: 10;
  guidance: string;
  permission: "notDetermined" | "authorized" | "denied" | "restricted" | "unavailable";
  sessionId: string | null;
  shoulderLineY: number | null;
  targetLineY: number | null;
  depthProgress: number;
  error: string | null;
}
