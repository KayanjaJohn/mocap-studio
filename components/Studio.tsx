"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity, Camera, Check, ChevronDown, CircleHelp, Clapperboard, Download,
  FileVideo, FolderOpen, Gauge, Layers, Play, Plus, ScanFace, Settings2,
  ShieldCheck, Sparkles, Square, Upload, Users, Video, WandSparkles
} from "lucide-react";
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";

type EngineState = "idle" | "loading" | "ready" | "error";
type CapturePerson = { id: number; pose: { x: number; y: number; visibility: number }[]; faceBlendshapes: Record<string, number> };

const POSE_CONNECTIONS: [number, number][] = [
  [11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
  [23,25],[25,27],[27,31],[24,26],[26,28],[28,32],[15,17],[15,19],[15,21],[16,18],[16,20],[16,22]
];

export default function Studio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(-1);
  const recordingRef = useRef(false);
  const playingRef = useRef(false);
  const sourceKindRef = useRef<"video" | "camera" | null>(null);
  const motionFramesRef = useRef<{ t: number; people: CapturePerson[] }[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const [engine, setEngine] = useState<EngineState>("idle");
  const [engineMessage, setEngineMessage] = useState("Capture engine not loaded");
  const [sourceName, setSourceName] = useState("");
  const [sourceKind, setSourceKind] = useState<"video" | "camera" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [people, setPeople] = useState<CapturePerson[]>([]);
  const [maxPeople, setMaxPeople] = useState("5");
  const [showBody, setShowBody] = useState(true);
  const [showFace, setShowFace] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [poseConfidence, setPoseConfidence] = useState(0.55);
  const [faceConfidence, setFaceConfidence] = useState(0.5);
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

  function paint() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080e1a"; ctx.fillRect(0, 0, w, h);
    if (viewMode !== "skeleton" && video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
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
      const face = await FaceLandmarker.createFromOptions(fileset, {
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
      poseRef.current = pose; faceRef.current = face; setEngine("ready");
      setEngineMessage("Engine ready · body and face models loaded locally");
      setNote("Capture engine ready. Import a video or connect your camera.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setEngine("error");
      setEngineMessage(`Engine failed: ${message}. Install the model assets in public/models and WASM files in public/mediapipe/wasm.`);
      setNote("Model files are not bundled yet. See README for the setup step.");
    }
  }

  async function useVideoFile(file?: File) {
    if (!file || !videoRef.current) return;
    playingRef.current = false;
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
    if (!video || !poseRef.current || !faceRef.current) { setNote("Load the capture engine and select a source first."); return; }
    playingRef.current = true;
    setPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const v = videoRef.current, canvas = canvasRef.current;
      if (!v || !canvas || !poseRef.current || !faceRef.current) return;
      if (v.readyState >= 2 && v.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = v.currentTime;
        const timestamp = performance.now();
        try {
          const poseResult = poseRef.current.detectForVideo(v, timestamp);
          const faceResult = showFace ? faceRef.current.detectForVideo(v, timestamp) : null;
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
          setPeople(next);
          if (recordingRef.current) {
            const frame = { t: v.currentTime, people: next };
            motionFramesRef.current = [...motionFramesRef.current, frame];
            setMotionFrames(motionFramesRef.current);
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const scale = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
            const dw = v.videoWidth * scale, dh = v.videoHeight * scale, ox = (canvas.width - dw) / 2, oy = (canvas.height - dh) / 2;
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#080e1a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (viewMode !== "skeleton") ctx.drawImage(v, ox, oy, dw, dh);
            if (viewMode !== "source") next.forEach((person, pi) => {
              const color = ["#5cc8ff", "#c084fc", "#34d399", "#fbbf24", "#fb7185"][pi % 5];
              if (showBody) {
                ctx.strokeStyle = color; ctx.lineWidth = 2.5;
                POSE_CONNECTIONS.forEach(([a,b]) => {
                  const p = person.pose[a], q = person.pose[b];
                  if (!p || !q || p.visibility < poseConfidence || q.visibility < poseConfidence) return;
                  ctx.beginPath(); ctx.moveTo(ox + p.x * dw, oy + p.y * dh); ctx.lineTo(ox + q.x * dw, oy + q.y * dh); ctx.stroke();
                });
                ctx.fillStyle = color;
                person.pose.forEach(p => { if (p.visibility >= poseConfidence) { ctx.beginPath(); ctx.arc(ox + p.x * dw, oy + p.y * dh, 3, 0, Math.PI * 2); ctx.fill(); } });
              }
              if (showIds) { const nose = person.pose[0]; if (nose) { ctx.fillStyle = color; ctx.font = "bold 13px system-ui"; ctx.fillText(`Person ${person.id}`, ox + nose.x * dw + 10, oy + nose.y * dh - 10); } }
          });
          if (showFace && viewMode !== "source" && faceResult?.faceLandmarks) {
            ctx.fillStyle = "#f0abfc";
            faceResult.faceLandmarks.forEach(face => face.forEach((p, index) => {
              if (index % 4 !== 0) return;
              ctx.beginPath(); ctx.arc(ox + p.x * dw, oy + p.y * dh, 1.25, 0, Math.PI * 2); ctx.fill();
            }));
          }
          /* Source-only mode intentionally hides tracking overlays. */
          }
        } catch (e) { setNote(`Tracking frame error: ${e instanceof Error ? e.message : String(e)}`); }
      } else paint();
      if (playingRef.current && (sourceKindRef.current === "camera" || !v.paused)) rafRef.current = requestAnimationFrame(tick);
    };
    if (sourceKind === "video") void video.play();
    rafRef.current = requestAnimationFrame(tick);
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
      setNote(`Motion take saved in memory: ${motionFramesRef.current.length} frames. Export JSON to download it.`);
    }
  }

  function exportMotion() {
    const frames = motionFramesRef.current;
    if (frames.length === 0) {
      setNote("Nothing to export yet. Start tracking, record a take, then export.");
      return;
    }
    const blob = new Blob([JSON.stringify({ format: "mocap-studio-motion-v1", source: sourceName, frameCount: frames.length, frames }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "mocap-motion-take.json"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(`Exported ${frames.length} motion frames as JSON.`);
  }

  useEffect(() => { paint(); }, [sourceName, viewMode]);
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
      <div className="top-actions"><span className={`status ${engine}`}>{topStatus}</span><button className="btn primary" onClick={loadEngine} disabled={engine==="loading"||engine==="ready"}>{engine==="loading"?"Loading…":engine==="ready"?<><Check size={14}/> Ready</>:engine==="error"?"Retry Engine":"Load Engine"}</button><button className="btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Import</button><button className="btn primary" onClick={exportMotion}><Download size={15}/> Export</button></div>
    </header>
    <div className="workspace">
      <aside className="left-panel">
        <div className="panel-heading">ASSETS <button className="icon-btn" onClick={()=>fileRef.current?.click()}><Plus size={15}/> Add</button></div>
        <section className="section"><h3>Sources <small>{sourceName?"1 item":"0 items"}</small></h3><div className="asset-card"><div className="asset-icon"><FileVideo size={19}/></div><div><strong>{sourceName||"No source loaded"}</strong><span>{sourceName?sourceKind==="camera"?"Live camera source":"Video source":"Import video or use camera"}</span></div></div><input ref={fileRef} hidden type="file" accept="video/*" onChange={e=>void useVideoFile(e.target.files?.[0])}/><div className="button-row"><button className="btn" onClick={()=>fileRef.current?.click()}><Upload size={14}/> Import Video</button><button className="btn" onClick={useCamera}><Camera size={14}/> Use Camera</button></div></section>
        <section className="section"><h3>Characters <small>No avatar</small></h3><div className="asset-card"><div className="asset-icon"><Users size={19}/></div><div><strong>No character loaded</strong><span>Character import comes in Stage 2</span></div></div><div className="notice">Stage 1 focuses on reliable capture and motion-data export. 3D rig retargeting is next.</div></section>
        <section className="section"><h3>Tracked People <small>{people.length} detected</small></h3>{people.length===0?<div className="empty">Load the engine and start a source to detect people.</div>:people.map(p=><div className="person-row" key={p.id}><span className="person-dot" style={{background:["#5cc8ff","#c084fc","#34d399","#fbbf24","#fb7185"][(p.id-1)%5]}}/><strong>Person {p.id}</strong><span>{p.pose.length} landmarks</span></div>)}</section>
        <div className="left-footer"><ShieldCheck size={14}/> Local inference · video stays in browser</div>
      </aside>
      <section className="center-panel">
        <div className="viewport-toolbar"><label>View <select value={viewMode} onChange={e => setViewMode(e.target.value as "tracking" | "source" | "skeleton")}><option value="tracking">Source + Tracking</option><option value="source">Source only</option><option value="skeleton">Skeleton only</option></select></label><label className="check"><input type="checkbox" checked={showBody} onChange={e=>setShowBody(e.target.checked)}/> Body</label><label className="check"><input type="checkbox" checked={showFace} onChange={e=>setShowFace(e.target.checked)}/> Face</label><label className="check"><input type="checkbox" checked={showIds} onChange={e=>setShowIds(e.target.checked)}/> IDs</label><span className="source-status">{sourceName||"Waiting for source"}</span></div>
        <div className="viewport"><video ref={videoRef} className="hidden-video" playsInline muted onLoadedMetadata={paint} onEnded={()=>{playingRef.current=false;setPlaying(false);setNote("Video ended.");}}/><canvas ref={canvasRef} className="capture-canvas" /><div className="viewport-counters"><span>{sourceName?"SOURCE LOADED":"NO SOURCE"}</span><span>{people.length} PEOPLE</span></div>{!sourceName&&<div className="viewport-overlay"><div className="big-icon"><Activity size={26}/></div><strong>Ready to capture motion</strong><span>Load the engine, then import a video or connect your camera.</span></div>}</div>
        <div className="transport"><button className="btn" onClick={playing?stopTracking:startTracking}>{playing?<Square size={14}/>:<Play size={14}/>} {playing?"Stop":"Play / Track"}</button><button className={`btn ${recording?"danger":""}`} onClick={toggleRecord}>{recording?<Square size={14}/>:<CircleHelp size={14}/>} {recording?"Stop Take":"Record Take"}</button><span className="transport-note">{note}</span></div>
        <div className="timeline"><div className="timeline-head"><strong>Timeline</strong><span>{motionFrames.length} captured frames</span></div><div className="ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span><span>00:20</span></div><div className="track"><span>Body / face motion</span>{recording&&<i/>}</div></div>
      </section>
      <aside className="right-panel"><div className="panel-heading">PROPERTIES <span>{activeTab.toUpperCase()}</span></div><section className="section"><h3>Detection</h3><label className="range-label">Body confidence <b>{poseConfidence.toFixed(2)}</b></label><input className="range" type="range" min=".1" max=".95" step=".05" value={poseConfidence} onChange={e=>setPoseConfidence(Number(e.target.value))}/><label className="range-label">Face confidence <b>{faceConfidence.toFixed(2)}</b></label><input className="range" type="range" min=".1" max=".95" step=".05" value={faceConfidence} onChange={e=>setFaceConfidence(Number(e.target.value))}/><label className="field-label">Maximum people</label><select className="wide-select" value={maxPeople} onChange={e=>setMaxPeople(e.target.value)}><option value="1">1 person</option><option value="2">2 people</option><option value="3">3 people</option><option value="4">4 people</option><option value="5">5 people</option><option value="8">8 people</option></select><button className="btn wide" onClick={()=>{if(engine==="ready"){poseRef.current?.close();faceRef.current?.close();setEngine("idle");setEngineMessage("Reload engine to apply detection settings.");}setNote("Detection settings saved for the next engine load.");}}><Settings2 size={14}/> Apply Detection Settings</button></section><section className="section"><h3>Capture Engine</h3><div className={`engine-card ${engine}`}><div className="engine-dot"/><div><strong>{topStatus}</strong><span>{engineMessage}</span></div></div><div className="notice">Stage 1: body landmarks and face blendshapes. The tracking runtime and model assets must be installed locally for this to run without external CDN imports.</div></section><section className="section"><h3>Next stages</h3><div className="feature"><Layers size={16}/><span>3D avatar rig mapping</span><small>Stage 2</small></div><div className="feature"><ScanFace size={16}/><span>Facial blendshape retargeting</span><small>Stage 2</small></div><div className="feature"><Video size={16}/><span>Rendered video export</span><small>Stage 3</small></div><div className="feature"><FolderOpen size={16}/><span>Save projects to Supabase</span><small>Stage 3</small></div></section></aside>
    </div>
    <footer className="statusbar"><span><span className="green-dot"/> Browser-local inference</span><span><Gauge size={13}/> Capture at source frame rate</span><span><Sparkles size={13}/> MoCap Studio · Stage 1 foundation</span></footer>
  </main>;
}
