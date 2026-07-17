export const createLocalPoseLandmarker = async () => {
  const [{ FilesetResolver, PoseLandmarker }, modelResponse] = await Promise.all([
    import("@mediapipe/tasks-vision"),
    fetch(new URL("mediapipe/models/pose_landmarker_lite.task", document.baseURI)),
  ]);
  if (!modelResponse.ok) throw new Error(`Local pose model is missing (${modelResponse.status})`);
  const [vision, modelAssetBuffer] = await Promise.all([
    FilesetResolver.forVisionTasks(new URL("mediapipe/wasm", document.baseURI).href.replace(/\/$/, "")),
    modelResponse.arrayBuffer(),
  ]);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer: new Uint8Array(modelAssetBuffer), delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.58,
    minPosePresenceConfidence: 0.58,
    minTrackingConfidence: 0.58,
    outputSegmentationMasks: false,
  });
};
