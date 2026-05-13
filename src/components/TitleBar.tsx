"use client";

import { AnalysisState } from "@/types";
import { useLang } from "@/context/LanguageContext";

interface TitleBarProps { state: AnalysisState; }

export default function TitleBar({ state }: TitleBarProps) {
  const { lang, toggle } = useLang();

  const stateLabels: Record<AnalysisState, Record<"id"|"en", string>> = {
    idle:       { id: "IDLE",             en: "IDLE" },
    loaded:     { id: "FILE DIMUAT",      en: "FILE LOADED" },
    processing: { id: "MENGANALISIS...",  en: "ANALYZING..." },
    complete:   { id: "ANALISIS SELESAI", en: "ANALYSIS COMPLETE" },
  };

  return (
    <div className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__brand-icon">♪</span>
        <span>Solfeggio Analyzer</span>
        <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>v1.2.0</span>
      </div>
      <div className="titlebar__controls">
        <div className="titlebar__status">
          <span
            className={`titlebar__status-dot ${
              state === "idle" ? "titlebar__status-dot--idle"
              : state === "processing" ? "titlebar__status-dot--processing"
              : ""
            }`}
          />
          <span>{stateLabels[state][lang]}</span>
        </div>
        <span>Web Audio API</span>
        <span>FFT:8192</span>
        <span>HPS+KS</span>
        {/* Language toggle */}
        <button
          onClick={toggle}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            padding: "2px 8px",
            background: "var(--bg-input)",
            border: "1px solid var(--border-focus)",
            color: "var(--accent-primary)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
          title="Toggle Language / Ganti Bahasa"
        >
          {lang === "id" ? "🇮🇩 ID" : "🇬🇧 EN"}
        </button>
      </div>
    </div>
  );
}
