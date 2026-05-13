"use client";

import { useRef, useCallback } from "react";
import { AnalysisState, AudioFileInfo } from "@/types";

interface LeftPanelProps {
  audioFile: AudioFileInfo | null;
  analysisState: AnalysisState;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  onFileUpload: (file: File) => void;
  onAnalyze: () => void;
  onPlayPause: () => void;
  onStop: () => void;
}

export default function LeftPanel({
  audioFile,
  analysisState,
  isPlaying,
  currentTime,
  duration,
  progress,
  onFileUpload,
  onAnalyze,
  onPlayPause,
  onStop,
}: LeftPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(2, "0")}`;
  };

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.type === "audio/mpeg" || file.type === "audio/wav" || file.type === "audio/mp3")) {
        onFileUpload(file);
      }
    },
    [onFileUpload]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="panel-left">
      {/* FILE INPUT */}
      <div className="panel-section">
        <div className="panel-section__header">
          <span className="panel-section__title">◈ Audio Source</span>
          <span className="panel-section__toggle">▾</span>
        </div>
        <div className="panel-section__body">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp3"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload(file);
            }}
          />
          <div
            className={`upload-zone ${audioFile ? "upload-zone--active" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {audioFile ? (
              <>
                <div className="upload-zone__icon">♫</div>
                <div className="upload-zone__text" style={{ color: "var(--text-primary)" }}>
                  {audioFile.name}
                </div>
                <div className="upload-zone__formats">Click to change file</div>
              </>
            ) : (
              <>
                <div className="upload-zone__icon">⬆</div>
                <div className="upload-zone__text">
                  Drop <span className="upload-zone__text--accent">MP3/WAV</span> here
                </div>
                <div className="upload-zone__formats">or click to browse</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* FILE INFO */}
      {audioFile && (
        <div className="panel-section">
          <div className="panel-section__header">
            <span className="panel-section__title">◈ File Metadata</span>
            <span className="panel-section__toggle">▾</span>
          </div>
          <div className="panel-section__body">
            <div className="file-info">
              <div className="file-info__row">
                <span className="file-info__label">Format</span>
                <span className="file-info__value">
                  {audioFile.type === "audio/mpeg" ? "MP3" : "WAV"}
                </span>
              </div>
              <div className="file-info__row">
                <span className="file-info__label">Size</span>
                <span className="file-info__value">{formatSize(audioFile.size)}</span>
              </div>
              <div className="file-info__row">
                <span className="file-info__label">Duration</span>
                <span className="file-info__value">
                  {audioFile.duration > 0 ? formatTime(audioFile.duration) : "Decoding..."}
                </span>
              </div>
              <div className="file-info__row">
                <span className="file-info__label">Sample Rate</span>
                <span className="file-info__value">
                  {audioFile.sampleRate > 0 ? `${audioFile.sampleRate} Hz` : "—"}
                </span>
              </div>
              <div className="file-info__row">
                <span className="file-info__label">Channels</span>
                <span className="file-info__value">
                  {audioFile.channels > 0
                    ? `${audioFile.channels} (${audioFile.channels === 1 ? "Mono" : "Stereo"})`
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRANSPORT */}
      {audioFile && (
        <div className="panel-section">
          <div className="panel-section__header">
            <span className="panel-section__title">◈ Transport</span>
            <span className="panel-section__toggle">▾</span>
          </div>
          <div className="panel-section__body">
            <div className="transport">
              <button
                className="transport__btn"
                onClick={onStop}
                title="Stop"
              >
                ◼
              </button>
              <button
                className={`transport__btn ${isPlaying ? "transport__btn--active" : ""}`}
                onClick={onPlayPause}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <span className="transport__time">{formatTime(currentTime)}</span>
              <span className="transport__time-label">
                / {duration > 0 ? formatTime(duration) : "--:--.--"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ANALYSIS PARAMS */}
      <div className="panel-section">
        <div className="panel-section__header">
          <span className="panel-section__title">◈ Analysis Config</span>
          <span className="panel-section__toggle">▾</span>
        </div>
        <div className="panel-section__body">
          <div className="param-group">
            <div className="param-row">
              <span className="param-row__label">FFT Size</span>
              <select className="param-select" defaultValue="8192">
                <option value="2048">2048</option>
                <option value="4096">4096</option>
                <option value="8192">8192</option>
                <option value="16384">16384</option>
              </select>
            </div>
            <div className="param-row">
              <span className="param-row__label">Hop Size</span>
              <span className="param-row__value">512</span>
            </div>
            <div className="param-row">
              <span className="param-row__label">Window</span>
              <select className="param-select" defaultValue="hann">
                <option value="hann">Hann</option>
                <option value="hamming">Hamming</option>
                <option value="blackman">Blackman</option>
              </select>
            </div>
            <div className="param-row">
              <span className="param-row__label">Pitch Algo</span>
              <select className="param-select" defaultValue="yin">
                <option value="yin">YIN</option>
                <option value="amdf">AMDF</option>
                <option value="macleod">McLeod</option>
              </select>
            </div>
            <div className="param-row">
              <span className="param-row__label">Key Algo</span>
              <select className="param-select" defaultValue="ks">
                <option value="ks">Krumhansl-S</option>
                <option value="temperley">Temperley</option>
              </select>
            </div>
            <div className="param-row">
              <span className="param-row__label">Min Freq</span>
              <span className="param-row__value">65 Hz</span>
            </div>
            <div className="param-row">
              <span className="param-row__label">Max Freq</span>
              <span className="param-row__value">2093 Hz</span>
            </div>
          </div>
        </div>
      </div>

      {/* ANALYZE BUTTON */}
      <div style={{ padding: "var(--spacing-md)", marginTop: "auto" }}>
        {analysisState === "processing" ? (
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "8px",
                color: "var(--text-tertiary)",
                marginBottom: "4px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Processing...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <button
            className="btn-analyze"
            disabled={!audioFile || analysisState === "processing"}
            onClick={onAnalyze}
          >
            {analysisState === "complete" ? "↻ Re-Analyze" : "▶ Analyze"}
          </button>
        )}
      </div>
    </div>
  );
}
