# MoCap Studio — Next.js + Supabase

A dedicated project for building a reliable browser-based motion-capture studio. Stage 1 focuses on the studio shell, video/camera input, multi-person body landmarks, facial blendshape capture, and motion JSON export.

## Requirements

- Node.js 20.9+
- npm
- A modern browser (Chrome or Edge recommended)
- Internet access only for installing npm packages; the capture runtime/model files should be served locally once setup is complete.

## Install

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Important: install MediaPipe runtime assets locally

The application intentionally does **not** import MediaPipe from browser CDNs. Before a production build, `npm run build` runs `scripts/prepare-mediapipe.mjs`: it copies the WASM runtime from the installed package and downloads the official pose and face model files into the paths below. This lets cloud deployment providers such as Vercel prepare the assets during the build instead of requiring you to upload large binary files manually. You can also run `npm run prepare:mediapipe` explicitly.

- `public/mediapipe/wasm/` — all WASM runtime files from the package's `wasm` directory
- `public/models/pose_landmarker_lite.task` — Pose Landmarker Lite model
- `public/models/face_landmarker.task` — Face Landmarker model

The runtime package is installed from npm. To keep high-resolution video playback responsive, motion inference uses a downscaled copy with a maximum 640-pixel edge and is capped near 15 inference frames per second. Original video playback is not slowed to this processing rate. Recording updates the UI in batches to reduce rendering overhead. To prepare the WASM files manually after `npm install`, on macOS/Linux:

```bash
mkdir -p public/mediapipe/wasm public/models
cp -R node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force public/mediapipe/wasm, public/models
Copy-Item node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/ -Recurse -Force
```

The preparation script downloads the official MediaPipe model files automatically. A successful build requires outbound network access to the official Google MediaPipe model host. The binary assets are generated during build and are intentionally not committed to Git.

## Supabase

1. Create a Supabase project.
2. Copy the Project URL and anon/publishable key into `.env.local`.
3. Run the SQL in `supabase/migrations/0001_initial.sql` in the Supabase SQL Editor.
4. Storage buckets and signed uploads are a later stage; this initial migration defines private metadata tables with RLS.

Never place the Supabase service-role key in browser code or a `NEXT_PUBLIC_` variable.

## Stages

- **Stage 1 (starter):** dark workspace, local video/camera input, body landmark overlay, face blendshape extraction, JSON motion export.
- **Stage 2:** stable person identity association across frames, 3D GLB/GLTF avatar import, humanoid rig mapping, expression-to-blendshape retargeting.
- **Stage 3:** Supabase Auth and project persistence, private Storage uploads, robust timeline editing, rendered video export.
- **Stage 4:** automated tests, security review, deployment configuration, performance profiling.

## Current limitations

- Face blendshape output is matched to the nearest pose nose as a basic heuristic; stable multi-person identity association across frames is not implemented yet.
- Motion recording is held in client memory until exported. Reloading loses the take.
- Facial landmarks and blendshape scores are extracted, but no facial animation is yet retargeted to a 3D character.
- Avatar import, full rig retargeting, rendered video, and Supabase Auth flows are not yet implemented.
- The HTML prototype is not included as the application runtime; this is the start of the dedicated Next.js project.
