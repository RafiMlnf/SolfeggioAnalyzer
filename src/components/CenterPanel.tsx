"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { AnalysisState, AnalysisResult } from "@/types";

interface CenterPanelProps {
  analysisState: AnalysisState;
  analysisResult: AnalysisResult | null;
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
}

// ── Y-axis labels ───────────────────────────────────────────────
const SOLFEGE_LABELS = [
  "ï Do'", "7̇ Si'", "6̇ La'", "5̇ Sol'", "4̇ Fa'", "3̇ Mi'", "2̇ Re'",
  "1 Do", "7 Si", "6 La", "5 Sol", "4 Fa", "3 Mi", "2 Re",
  "1̣ Do,", "7̣ Si,", "6̣ La,", "5̣ Sol,", "4̣ Fa,", "3̣ Mi,", "2̣ Re,",
];

// Key Hz frequencies shown as labels on spectrogram Y-axis
const SPEC_FREQ_LABELS: { label: string; normPos: number }[] = [
  { label: "8k", normPos: 0.02 },
  { label: "4k", normPos: 0.15 },
  { label: "2k", normPos: 0.28 },
  { label: "1k", normPos: 0.42 },
  { label: "500", normPos: 0.55 },
  { label: "250", normPos: 0.68 },
  { label: "100", normPos: 0.82 },
  { label: "50", normPos: 0.95 },
];

// ── Heat color scale ────────────────────────────────────────────
const HEAT = ["#0d0d1a", "#131340", "#1a1a6e", "#1f3a9e", "#2060a0", "#1e8080", "#28a850", "#7ab820", "#c8b010", "#e88010", "#e84030", "#ef4444", "#ff8888"];
function heatColor(v: number): string {
  const i = Math.floor(Math.max(0, Math.min(1, v)) * (HEAT.length - 1));
  return HEAT[i];
}

// ── Mock data generators with animation support ─────────────
function mockHeatmap(phase: number): number[][] {
  return Array.from({ length: 300 }, (_, t) =>
    Array.from({ length: 21 }, (_, n) => {
      const b = n % 7;
      // Base value with some randomness and time-based oscillation
      let v = b === 5 ? 0.35 + Math.sin(phase * 0.05 + t * 0.02) * 0.15
        : b === 0 ? 0.25 + Math.cos(phase * 0.04 + t * 0.03) * 0.1
          : b === 4 ? 0.15 + Math.sin(phase * 0.06 + t * 0.01) * 0.1
            : 0.05 + Math.random() * 0.05;

      // Add moving waves
      v += Math.sin(t * 0.1 + n * 0.4 + phase * 0.1) * 0.15;
      v += Math.cos(t * 0.05 - n * 0.2 + phase * 0.07) * 0.1;

      return Math.max(0, Math.min(1, v));
    })
  );
}

function mockSpectrogram(phase: number): number[][] {
  return Array.from({ length: 300 }, (_, t) =>
    Array.from({ length: 48 }, (_, b) => {
      const w = Math.pow((48 - b) / 48, 1.8);
      // Smooth frequency noise with time oscillation
      let v = w * (0.3 + Math.sin(phase * 0.03 + t * 0.1) * 0.1);

      // Add harmonic-like bands that drift
      const h1 = Math.sin(t * 0.05 + phase * 0.05) * 5 + 10;
      const h2 = Math.cos(t * 0.03 + phase * 0.04) * 8 + 25;
      if (Math.abs(b - h1) < 2 || Math.abs(b - h2) < 3) {
        v += 0.2 * w;
      }

      // Random sparkles
      if (Math.random() > 0.98) v += 0.3;

      return Math.max(0, Math.min(1, v));
    })
  );
}

// ── Canvas renderer ─────────────────────────────────────────────
function drawCanvas(
  canvas: HTMLCanvasElement,
  data: number[][],
  startSlice: number,
  endSlice: number,
  viewMode: "heatmap" | "spectrogram",
  currentTime: number,
  duration: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const visible = data.slice(startSlice, endSlice);
  const T = visible.length;
  const N = data[0]?.length ?? 1;
  const cW = W / Math.max(T, 1);
  const cH = H / N;

  // Background
  ctx.fillStyle = "#0d0d1a";
  ctx.fillRect(0, 0, W, H);

  // Cells
  for (let t = 0; t < T; t++) {
    for (let n = 0; n < N; n++) {
      const v = visible[t][n];
      if (v < 0.04) continue;
      ctx.fillStyle = heatColor(v);
      ctx.fillRect(t * cW, n * cH, Math.max(1, cW - 0.3), cH - 0.3);
    }
  }

  // ── Grid overlay ──
  ctx.save();

  if (viewMode === "heatmap") {
    // Horizontal lines — note boundaries
    for (let n = 0; n <= N; n++) {
      const y = n * cH;
      const isOctave = n % 7 === 0;
      ctx.strokeStyle = isOctave ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = isOctave ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Highlight root note (Do) rows
    [7, 0, 14].forEach(idx => {
      ctx.fillStyle = "rgba(99,102,241,0.04)";
      ctx.fillRect(0, idx * cH, W, cH);
    });
  } else {
    // Spectrogram horizontal grid at key frequency positions
    SPEC_FREQ_LABELS.forEach(({ label, normPos }) => {
      const y = normPos * H;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      // Inline freq label on canvas
      ctx.fillStyle = "rgba(161,161,170,0.7)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillText(label, 3, y - 2);
    });
  }

  // Vertical time grid — every ~30 visible slices
  const gridStep = Math.max(1, Math.floor(30 * T / 300));
  for (let t = 0; t <= T; t += gridStep) {
    const x = t * cW;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  ctx.restore();


  // Playhead
  if (duration > 0 && currentTime > 0) {
    const total = data.length;
    const curSlice = Math.floor((currentTime / duration) * total);
    if (curSlice >= startSlice && curSlice <= endSlice) {
      const px = ((curSlice - startSlice) / T) * W;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      // Playhead marker triangle
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(px - 4, 0);
      ctx.lineTo(px + 4, 0);
      ctx.lineTo(px, 6);
      ctx.fill();
    }
  }
}

// ── Main Component ──────────────────────────────────────────────
export default function CenterPanel({ analysisState, analysisResult, currentTime, duration, onSeek }: CenterPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastDragX = useRef(0);

  const [viewMode, setViewMode] = useState<"heatmap" | "spectrogram">("heatmap");
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [zoomX, setZoomX] = useState(1);
  const [panX, setPanX] = useState(0); // 0..1
  const [animTime, setAnimTime] = useState(0);

  const isReady = analysisState === "complete";

  // Animation loop when not ready
  useEffect(() => {
    if (isReady) return;
    let frameId: number;
    const update = () => {
      setAnimTime(t => t + 1);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [isReady]);

  const activeData = useMemo(() => {
    if (isReady) {
      return viewMode === "heatmap" ? analysisResult!.heatmapData : analysisResult!.spectrogramData;
    }
    return viewMode === "heatmap" ? mockHeatmap(animTime) : mockSpectrogram(animTime);
  }, [isReady, viewMode, analysisResult, animTime]);

  // Compute visible slice range
  const totalSlices = activeData?.length ?? 1;
  const visibleSlices = Math.max(1, Math.floor(totalSlices / zoomX));
  const maxPan = Math.max(0, totalSlices - visibleSlices);
  const startSlice = Math.floor(panX * maxPan);
  const endSlice = Math.min(totalSlices, startSlice + visibleSlices);

  // Render canvas
  const render = useCallback(() => {
    if (!canvasRef.current || !wrapperRef.current || !activeData?.length) return;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;

    drawCanvas(canvas, activeData, startSlice, endSlice, viewMode, currentTime, duration);
  }, [activeData, startSlice, endSlice, viewMode, currentTime, duration]);

  useEffect(() => { render(); }, [render]);

  // Click-to-seek
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !duration || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const clickFrac = (e.clientX - rect.left) / rect.width;
    // Map click fraction within visible window back to full-timeline time
    const visibleFrac = 1 / zoomX;
    const startFrac = panX * (1 - visibleFrac);
    const timeFrac = startFrac + clickFrac * visibleFrac;
    onSeek(Math.max(0, Math.min(duration, timeFrac * duration)));
  }, [onSeek, duration, zoomX, panX]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(render);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [render]);

  // Mouse wheel zoom & pan (non-passive so we can preventDefault)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Zoom in/out (also handles touchpad pinch → ctrlKey+wheel)
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        setZoomX(z => Math.max(1, Math.min(32, z * factor)));
      } else {
        // Pan horizontally (deltaX for horizontal scroll, deltaY fallback)
        const delta = (e.deltaX !== 0 ? e.deltaX : e.deltaY) / 600;
        setPanX(p => Math.max(0, Math.min(1, p + delta)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag to pan
  const onMouseDown = (e: React.MouseEvent) => { isDragging.current = true; lastDragX.current = e.clientX; };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastDragX.current;
    lastDragX.current = e.clientX;
    setPanX(p => Math.max(0, Math.min(1, p - dx / ((wrapperRef.current?.clientWidth ?? 800) * zoomX))));
  };
  const onMouseUp = () => { isDragging.current = false; };

  const yLabels = viewMode === "heatmap" ? SOLFEGE_LABELS : null;

  // ── Lyrics matching: find active index based on currentTime ──
  const lyrics = isReady ? (analysisResult?.lyrics ?? []) : [];
  const hasLyrics = lyrics.length > 0;

  // Active = last chunk whose start <= currentTime
  const activeIdx = useMemo(() => {
    if (!hasLyrics || currentTime <= 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].timestamp[0] <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [lyrics, currentTime, hasLyrics]);

  return (
    <div className="panel-center">
      {/* Toolbar */}
      <div className="heatmap-toolbar">
        <div className="heatmap-toolbar__group">
          <span className="toolbar-label">View:</span>
          <button className={`toolbar-btn ${viewMode === "heatmap" ? "toolbar-btn--active" : ""}`} onClick={() => setViewMode("heatmap")}>
            Notation Heatmap
          </button>
          <button className={`toolbar-btn ${viewMode === "spectrogram" ? "toolbar-btn--active" : ""}`} onClick={() => setViewMode("spectrogram")}>
            Spectrogram
          </button>
          <div className="toolbar-separator" />
          <span className="toolbar-label">Zoom:</span>
          <button className="toolbar-btn" onClick={() => setZoomX(z => Math.max(1, z / 1.5))}>−</button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", minWidth: 36, textAlign: "center" }}>
            {zoomX.toFixed(1)}×
          </span>
          <button className="toolbar-btn" onClick={() => setZoomX(z => Math.min(32, z * 1.5))}>+</button>
          <button className="toolbar-btn" onClick={() => { setZoomX(1); setPanX(0); }}>Reset</button>
        </div>
        <div className="heatmap-toolbar__group">
          {isReady && (
            <span className="toolbar-label" style={{ color: "var(--accent-primary)" }}>
              {viewMode === "heatmap" ? "Y: Solfeggio Notation" : "Y: Frequency (Hz log)"}
              &nbsp;|&nbsp;Slices {startSlice}–{endSlice}/{totalSlices}
            </span>
          )}
          <div className="toolbar-separator" />
          <div className="color-scale">
            <span>0</span>
            <div className="color-scale__bar">
              {HEAT.map((c, i) => <div key={i} className="color-scale__segment" style={{ background: c }} />)}
            </div>
            <span>Max</span>
          </div>
        </div>
      </div>

      {/* Hint bar */}
      <div style={{ padding: "2px 8px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)", fontFamily: "var(--font-mono)", fontSize: "7px", color: "var(--text-dim)", display: "flex", gap: 16 }}>
        <span>🖱 Scroll → Pan &nbsp;|&nbsp; Ctrl+Scroll / Pinch → Zoom &nbsp;|&nbsp; Drag → Pan</span>
        <span style={{ marginLeft: "auto" }}>Grid: ◉ Octave boundary &nbsp; ◌ Note boundary</span>
      </div>

      {/* Heatmap area */}
      {isReady || true ? ( // always show (show mock when idle)
        <div className="heatmap-container">
          {/* Y-axis */}
          <div className="heatmap-y-axis">
            {viewMode === "heatmap" && yLabels
              ? yLabels.map((label, i) => (
                <div key={i} className={`heatmap-y-label ${label.startsWith("1 ") || label.startsWith("1̣") ? "heatmap-y-label--root" : ""}`}>
                  {label}
                </div>
              ))
              : SPEC_FREQ_LABELS.map(({ label, normPos }) => (
                <div key={label} className="heatmap-y-label" style={{ position: "absolute", top: `${normPos * 100}%`, transform: "translateY(-50%)" }}>
                  {label}
                </div>
              ))
            }
          </div>

          {/* Canvas */}
          <div
            className="heatmap-canvas-wrapper"
            ref={wrapperRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onClick={handleCanvasClick}
            style={{ cursor: isDragging.current ? "grabbing" : onSeek ? "crosshair" : "grab" }}
          >
            <canvas ref={canvasRef} className="heatmap-canvas" />

            {/* Zoom % overlay */}
            <div style={{ position: "absolute", top: 4, right: 6, fontFamily: "var(--font-mono)", fontSize: "8px", color: "var(--text-dim)", pointerEvents: "none" }}>
              {Math.round(zoomX * 100)}%
            </div>
          </div>

          <div className="heatmap-corner" />
          <div className="heatmap-x-axis" style={{ display: "flex", justifyContent: "space-between", padding: "0 10px", alignItems: "center", minHeight: 28 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "7px", color: "var(--text-dim)" }}>
              ← {viewMode === "spectrogram" ? "Freq. amplitude over time" : "Melodic notation over time"}&nbsp;
              ({duration > 0 ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : "--:--"}) →
            </span>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon">{analysisState === "processing" ? "⟳" : "♪"}</div>
          <div className="empty-state__text">
            {analysisState === "processing" ? "Analyzing..." : analysisState === "loaded" ? 'Press "Analyze"' : "Upload MP3/WAV"}
          </div>
        </div>
      )}

      {/* ── Lyrics Drawer (collapsible, bottom) ── */}
      {isReady && (
        <div className="lyrics-drawer">
          <button
            className="lyrics-drawer__toggle"
            onClick={() => setLyricsOpen(o => !o)}
          >
            <span className="lyrics-drawer__toggle-icon">{lyricsOpen ? "▾" : "▸"}</span>
            <span>Lyrics</span>
            {hasLyrics && activeIdx >= 0 && (
              <span className="lyrics-drawer__badge">
                {activeIdx + 1} / {lyrics.length}
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: "8px", color: "var(--text-dim)" }}>
              {hasLyrics ? "LRCLIB synced" : "No lyrics"}
            </span>
          </button>

          {lyricsOpen && (
            <div className="lyrics-drawer__body">
              {!hasLyrics ? (
                <div className="lyrics-empty">♪ Lyrics tidak tersedia untuk lagu ini</div>
              ) : (
                <div className="lyrics-scroll">
                  {/* Show window: 2 before active, active, 2 after */}
                  {[-2, -1, 0, 1, 2].map(offset => {
                    const idx = activeIdx + offset;
                    if (idx < 0 || idx >= lyrics.length) return null;
                    const chunk = lyrics[idx];
                    const isActive = offset === 0;
                    const isPrev = offset < 0;
                    return (
                      <div
                        key={idx}
                        className={`lyric-line ${
                          isActive ? "lyric-line--active" : isPrev ? "lyric-line--prev" : "lyric-line--next"
                        }`}
                      >
                        {chunk.text}
                      </div>
                    );
                  })}
                  {activeIdx < 0 && (
                    <div className="lyrics-empty">♪ Play to see lyrics</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
