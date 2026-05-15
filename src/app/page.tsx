"use client";

import { useState, useCallback, useEffect } from "react";
import TitleBar from "@/components/TitleBar";
import StatusBar from "@/components/StatusBar";
import LeftPanel from "@/components/LeftPanel";
import CenterPanel from "@/components/CenterPanel";
import RightPanel from "@/components/RightPanel";
import { AnalysisState, AudioFileInfo, AnalysisResult, AnalysisConfig } from "@/types";
import { analyzeAudio } from "@/lib/audioEngine";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

import { useLang } from "@/context/LanguageContext";

const DEFAULT_CONFIG: AnalysisConfig = {
  fftSize: 8192,
  windowType: "hann",
  pitchAlgo: "yin",
  keyAlgo: "ks",
  minFreq: 65,
  maxFreq: 8000,
  autoFreq: true,
};

export default function HomePage() {
  const { lang } = useLang();
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [audioFile,     setAudioFile]     = useState<AudioFileInfo | null>(null);
  const [analysisResult,setAnalysisResult]= useState<AnalysisResult | null>(null);
  const [progress,      setProgress]      = useState(0);
  const [config,        setConfig]        = useState<AnalysisConfig>(DEFAULT_CONFIG);

  // Real audio player
  const player = useAudioPlayer(audioFile?.file ?? null);

  const handleFileUpload = useCallback((file: File) => {
    const info: AudioFileInfo = {
      name: file.name, size: file.size, type: file.type,
      duration: 0, sampleRate: 0, channels: 0, file,
    };
    setAudioFile(info);
    setAnalysisState("loaded");
    setAnalysisResult(null);
    setProgress(0);

    // Decode metadata only (player will handle actual playback)
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        // Use a dummy offline context for decoding to avoid hardware issues
        const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 1, 44100);
        const buffer = await offlineCtx.decodeAudioData(e.target?.result as ArrayBuffer);
        setAudioFile(prev => prev
          ? { ...prev, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }
          : null
        );
        audioCtx.close();
      } catch { /* ignore metadata decode error */ }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!audioFile) return;
    setAnalysisState("processing");
    setProgress(0);
    try {
      const result = await analyzeAudio(audioFile.file, config, setProgress, lang);
      setAnalysisResult(result);
      setAnalysisState("complete");
    } catch (err) {
      console.error("Analysis failed:", err);
      setAnalysisState("loaded");
    }
  }, [audioFile, config]);

  // ── Spacebar play/pause shortcut ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not focused on an input/select/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault(); // prevent page scroll
        if (audioFile) player.togglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [audioFile, player]);

  return (
    <div className="app-shell">
      <TitleBar state={analysisState} />
      <div className="main-content">
        <LeftPanel
          audioFile={audioFile}
          analysisState={analysisState}
          progress={progress}
          config={config}
          onConfigChange={setConfig}
          onFileUpload={handleFileUpload}
          onAnalyze={handleAnalyze}
        />
        <CenterPanel
          analysisState={analysisState}
          analysisResult={analysisResult}
          currentTime={player.currentTime}
          duration={player.duration || audioFile?.duration || 0}
          isPlaying={player.isPlaying}
          onSeek={player.seekTo}
          onPlayPause={player.togglePlay}
          onStop={player.stop}
        />
        <RightPanel
          analysisState={analysisState}
          analysisResult={analysisResult}
        />
      </div>
      <StatusBar
        audioFile={audioFile}
        analysisState={analysisState}
        analysisResult={analysisResult}
      />
    </div>
  );
}
