# Local Movement Break runtime assets

Agent Halo vendors these files so Movement Break pose detection has no runtime network dependency.

## Runtime

- Package: `@mediapipe/tasks-vision@0.10.35`
- License declared by package: Apache-2.0
- Copied files:
  - `wasm/vision_wasm_internal.js`
  - `wasm/vision_wasm_internal.wasm`
  - `wasm/vision_wasm_nosimd_internal.js`
  - `wasm/vision_wasm_nosimd_internal.wasm`

## Pose model

- Model: MediaPipe Pose Landmarker Lite, float16
- Source: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`
- SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- Size: 5,777,746 bytes

These assets process the explicitly opened local camera stream in memory. Agent Halo does not upload or persist camera frames.
