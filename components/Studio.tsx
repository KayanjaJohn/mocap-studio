"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity, Camera, Check, ChevronDown, CircleHelp, Clapperboard, Download,
  FileVideo, FolderOpen, Gauge, Layers, Play, Plus, ScanFace, Settings2,
  ShieldCheck, SkipBack, SkipForward, Sparkles, Square, Upload, Users, Video, WandSparkles
} from "lucide-react";
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";

type EngineState = "idle" | "loading" | "ready" | "error";
type CapturePerson = { id: number; pose: { x: number; y: number; visibility: number }[]; faceBlendshapes: Record<string, number> };\ntype SavedProject = { id: string; name: string; updatedAt: string; source: string; sourceDuration: number; trim: { start: number; end: number }; playbackRate: number; frames: { t: number; people: CapturePerson[] }[]; showBody: boolean; showIds: boolean };\nconst PROJECTS_STORAGE_KEY = "mocap-studio-projects-v1";

const POSE_CONNECTIONS: [number, number][] = [
  // Face outline and features available in the 33-point pose model
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  // Shoulders, arms, wrists and hand landmarks
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [15,17],[15,19],[15,21],[17,19],[16,18],[16,20],[16,22],[18,20],
  // Torso and hips
  [11,23],[12,24],[23,24],
  // Legs, ankles, heels and foot tips
  [23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];

export default function Studio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const motionFileRef = useRef<HTMLInputElement>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(-1);
  const lastInferenceAtRef = useRef(0);
  const lastUiUpdateAtRef = useRef(0);
  const lastFramesUiUpdateAtRef = useRef(0);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingRef = useRef(false);
  const playingRef = useRef(false);
  const sourceKindRef = useRef<"video" | "camera" | null>(null);
  const motionFramesRef = useRef<{ t: number; people: CapturePerson[] }[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const motionPlaybackTimerRef = useRef<number | null>(null);
  const [engine, setEngine] = useState<EngineState>("idle");
  const [engineMessage, setEngineMessage] = useState("Capture engine not loaded");
  const [sourceName, setSourceName] = useState("");
  const [takeSourceName, setTakeSourceName] = useState("");\n  const [projectName, setProjectName] = useState("Untitled Motion Project");\n  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);\n  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [sourceKind, setSourceKind] = useState<"video" | "camera" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [people, setPeople] = useState<CapturePerson[]>([]);
  const [maxPeople, setMaxPeople] = useState("2");
  const [showBody, setShowBody] = useState(true);
  const [showFace, setShowFace] = useState(false);
  const [showIds, setShowIds] = useState(true);
  const [poseConfidence, setPoseConfidence] = useState(0.35);
  const [faceConfidence, setFaceConfidence] = useState(0.35);
  const [motionFrames, setMotionFrames] = useState<{ t: number; people: CapturePerson[] }[]>([]);
  const [viewMode, setViewMode] = useState<"tracking" | "source" | "skeleton">("tracking");
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("Import a video or connect your camera to begin.");
  const [activeTab, setActiveTab] = useState("Capture");

  useEffect(() => () => {
    playingRef.current = false;
    recordingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    poseRef.current?.close();
    faceRef.current?.close();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setSavedProjects(parsed.filter((item): item is SavedProject => !!item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.frames)));
      }
    } catch {
      setNote("Saved projects could not be read from this browser.");
    }
  }, []);

  function persistProjects(projects: SavedProject[]) {
    try {
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      setSavedProjects(projects);
      return true;
    } catch {
      setNote("Could not save this project in browser storage. The project may be too large; export the motion JSON as a backup.");
      return false;
    }
  }

  function saveProject() {
    const frames = motionFramesRef.current;
    if (!frames.length) {
      setNote("Record a take or import a motion JSON before saving a project.");
      return;
    }
    const now = new Date().toISOString();
    const project: SavedProject = {
      id: currentProjectId || `project-${Date.now()}`,
      name: projectName.trim() || "Untitled Motion Project",
      updatedAt: now,
      source: sourceName || takeSourceName || "Imported motion take",
      sourceDuration: duration || frames[frames.length - 1].t,
      trim: { start: trimStart, end: trimEnd || duration || frames[frames.length - 1].t },
      playbackRate,
      frames,
      showBody,
      showIds
    };
    const projects = [project, ...savedProjects.filter(item => item.id !== project.id)].slice(0, 30);
    if (persistProjects(projects)) {
      setCurrentProjectId(project.id);
      setProjectName(project.name);
      setNote(`Saved project “${project.name}” in this browser. Re-import its source video after reopening the browser.`);
    }
  }

  function openProject(project: SavedProject) {
    if (!Array.isArray(project.frames) || !project.frames.length) {
      setNote("This saved project has no motion frames.");
      return;
    }
    playingRef.current = false;
    setPlaying(false);
    if (motionPlaybackTimerRef.current !== null) {
      window.clearInterval(motionPlaybackTimerRef.current);
      motionPlaybackTimerRef.current = null;
    }
    motionFramesRef.current = project.frames;
    setMotionFrames(project.frames);
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    setTakeSourceName(project.source);
    setDuration(project.sourceDuration || project.frames[project.frames.length - 1].t);
    setTrimStart(project.trim?.start || 0);
    setTrimEnd(project.trim?.end || project.sourceDuration || project.frames[project.frames.length - 1].t);
    setPlaybackRate(project.playbackRate || 1);
    setShowBody(project.showBody !== false);
    setShowIds(project.showIds !== false);
    setActiveTab("Cut");
    setSourceName("");
    setSourceKind(null);
    sourceKindRef.current = null;
    setNote(`Opened “${project.name}”. Import the matching video separately if you want the motion overlaid on the original footage.`);
    window.setTimeout(() => drawRecordedFrame(project.frames[0].t), 0);
    setCurrentTime(project.frames[0].t);
  }

  function deleteProject(projectId: string) {
    const next = savedProjects.filter(project => project.id !== projectId);
    if (persistProjects(next)) {
      if (currentProjectId === projectId) setCurrentProjectId(null);
      setNote("Saved project deleted from this browser.");
    }
  }

  function paint() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (viewMode !== "skeleton" && video.readyState >= 2 && video.videoWidth > 0) return;
    ctx.fillStyle = "#080e1a"; ctx.fillRect(0, 0, w, h);
    {
      ctx.strokeStyle = "#152238"; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.fillStyle = "#8fa3bf"; ctx.font = "14px system-ui"; ctx.textAlign = "center";
      ctx.fillText("SOURCE + TRACKING VIEWPORT", w / 2, h / 2);
      ctx.fillText("Load the engine, then import a video or use your camera", w / 2, h / 2 + 24);
    }
  }

  async function loadEngine() {
    if (engine === "loading" || engine === "ready") return;
    setEngine("loading"); setEngineMessage("Loading local npm runtime and model files…");
    try {
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate: "GPU" },
        runningMode: "VIDEO", numPoses: Number(maxPeople),
        minPoseDetectionConfidence: poseConfidence, minPosePresenceConfidence: poseConfidence,
        minTrackingConfidence: poseConfidence
      }).catch(async () => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate: "CPU" },
        runningMode: "VIDEO", numPoses: Number(maxPeople),
        minPoseDetectionConfidence: poseConfidence, minPosePresenceConfidence: poseConfidence,
        minTrackingConfidence: poseConfidence
      }));
      poseRef.current = pose;
      // Face inference is optional and disabled by default because it adds a second heavy model.
      // Load it only when facial capture is explicitly enabled in Detection settings.
      let face: FaceLandmarker | null = null;
      if (showFace) {
        face = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
          runningMode: "VIDEO", numFaces: Number(maxPeople),
          minFaceDetectionConfidence: faceConfidence, minFacePresenceConfidence: faceConfidence,
          minTrackingConfidence: faceConfidence, outputFaceBlendshapes: true
        }).catch(async () => FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
          runningMode: "VIDEO", numFaces: Number(maxPeople),
          minFaceDetectionConfidence: faceConfidence, minFacePresenceConfidence: faceConfidence,
          minTrackingConfidence: faceConfidence, outputFaceBlendshapes: true
        }));
      }
      faceRef.current = face;
      setEngine("ready");
      setEngineMessage(showFace ? "Engine ready · body and face models loaded locally" : "Engine ready · body model only (fast mode)");
      setNote("Capture engine ready. Import a video or connect your camera.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setEngine("error");
      setEngineMessage(`Engine failed: ${message}. Install the model assets in public/models and WASM files in public/mediapipe/wasm.`);
      setNote("Model files are not bundled yet. See README for the setup step.");
    }
  }

  function drawRecordedFrame(time: number) {
    if (!motionFramesRef.current.length || (engine === "ready" && playingRef.current)) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const frame = motionFramesRef.current.reduce<{ t: number; people: CapturePerson[] } | null>((best, item) =>
      !best || Math.abs(item.t - time) < Math.abs(best.t - time) ? item : best, null);
    if (!frame) return;
    const hasVideo = video && video.readyState >= 2 && video.videoWidth > 0 && viewMode !== "skeleton";
    if (!hasVideo) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#080e1a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#152238"; ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40 * window.devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = 0; y < canvas.height; y += 40 * window.devicePixelRatio) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const scale = hasVideo ? Math.min(canvas.width / video!.videoWidth, canvas.height / video!.videoHeight) : Math.min(canvas.width, canvas.height) * 0.82;
    const dw = hasVideo ? video!.videoWidth * scale : scale;
    const dh = hasVideo ? video!.videoHeight * scale : scale;
    const ox = hasVideo ? (canvas.width - dw) / 2 : (canvas.width - dw) / 2;
    const oy = hasVideo ? (canvas.height - dh) / 2 : (canvas.height - dh) / 2;
    frame.people.forEach((person, pi) => {
      const color = ["#5cc8ff", "#c084fc", "#34d399", "#fbbf24", "#fb7185"][pi % 5];
      if (showBody && viewMode !== "source") {
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.5, 1.8 * window.devicePixelRatio);
        POSE_CONNECTIONS.forEach(([a,b]) => {
          const p = person.pose[a], q = person.pose[b];
          if (!p || !q || p.visibility < poseConfidence || q.visibility < poseConfidence) return;
          ctx.beginPath(); ctx.moveTo(ox + p.x * dw, oy + p.y * dh); ctx.lineTo(ox + q.x * dw, oy + q.y * dh); ctx.stroke();
        });
        ctx.fillStyle = color; ctx.strokeStyle = "#f4f8ff";
        person.pose.forEach(p => {
          if (p.visibility < poseConfidence) return;
          ctx.beginPath(); ctx.arc(ox + p.x * dw, oy + p.y * dh, Math.max(3, 2 * window.devicePixelRatio), 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = Math.max(1, window.devicePixelRatio); ctx.stroke();
        });
      }
      if (showIds && person.pose[0] && viewMode !== "source") {
        ctx.fillStyle = color; ctx.font = "bold 13px system-ui";
        ctx.fillText("Person " + person.id, ox + person.pose[0].x * dw + 10, oy + person.pose[0].y * dh - 10);
      }
    });
    setPeople(frame.people);
  }

  async function importMotionFile(file?: File) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") throw new Error("The file is not a motion take object.");
      const take = parsed as { format?: string; source?: string; sourceDuration?: number; trim?: { start?: number; end?: number }; playbackRate?: number; frames?: unknown[] };
      if (take.format !== "mocap-studio-motion-v1" || !Array.isArray(take.frames)) {
        throw new Error("Unsupported file. Choose a MoCap Studio motion JSON export.");
      }
      const frames = take.frames.filter((item): item is { t: number; people: CapturePerson[] } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { t?: unknown; people?: unknown };
        return typeof candidate.t === "number" && Number.isFinite(candidate.t) && Array.isArray(candidate.people);
      }).map(frame => ({
        t: frame.t,
        people: frame.people.filter((p): p is CapturePerson => !!p && typeof p === "object" && Array.isArray((p as CapturePerson).pose))
          .map(p => ({ id: Number(p.id) || 1, pose: p.pose.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).map(point => ({ x: point.x, y: point.y, visibility: Number.isFinite(point.visibility) ? point.visibility : 1 })), faceBlendshapes: p.faceBlendshapes && typeof p.faceBlendshapes === "object" ? p.faceBlendshapes : {} }))
      })).sort((a,b) => a.t - b.t);
      if (!frames.length) throw new Error("No valid motion frames were found in this file.");
      motionFramesRef.current = frames;
      setMotionFrames(frames);
      setTrimStart(Math.max(0, Number(take.trim?.start) || 0));
      setTrimEnd(Math.max(0, Number(take.trim?.end) || Number(take.sourceDuration) || 0));
      if (Number.isFinite(take.playbackRate) && Number(take.playbackRate) > 0) setRate(Number(take.playbackRate));
      setActiveTab("Cut");
      const initialTime = frames[0].t;
      if (videoRef.current && sourceKindRef.current === "video") seekTo(initialTime);
      else setCurrentTime(initialTime);
      setNote(`Imported ${frames.length} motion frames from ${file.name}. Import the matching source video to review the overlay against the footage.`);
      window.setTimeout(() => drawRecordedFrame(initialTime), 0);
    } catch (e) {
      setNote("Motion import failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return hours > 0 ? hours.toString().padStart(2,"0") + ":" + minutes.toString().padStart(2,"0") + ":" + secs.toString().padStart(2,"0") : minutes.toString().padStart(2,"0") + ":" + secs.toString().padStart(2,"0");
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const next = Math.max(0, Math.min(video.duration, seconds));
    video.currentTime = next;
    setCurrentTime(next);
    lastTimeRef.current = -1;
  }

  function setRate(rate: number) {
    setPlaybackRate(rate);
    if (videoRef.current && sourceKindRef.current === "video") videoRef.current.playbackRate = rate;
  }

  function markTrimStart() {
    const next = Math.min(currentTime, trimEnd || duration || currentTime);
    setTrimStart(next);
    setNote("Trim in set to " + formatTime(next) + ".");
  }

  function markTrimEnd() {
    const next = Math.max(currentTime, trimStart);
    setTrimEnd(next);
    setNote("Trim out set to " + formatTime(next) + ".");
  }

  function resetTrim() {
    setTrimStart(0);
    setTrimEnd(duration);
    setNote("Trim range reset to the full source.");
  }

  async function useVideoFile(file?: File) {
    if (!file || !videoRef.current) return;
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const oldStream = videoRef.current.srcObject;
    if (oldStream instanceof MediaStream) oldStream.getTracks().forEach(track => track.stop());
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    videoRef.current.srcObject = null;
    objectUrlRef.current = URL.createObjectURL(file);
    videoRef.current.src = objectUrlRef.current;
    videoRef.current.muted = true;
    videoRef.current.playbackRate = playbackRate;
    setCurrentTime(0); setDuration(0); setTrimStart(0); setTrimEnd(0);
    setSourceName(file.name); setSourceKind("video"); sourceKindRef.current = "video"; setNote("Video loaded. Load the engine, then press Play to track.");
    await videoRef.current.load();
    paint();
  }

  async function useCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setNote("Camera access is unavailable in this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      if (!videoRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      playingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const oldStream = videoRef.current.srcObject;
      if (oldStream instanceof MediaStream) oldStream.getTracks().forEach(track => track.stop());
      if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
      videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.srcObject = stream; videoRef.current.muted = true;
      await videoRef.current.play();
      setSourceName("Live camera"); setSourceKind("camera"); sourceKindRef.current = "camera"; playingRef.current = true; setPlaying(true);
      setNote("Camera connected. Load the engine to detect people.");
      if (engine === "ready") startTracking();
    } catch (e) { setNote(`Camera error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  function startTracking() {
    const video = videoRef.current;
    if (!video || !sourceName) { setNote("Import a video or connect your camera first."); return; }
    if (!poseRef.current || (showFace && !faceRef.current)) {
      if (sourceKindRef.current === "video") {
        playingRef.current = true;
        setPlaying(true);
        void video.play().catch(e => setNote("Video playback failed: " + (e instanceof Error ? e.message : String(e))));
        setNote("Video preview only. Load the capture engine to enable motion tracking.");
        return;
      }
      setNote("Load the capture engine before tracking a live camera.");
      return;
    }
    playingRef.current = true;
    lastInferenceAtRef.current = 0;
    lastTimeRef.current = -1;
    setPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const v = videoRef.current, canvas = canvasRef.current;
      if (!v || !canvas || !poseRef.current) return;
      if (v.readyState >= 2 && v.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = v.currentTime;
        const now = performance.now();
        // Cap expensive inference to ~15 FPS; keep browser video playback at its native rate.
        if (now - lastInferenceAtRef.current < 66) {
          if (playingRef.current) rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastInferenceAtRef.current = now;
        const timestamp = now;
        try {
          // Infer on a downscaled copy instead of running both models on 1080p/4K frames.
          let inferenceCanvas = inferenceCanvasRef.current;
          if (!inferenceCanvas) { inferenceCanvas = document.createElement("canvas"); inferenceCanvasRef.current = inferenceCanvas; }
          const inferenceScale = Math.min(1, 640 / v.videoWidth, 640 / v.videoHeight);
          inferenceCanvas.width = Math.max(1, Math.round(v.videoWidth * inferenceScale));
          inferenceCanvas.height = Math.max(1, Math.round(v.videoHeight * inferenceScale));
          const inferenceContext = inferenceCanvas.getContext("2d");
          if (!inferenceContext) throw new Error("Could not create the motion inference canvas.");
          inferenceContext.drawImage(v, 0, 0, inferenceCanvas.width, inferenceCanvas.height);
          const poseResult = poseRef.current.detectForVideo(inferenceCanvas, timestamp);
          const faceResult = showFace && faceRef.current ? faceRef.current.detectForVideo(inferenceCanvas, timestamp) : null;
          const next: CapturePerson[] = (poseResult.landmarks || []).map((landmarks, i) => {
            const nose = landmarks[0];
            let matchedFace = -1;
            let nearestDistance = Number.POSITIVE_INFINITY;
            (faceResult?.faceLandmarks || []).forEach((face, faceIndex) => {
              if (!nose || !face[1]) return;
              const distance = Math.hypot(nose.x - face[1].x, nose.y - face[1].y);
              if (distance < nearestDistance) { nearestDistance = distance; matchedFace = faceIndex; }
            });
            const cats = matchedFace >= 0 ? (faceResult?.faceBlendshapes?.[matchedFace]?.categories || []) : [];
            return {
              id: i + 1,
              pose: landmarks.map(p => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })),
              faceBlendshapes: Object.fromEntries(cats.map(c => [c.categoryName, c.score]))
            };
          });
          // Avoid forcing a full React render on every inference frame.
          if (now - lastUiUpdateAtRef.current >= 200) {
            setPeople(next);
            lastUiUpdateAtRef.current = now;
          }
          if (recordingRef.current) {
            motionFramesRef.current.push({ t: v.currentTime, people: next });
            if (now - lastFramesUiUpdateAtRef.current >= 500) {
              setMotionFrames([...motionFramesRef.current]);
              lastFramesUiUpdateAtRef.current = now;
            }
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const scale = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
            const dw = v.videoWidth * scale, dh = v.videoHeight * scale, ox = (canvas.width - dw) / 2, oy = (canvas.height - dh) / 2;
            // The original video is rendered by the browser at native playback speed;
            // this transparent canvas only draws tracking overlays.
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (viewMode !== "source") next.forEach((person, pi) => {
              const color = ["#5cc8ff", "#c084fc", "#34d399", "#fbbf24", "#fb7185"][pi % 5];
              if (showBody) {
                ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.5, 1.8 * window.devicePixelRatio);
                POSE_CONNECTIONS.forEach(([a,b]) => {
                  const p = person.pose[a], q = person.pose[b];
                  if (!p || !q || p.visibility < poseConfidence || q.visibility < poseConfidence) return;
                  ctx.beginPath(); ctx.moveTo(ox + p.x * dw, oy + p.y * dh); ctx.lineTo(ox + q.x * dw, oy + q.y * dh); ctx.stroke();
                });
                ctx.fillStyle = color;
                ctx.strokeStyle = "#f4f8ff";
                person.pose.forEach(p => {
                  if (p.visibility < poseConfidence) return;
                  ctx.beginPath();
                  ctx.arc(ox + p.x * dw, oy + p.y * dh, Math.max(3, 2 * window.devicePixelRatio), 0, Math.PI * 2);
                  ctx.fill();
                  ctx.lineWidth = Math.max(1, window.devicePixelRatio);
                  ctx.stroke();
                });
              }
              if (showIds) { const nose = person.pose[0]; if (nose) { ctx.fillStyle = color; ctx.font = "bold 13px system-ui"; ctx.fillText(`Person ${person.id}`, ox + nose.x * dw + 10, oy + nose.y * dh - 10); } }
          });
          if (showFace && viewMode !== "source" && faceResult?.faceLandmarks) {
            ctx.fillStyle = "#f0abfc";
            faceResult.faceLandmarks.forEach(face => face.forEach((p, index) => {
              if (index % 2 !== 0) return;
              ctx.beginPath(); ctx.arc(ox + p.x * dw, oy + p.y * dh, Math.max(1.25, 1.25 * window.devicePixelRatio), 0, Math.PI * 2); ctx.fill();
            }));
          }
          /* Source-only mode intentionally hides tracking overlays. */
          }
        } catch (e) { setNote(`Tracking frame error: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (playingRef.current && (sourceKindRef.current === "camera" || !v.paused)) rafRef.current = requestAnimationFrame(tick);
    };
    if (sourceKind === "video") void video.play();
    rafRef.current = requestAnimationFrame(tick);
  }

  function playRecordedTake() {
    if (!motionFramesRef.current.length) { setNote("Import a motion JSON take first."); return; }
    if (motionPlaybackTimerRef.current !== null) window.clearInterval(motionPlaybackTimerRef.current);
    const lastTime = Math.max(trimEnd || duration || 0, motionFramesRef.current[motionFramesRef.current.length - 1]?.t || 0);
    if (currentTime >= lastTime) setCurrentTime(trimStart);
    playingRef.current = true;
    setPlaying(true);
    let previous = performance.now();
    motionPlaybackTimerRef.current = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 1000 * playbackRate;
      previous = now;
      setCurrentTime(current => {
        const next = current + delta;
        if (next >= lastTime) {
          if (motionPlaybackTimerRef.current !== null) window.clearInterval(motionPlaybackTimerRef.current);
          motionPlaybackTimerRef.current = null;
          playingRef.current = false;
          setPlaying(false);
          return lastTime;
        }
        return next;
      });
    }, 33);
    setNote("Playing recorded motion take.");
  }

  function stopTracking() {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceKind === "video") videoRef.current?.pause();
    if (recordingRef.current) {
      recordingRef.current = false;
      setRecording(false);
      setNote(`Tracking paused. Take retained with ${motionFramesRef.current.length} frames.`);
      return;
    }
    setNote("Tracking paused.");
  }

  function toggleRecord() {
    if (!recordingRef.current) {
      if (engine !== "ready" || !sourceName || !playingRef.current) {
        setNote("Load the engine, select a source, and start Play / Track before recording.");
        return;
      }
      motionFramesRef.current = [];
      setMotionFrames([]);
      recordingRef.current = true;
      setRecording(true);
      setNote("Recording motion data…");
    } else {
      recordingRef.current = false;
      setRecording(false);
      setMotionFrames([...motionFramesRef.current]);
      setNote(`Motion take saved in memory: ${motionFramesRef.current.length} frames. Export JSON to download it.`);
    }
  }

  function exportMotion() {
    const allFrames = motionFramesRef.current;
    if (allFrames.length === 0) {
      setNote("Nothing to export yet. Import a motion take or record a take first.");
      return;
    }
    const end = trimEnd || duration || Number.POSITIVE_INFINITY;
    const frames = allFrames.filter(frame => frame.t >= trimStart && frame.t <= end);
    if (!frames.length) {
      setNote("The selected trim range contains no recorded motion frames. Adjust the In/Out points first.");
      return;
    }
    const blob = new Blob([JSON.stringify({ format: "mocap-studio-motion-v1", source: sourceName || takeSourceName, sourceDuration: duration, trim: { start: trimStart, end: Number.isFinite(end) ? end : (allFrames[allFrames.length - 1]?.t ?? 0) }, playbackRate, frameCount: frames.length, frames }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "mocap-motion-take.json"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(`Exported ${frames.length} motion frames as JSON using the selected trim range.`);
  }

  useEffect(() => { paint(); }, [sourceName, viewMode]);
  useEffect(() => { drawRecordedFrame(currentTime); }, [currentTime, showBody, showIds, viewMode, poseConfidence, engine]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { const box = canvas.getBoundingClientRect(); canvas.width = Math.max(640, Math.floor(box.width * devicePixelRatio)); canvas.height = Math.max(360, Math.floor(box.height * devicePixelRatio)); paint(); };
    resize(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);

  const topStatus = engine === "ready" ? "ENGINE READY" : engine === "loading" ? "LOADING ENGINE" : engine === "error" ? "ENGINE ERROR" : "ENGINE NOT LOADED";

  return <main className="studio">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>MoCap Studio</strong><span>Motion Capture &amp; Character Integration</span></div></div>
      <nav className="tabs">{["Capture","Cut","Add Character","Preview"].map(t => <button key={t} className={activeTab===t?"tab active":"tab"} onClick={()=>setActiveTab(t)}>{t==="Capture"?<ScanFace size={14}/>:t==="Cut"?<Clapperboard size={14}/>:t==="Add Character"?<Users size={14}/>:<Play size={14}/>} {t}</button>)}</nav>
      <div className="top-actions"><span className={`status ${engine}`}>{topStatus}</span><button className="btn primary" onClick={loadEngine} disabled={engine==="loading"||engine==="ready"}>{engine==="loading"?"Loading…":engine==="ready"?<><Check size={14}/> Ready</>:engine==="error"?"Retry Engine":"Load Engine"}</button><button className="btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Import Video</button><button className="btn" onClick={()=>motionFileRef.current?.click()}><FolderOpen size={14}/> Import Take</button><button className="btn primary" onClick={exportMotion}><Download size={15}/> Export</button></div>
    </header>
    <div className="workspace">
      <aside className="left-panel">
        <div className="panel-heading">ASSETS <button className="icon-btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Add</button></div>
        <section className="section"><h3>Sources <small>{sourceName?"1 item":"0 items"}</small></h3><div className="asset-card"><div className="asset-icon"><FileVideo size={19}/></div><div><strong>{sourceName||"No source loaded"}</strong><span>{sourceName?sourceKind==="camera"?"Live camera source":"Video source":"Import video or use camera"}</span></div></div><input ref={fileRef} hidden type="file" accept="video/*" onChange={e=>{void useVideoFile(e.target.files?.[0]);e.currentTarget.value="";}}/><input ref={motionFileRef} hidden type="file" accept=".json,application/json" onChange={e=>{void importMotionFile(e.target.files?.[0]);e.currentTarget.value="";}}/><div className="button-row"><button className="btn" onClick={()=>fileRef.current?.click()}><Upload size={14}/> Import Video</button><button className="btn" onClick={useCamera}><Camera size={14}/> Use Camera</button></div></section>
        <section className="section project-library"><h3>Projects <small>{savedProjects.length} saved</small></h3><label className="field-label" htmlFor="project-name">Project name</label><input id="project-name" className="project-name-input" value={projectName} maxLength={80} onChange={e=>setProjectName(e.target.value)} placeholder="Name this motion project"/><button className="btn wide" onClick={saveProject}><FolderOpen size={14}/> {currentProjectId?"Save Project":"Save Current Take"}</button><p className="range-help">Projects are stored in this browser only. Export JSON regularly for backup.</p>{savedProjects.length===0?<div className="empty">Saved projects will appear here.</div>:savedProjects.map(project=><div className="saved-project" key={project.id}><button className="saved-project-open" onClick={()=>openProject(project)}><strong>{project.name}</strong><span>{project.frames.length} frames · {new Date(project.updatedAt).toLocaleDateString()}</span></button><button className="icon-btn delete-project" aria-label={`Delete ${project.name}`} title="Delete saved project" onClick={()=>deleteProject(project.id)}>×</button></div>)}</section>
        <section className="section"><h3>Characters <small>No avatar</small></h3><div className="asset-card"><div className="asset-icon"><Users size={19}/></div><div><strong>No character loaded</strong><span>Character import comes in Stage 2</span></div></div><div className="notice">Stage 1 focuses on reliable capture and motion-data export. 3D rig retargeting is next.</div></section>
        <section className="section"><h3>Tracked People <small>{people.length} detected</small></h3>{people.length===0?<div className="empty">Load the engine and start a source to detect people.</div>:people.map(p=><div className="person-row" key={p.id}><span className="person-dot" style={{background:["#5cc8ff","#c084fc","#34d399","#fbbf24","#fb7185"][(p.id-1)%5]}}/><strong>Person {p.id}</strong><span>{p.pose.length} landmarks</span></div>)}</section>
        <div className="left-footer"><ShieldCheck size={14}/> Local inference · video stays in browser</div>
      </aside>
      <section className="center-panel">
        <div className="viewport-toolbar"><label>View <select value={viewMode} onChange={e => setViewMode(e.target.value as "tracking" | "source" | "skeleton")}><option value="tracking">Source + Tracking</option><option value="source">Source only</option><option value="skeleton">Skeleton only</option></select></label><label className="check"><input type="checkbox" checked={showBody} onChange={e=>setShowBody(e.target.checked)}/> Body</label><label className="check"><input type="checkbox" checked={showFace} onChange={e=>setShowFace(e.target.checked)}/> Face</label><label className="check"><input type="checkbox" checked={showIds} onChange={e=>setShowIds(e.target.checked)}/> IDs</label><span className="source-status">{sourceName||"Waiting for source"}</span></div>
        <div className="viewport"><video ref={videoRef} className="hidden-video" style={{opacity:viewMode==="skeleton"?0:1}} playsInline muted onLoadedMetadata={e=>{const v=e.currentTarget;const d=Number.isFinite(v.duration)?v.duration:0;setDuration(d);setTrimStart(0);setTrimEnd(d);setCurrentTime(v.currentTime||0);paint();}} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime)} onEnded={()=>{playingRef.current=false;setPlaying(false);setNote("Video ended.");}}/><canvas ref={canvasRef} className="capture-canvas" /><div className="viewport-counters"><span>{sourceName?"SOURCE LOADED":"NO SOURCE"}</span><span>{people.length} PEOPLE</span></div>{!sourceName&&<div className="viewport-overlay"><div className="big-icon"><Activity size={26}/></div><strong>Ready to capture motion</strong><span>Load the engine, then import a video or connect your camera.</span></div>}</div>
        <div className="transport"><button className="btn" onClick={playing?stopTracking:(sourceName?startTracking:playRecordedTake)} disabled={!sourceName&&!motionFrames.length}>{playing?<Square size={14}/>:<Play size={14}/>} {playing?"Pause / Stop":"Play / Track"}</button><button className="btn" onClick={()=>seekTo(currentTime-5)} disabled={!duration}><SkipBack size={14}/> 5s</button><button className="btn" onClick={()=>seekTo(currentTime+5)} disabled={!duration}>5s <SkipForward size={14}/></button><label className="speed-control">Speed <select value={playbackRate} onChange={e=>setRate(Number(e.target.value))} disabled={sourceKind!=="video"&&!motionFrames.length}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button className={`btn ${recording?"danger":""}`} onClick={toggleRecord}>{recording?<Square size={14}/>:<CircleHelp size={14}/>} {recording?"Stop Take":"Record Take"}</button><span className="transport-note">{note}</span></div>
        <div className="timeline"><div className="timeline-head"><strong>{activeTab==="Cut"?"Cut & Trim Timeline":"Timeline"}</strong><span>{formatTime(currentTime)} / {formatTime(duration)} · {motionFrames.length} motion frames</span></div><input aria-label="Seek video timeline" className="timeline-seek" type="range" min="0" max={Math.max(duration,0.01)} step="0.01" value={Math.min(currentTime,Math.max(duration,0.01))} onChange={e=>seekTo(Number(e.target.value))} disabled={!duration||(!sourceKind&&!motionFrames.length)||(sourceKind==="camera")}/><div className="ruler"><span>00:00</span><span>{formatTime(duration*.25)}</span><span>{formatTime(duration*.5)}</span><span>{formatTime(duration*.75)}</span><span>{formatTime(duration)}</span></div><div className="track"><span>Source video · {sourceName||"No clip"}</span>{duration>0&&<i style={{left:(trimStart/duration*100)+"%",width:(Math.max(0,(trimEnd-trimStart)/duration*100))+"%"}}/>}</div>{activeTab==="Cut"&&<div className="timeline-trim"><span>IN <b>{formatTime(trimStart)}</b></span><button className="btn" onClick={markTrimStart} disabled={!duration}>Set In at Playhead</button><button className="btn" onClick={markTrimEnd} disabled={!duration}>Set Out at Playhead</button><button className="btn" onClick={resetTrim} disabled={!duration}>Reset</button><span>OUT <b>{formatTime(trimEnd)}</b></span></div>}</div>
      </section>
      <aside className="right-panel"><div className="panel-heading">PROPERTIES <span>{activeTab.toUpperCase()}</span></div><section className="section"><h3>Detection</h3><label className="toggle-line"><input type="checkbox" checked={showFace} onChange={e=>{setShowFace(e.target.checked);setNote("Face tracking preference changed. Click Apply Detection Settings to reload the engine with this option.");}}/><span>Enable face tracking <small>Uses extra processing</small></span></label><label className="range-label">Body sensitivity <b>{poseConfidence.toFixed(2)}</b></label><input className="range" type="range" min=".1" max=".95" step=".05" value={poseConfidence} onChange={e=>setPoseConfidence(Number(e.target.value))}/><p className="range-help">Lower values detect more uncertain or partly obscured joints. Higher values filter out weaker detections.</p><label className="range-label">Face sensitivity <b>{faceConfidence.toFixed(2)}</b></label><input className="range" type="range" min=".1" max=".95" step=".05" value={faceConfidence} onChange={e=>setFaceConfidence(Number(e.target.value))}/><label className="field-label">Maximum people</label><select className="wide-select" value={maxPeople} onChange={e=>setMaxPeople(e.target.value)}><option value="1">1 person</option><option value="2">2 people</option><option value="3">3 people</option><option value="4">4 people</option><option value="5">5 people</option><option value="8">8 people</option></select><button className="btn wide" onClick={()=>{if(engine==="ready"){poseRef.current?.close();faceRef.current?.close();setEngine("idle");setEngineMessage("Reload engine to apply detection settings.");}setNote("Detection settings saved for the next engine load.");}}><Settings2 size={14}/> Apply Detection Settings</button></section><section className="section"><h3>Capture Engine</h3><div className={`engine-card ${engine}`}><div className="engine-dot"/><div><strong>{topStatus}</strong><span>{engineMessage}</span></div></div><div className="notice">Higher body sensitivity and the expanded skeleton overlay help reveal more landmarks. The lightweight pose model tracks 33 body points; detailed finger articulation requires a dedicated hand model. Face tracking loads a second model and can reduce performance on lower-powered devices.</div></section><section className="section"><h3>Next stages</h3><div className="feature"><Layers size={16}/><span>3D avatar rig mapping</span><small>Stage 2</small></div><div className="feature"><ScanFace size={16}/><span>Facial blendshape retargeting</span><small>Stage 2</small></div><div className="feature"><Video size={16}/><span>Rendered video export</span><small>Stage 3</small></div><div className="feature"><FolderOpen size={16}/><span>Save projects to Supabase</span><small>Stage 3</small></div></section></aside>
    </div>
    <footer className="statusbar"><span><span className="green-dot"/> Browser-local inference</span><span><Gauge size={13}/> Body-first inference · up to 15 FPS</span><span><Sparkles size={13}/> MoCap Studio · Stage 1 foundation</span></footer>
  </main>;
}
