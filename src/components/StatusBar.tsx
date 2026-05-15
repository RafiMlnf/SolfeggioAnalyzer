"use client";

import { AnalysisState, AudioFileInfo, AnalysisResult } from "@/types";
import { useLang } from "@/context/LanguageContext";
import { T } from "@/lib/i18n";

interface StatusBarProps {
  audioFile: AudioFileInfo | null;
  analysisState: AnalysisState;
  analysisResult: AnalysisResult | null;
}

export default function StatusBar({ audioFile, analysisState, analysisResult }: StatusBarProps) {
  const { lang } = useLang();
  const t = T[lang];

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "—";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="statusbar">
      <div className="statusbar__left">
        <span className="statusbar__item">
          ◈ {audioFile ? audioFile.name : t.noFile}
        </span>
        {audioFile && (
          <>
            <span className="statusbar__item">{formatSize(audioFile.size)}</span>
            {audioFile.sampleRate > 0 && (
              <span className="statusbar__item">{audioFile.sampleRate / 1000}kHz</span>
            )}
            {audioFile.channels > 0 && (
              <span className="statusbar__item">
                {audioFile.channels === 1 ? "Mono" : "Stereo"}
              </span>
            )}
          </>
        )}
      </div>
      <div className="statusbar__right">
        {analysisResult && (
          <>
            <span className="statusbar__item statusbar__item--accent">
              {t.key.toUpperCase()}: {analysisResult.key.root} {analysisResult.key.mode}
            </span>
            <span className="statusbar__item statusbar__item--accent">
              BPM: {analysisResult.bpm}
            </span>
          </>
        )}
        <span className="statusbar__item">
          {analysisState === "processing" ? `⟳ ${t.processingText}` : t.ready}
        </span>
        <span className="statusbar__item">{lang === "id" ? "Mesin" : "Engine"}: YIN + K-S</span>
      </div>
    </div>
  );
}
