"use client";

import { useRef, useCallback } from "react";
import { AnalysisState, AudioFileInfo, AnalysisConfig } from "@/types";

interface LeftPanelProps {
  audioFile: AudioFileInfo | null;
  analysisState: AnalysisState;
  progress: number;
  config: AnalysisConfig;
  onConfigChange: (config: AnalysisConfig) => void;
  onFileUpload: (file: File) => void;
  onAnalyze: () => void;
}

export default function LeftPanel({
  audioFile,
  analysisState,
  progress,
  config,
  onConfigChange,
  onFileUpload,
  onAnalyze,
}: LeftPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(2, "0")}`;
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
              <select
                className="param-select"
                value={config.fftSize}
                onChange={(e) => onConfigChange({ ...config, fftSize: Number(e.target.value) as any })}
              >
                <option value="2048">2048 (Fast)</option>
                <option value="4096">4096</option>
                <option value="8192">8192 (Balanced)</option>
                <option value="16384">16384 (Detailed)</option>
              </select>
            </div>
            <div className="param-row">
              <span className="param-row__label">Pitch Algo</span>
              <select
                className="param-select"
                value={config.pitchAlgo}
                onChange={(e) => onConfigChange({ ...config, pitchAlgo: e.target.value as any })}
              >
                <option value="yin">YIN</option>
                <option value="amdf">AMDF</option>
                <option value="macleod">McLeod</option>
              </select>
            </div>
            <div className="param-row" style={{ marginTop: 8 }}>
              <span className="param-row__label" style={{ color: "var(--accent-primary)" }}>Auto Freq Range</span>
              <input
                type="checkbox"
                checked={config.autoFreq}
                onChange={(e) => onConfigChange({ ...config, autoFreq: e.target.checked })}
                style={{ cursor: "pointer" }}
              />
            </div>
            {!config.autoFreq && (
              <>
                <div className="param-row">
                  <span className="param-row__label">Min Freq</span>
                  <select
                    className="param-select"
                    value={config.minFreq}
                    onChange={(e) => onConfigChange({ ...config, minFreq: Number(e.target.value) })}
                  >
                    <option value="20">20 Hz</option>
                    <option value="65">65 Hz</option>
                    <option value="100">100 Hz</option>
                  </select>
                </div>
                <div className="param-row">
                  <span className="param-row__label">Max Freq</span>
                  <select
                    className="param-select"
                    value={config.maxFreq}
                    onChange={(e) => onConfigChange({ ...config, maxFreq: Number(e.target.value) })}
                  >
                    <option value="4000">4 kHz</option>
                    <option value="8000">8 kHz</option>
                    <option value="12000">12 kHz</option>
                  </select>
                </div>
              </>
            )}
            {config.autoFreq && (
              <div style={{ fontSize: "8px", color: "var(--text-dim)", marginTop: "4px", lineHeight: 1.4 }}>
                AI will automatically detect the optimal frequency range to analyze based on the audio brightness.
              </div>
            )}
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
            disabled={!audioFile}
            onClick={onAnalyze}
          >
            {analysisState === "complete" ? "↻ Re-Analyze" : "▶ Analyze"}
          </button>
        )}
      </div>
    </div>
  );
}
