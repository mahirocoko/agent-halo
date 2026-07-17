import { Camera, CameraOff, Check, Dumbbell, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { measureShoulderLine, MOVEMENT_TARGET_REPS, ShoulderSquatCounter } from "./model";
import { createLocalPoseLandmarker } from "./runtime";
import type { IMovementPoseSnapshot } from "./types";
import "../../styles/movement.css";

const lineCoordinate = (value: number | null): number | null => value === null ? null : Math.max(0, Math.min(1, value)) * 100;

export interface IMovementChallengeProps {
  snapshot: IMovementPoseSnapshot;
  busy: boolean;
  cameraPreviewEnabled: boolean;
  demoPoseEnabled: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onSnapshot: (snapshot: IMovementPoseSnapshot) => void;
  onStartBreak: () => void;
}

export const MovementChallenge = ({ busy, cameraPreviewEnabled, demoPoseEnabled, onCancel, onRetry, onSnapshot, onStartBreak, snapshot }: IMovementChallengeProps) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"waiting" | "active" | "unavailable">("waiting");
  const terminalFailure = ["denied", "unavailable", "error"].includes(snapshot.status);
  const cameraActive = snapshot.status === "tracking";
  const complete = snapshot.status === "completed";
  const shoulderLineY = lineCoordinate(snapshot.shoulderLineY);
  const targetLineY = lineCoordinate(snapshot.targetLineY);

  useEffect(() => {
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!cameraPreviewEnabled) return undefined;
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia) {
      setPreviewStatus("unavailable");
      onSnapshot({ ...snapshot, status: "unavailable", guidance: "Camera preview is unavailable", error: "This WebView cannot open the camera" });
      return undefined;
    }
    let disposed = false;
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo: (video: HTMLVideoElement, timestampMs: number) => { landmarks: Array<Array<{ y: number; visibility?: number }>> }; close: () => void } | null = null;
    let animationFrame = 0;
    let lastInferenceAt = 0;
    let completionSent = false;
    const counter = new ShoulderSquatCounter();

    const stop = (): void => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      landmarker?.close();
      landmarker = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async (): Promise<void> => {
      try {
        onSnapshot({ ...snapshot, status: "requesting", guidance: "Waiting for Camera permission…", error: null });
        const nextStream = await getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 }, facingMode: "user" },
        });
        if (disposed) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        const video = videoRef.current;
        if (!video) throw new Error("Movement camera surface is unavailable");
        video.srcObject = nextStream;
        await video.play();
        if (video.videoWidth <= 0 || video.videoHeight <= 0) {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Camera preview did not start")), 4_000);
            video.addEventListener("loadeddata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          });
        }
        if (disposed) return;
        setPreviewStatus("active");
        if (demoPoseEnabled) {
          onSnapshot({ ...snapshot, status: "tracking", permission: "authorized", guidance: "Squat down · move white to green", shoulderLineY: 0.31, targetLineY: 0.58, depthProgress: 0.48 });
          return;
        }
        onSnapshot({ ...snapshot, status: "requesting", permission: "authorized", guidance: "Loading local shoulder tracker…", error: null });
        const nextLandmarker = await createLocalPoseLandmarker();
        if (disposed) {
          nextLandmarker.close();
          return;
        }
        landmarker = nextLandmarker;

        const detect = (timestampMs: number): void => {
          if (disposed || !landmarker) return;
          try {
            if (timestampMs - lastInferenceAt >= 80 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              lastInferenceAt = timestampMs;
              const normalized = landmarker.detectForVideo(video, timestampMs).landmarks[0] ?? [];
              const measurement = measureShoulderLine(normalized);
              const event = counter.update(timestampMs, measurement);
              const trackingLost = event.type === "tracking-lost";
              const completed = event.type === "completed";
              onSnapshot({
                status: completed ? "completed" : "tracking",
                repCount: counter.count,
                targetReps: MOVEMENT_TARGET_REPS,
                guidance: completed ? "10 squats complete" : trackingLost ? "Keep both shoulders inside the camera" : counter.guidance,
                permission: "authorized",
                sessionId: snapshot.sessionId,
                shoulderLineY: measurement?.shoulderY ?? null,
                targetLineY: counter.targetLineY,
                depthProgress: counter.depthProgress,
                error: null,
              });
              if (completed && !completionSent) {
                completionSent = true;
                stop();
                return;
              }
            }
          } catch (error) {
            stop();
            if (!disposed) onSnapshot({ ...snapshot, status: "error", guidance: "Shoulder tracking stopped", error: error instanceof Error ? error.message : "Local pose inference failed" });
            return;
          }
          animationFrame = window.requestAnimationFrame(detect);
        };
        animationFrame = window.requestAnimationFrame(detect);
      } catch (error) {
        stop();
        if (disposed) return;
        const denied = error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
        setPreviewStatus("unavailable");
        onSnapshot({
          ...snapshot,
          status: denied ? "denied" : "error",
          permission: denied ? "denied" : snapshot.permission,
          guidance: denied ? "Enable Camera in macOS Settings, or start the break" : "Local shoulder tracking could not start",
          error: denied ? null : error instanceof Error ? error.message : "Could not start Movement Break",
        });
      }
    };
    void start();
    return () => {
      disposed = true;
      stop();
    };
  }, [cameraPreviewEnabled, demoPoseEnabled, snapshot.sessionId]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape" || busy) return;
    event.preventDefault();
    onCancel();
  };

  return (
    <section className="movement-challenge" role="dialog" aria-label="10 Squats movement break" data-status={snapshot.status} onKeyDown={handleKeyDown}>
      <header className="movement-header">
        <span className="movement-title"><Dumbbell size={15} strokeWidth={2.4} />Squat set</span>
        <span className="movement-local"><span className="movement-local-dot" data-active={cameraActive} />On this Mac</span>
        <button ref={closeButtonRef} className="movement-icon-button" type="button" onClick={onCancel} disabled={busy} aria-label="Close movement break"><X size={16} strokeWidth={2.3} /></button>
      </header>

      <div className="movement-body">
        <div className="movement-pose-stage" aria-label={cameraActive ? "Live shoulder tracking camera" : "Movement camera status"}>
          {cameraPreviewEnabled ? <video ref={videoRef} className="movement-camera-preview" autoPlay muted playsInline aria-label="Live mirrored Movement Break camera" /> : null}
          {shoulderLineY === null ? null : <span className="movement-shoulder-line" style={{ top: `${shoulderLineY}%` }} aria-hidden="true" />}
          {targetLineY === null ? null : <span className="movement-target-line" style={{ top: `${targetLineY}%` }} aria-hidden="true" />}
          {complete ? (
            <span className="movement-stage-icon is-complete"><Check size={42} strokeWidth={2.4} /></span>
          ) : terminalFailure ? (
            <span className="movement-stage-icon"><CameraOff size={38} strokeWidth={1.8} /></span>
          ) : previewStatus !== "active" ? (
            <span className="movement-stage-icon"><Camera size={38} strokeWidth={1.8} /></span>
          ) : null}
          <span className="movement-preview-state">{previewStatus === "active" ? "LIVE · shoulder" : previewStatus === "unavailable" ? "Preview unavailable" : "Preparing preview"}</span>
          <span className="movement-privacy">Live view only · no video or audio saved</span>
        </div>

        <div className="movement-progress-copy">
          <div className="movement-count" role="status" aria-live="polite"><strong>{snapshot.repCount}</strong><span>/ {snapshot.targetReps}</span></div>
          <div className="movement-depth-progress" role="progressbar" aria-label="Squat depth" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snapshot.depthProgress * 100)}>
            <span style={{ width: `${Math.round(snapshot.depthProgress * 100)}%` }} />
          </div>
          <span className="movement-depth-label">{Math.round(snapshot.depthProgress * 100)}% to target</span>
          <span className="movement-guidance">{snapshot.guidance}</span>
          {snapshot.error ? <span className="movement-error">{snapshot.error}</span> : null}
        </div>
      </div>

      <footer className="movement-actions">
        {terminalFailure ? <button type="button" onClick={onRetry} disabled={busy}><RotateCcw size={13} strokeWidth={2.3} />Try again</button> : null}
        {terminalFailure ? <button className="is-primary" type="button" onClick={onStartBreak} disabled={busy}><Play size={13} strokeWidth={2.3} />Start break</button> : null}
        {!terminalFailure && !complete ? <button type="button" onClick={onCancel} disabled={busy}>Cancel</button> : null}
        <span className="movement-safety">Camera stops when this closes</span>
      </footer>
    </section>
  );
};
