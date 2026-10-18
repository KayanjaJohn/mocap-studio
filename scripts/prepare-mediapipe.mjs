import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmTarget = path.join(root, "public", "mediapipe", "wasm");
const modelTarget = path.join(root, "public", "models");

const models = [
  {
    name: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
  {
    name: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
];

async function prepareWasm() {
  try {
    await stat(wasmSource);
  } catch {
    throw new Error(`MediaPipe WASM package files were not found at ${wasmSource}. Run npm install first.`);
  }
  await mkdir(path.dirname(wasmTarget), { recursive: true });
  await rm(wasmTarget, { recursive: true, force: true });
  await cp(wasmSource, wasmTarget, { recursive: true });
  console.log("Prepared MediaPipe WASM runtime.");
}

async function downloadModel(model) {
  const destination = path.join(modelTarget, model.name);
  try {
    const existing = await stat(destination);
    if (existing.size > 100_000) {
      console.log(`Using existing model: ${model.name}`);
      return;
    }
  } catch {
    // Download the model if it is not already present.
  }

  console.log(`Downloading official MediaPipe model: ${model.name}`);
  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Model download failed for ${model.name}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100_000) {
    throw new Error(`Downloaded model ${model.name} is unexpectedly small (${bytes.length} bytes).`);
  }
  await mkdir(modelTarget, { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(destination, bytes));
  console.log(`Saved ${model.name} (${Math.round(bytes.length / 1024)} KiB).`);
}

await prepareWasm();
for (const model of models) await downloadModel(model);
console.log("MediaPipe assets are ready.");
