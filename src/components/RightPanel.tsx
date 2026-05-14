"use client";

import { useState } from "react";
import { AnalysisState, AnalysisResult } from "@/types";
import { useLang } from "@/context/LanguageContext";
import { T } from "@/lib/i18n";

interface RightPanelProps {
  analysisState: AnalysisState;
  analysisResult: AnalysisResult | null;
}

const MOOD_EMOJIS: Record<string, string> = {
  Happy: "😄", Energetic: "⚡", Catchy: "🎵", Calm: "🍃", Romantic: "🌸",
  Bittersweet: "🌤", Nostalgic: "🕰", Solemn: "🕯", Melancholy: "🌧",
  Sad: "😢", Tense: "⚠", Dramatic: "🎭", Epic: "🔥",
};

export default function RightPanel({ analysisState, analysisResult }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<"mood" | "notes" | "detail">("mood");
  const { lang } = useLang();
  const t = T[lang];

  if (analysisState !== "complete" || !analysisResult) {
    return (
      <div className="panel-right">
        <div className="tabs">
          <div className="tab tab--active">{t.tabMood}</div>
          <div className="tab">{t.tabNotes}</div>
          <div className="tab">{t.tabDetail}</div>
        </div>
        <div className="empty-state" style={{ padding: "24px" }}>
          <div className="empty-state__icon" style={{ fontSize: "20px" }}>◇</div>
          <div className="empty-state__text" style={{ fontSize: "9px" }}>{t.awaiting}</div>
        </div>
      </div>
    );
  }

  const r = analysisResult;
  const mood = r.mood as any; // valence/arousal typed as any for flexibility

  // Use the LLM-generated explanation from audioEngine (Groq Llama-3)
  // Falls back to the template-based explanation if LLM call failed
  const narration = r.explanation || "-";

  return (
    <div className="panel-right">
      {/* Tabs */}
      <div className="tabs">
        {(["mood","notes","detail"] as const).map(tab => (
          <div key={tab} className={`tab ${activeTab === tab ? "tab--active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab === "mood" ? t.tabMood : tab === "notes" ? t.tabNotes : t.tabDetail}
          </div>
        ))}
      </div>

      {/* ── TAB: Mood ── */}
      {activeTab === "mood" && (
        <div style={{ overflow: "auto", flex: 1 }}>

          {/* Primary Mood Badge */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.primaryMood}</span>
            </div>
            <div className="panel-section__body">
              <div className="mood-badge mood-badge--primary">
                <span>{MOOD_EMOJIS[r.mood.primary] ?? "♪"}</span>
                <span>{r.mood.primary}</span>
              </div>
              <div className="mood-confidence">
                Confidence: {r.mood.confidence}%
                {mood.valence !== undefined && (
                  <> &nbsp;|&nbsp; V:{mood.valence} A:{mood.arousal}</>
                )}
              </div>
            </div>
          </div>

          {/* Narration */}
          <div className="panel-section">
            <div className="panel-section__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="panel-section__title">◈ {t.narration}</span>
              <span style={{
                fontSize: "6px",
                fontFamily: "var(--font-mono)",
                color: "var(--accent-primary)",
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: "4px",
                padding: "1px 4px",
                letterSpacing: "0.05em",
              }}>✦ AI · Groq Llama-3</span>
            </div>
            <div className="panel-section__body">
              <div className="explanation-box" style={{
                lineHeight: "1.75",
                fontSize: "8.5px",
                color: "var(--text-secondary)",
                background: "var(--bg-input)",
                padding: "10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                fontStyle: narration === "-" ? "italic" : "normal",
              }}>
                {narration}
              </div>
            </div>
          </div>

          {/* Lyric Mood */}
          {r.lyricMood && (
            <div className="panel-section">
              <div className="panel-section__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="panel-section__title">◈ Klasifikasi Mood (Lirik)</span>
                <span style={{
                  fontSize: "6px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--accent-primary)",
                  background: "rgba(139,92,246,0.12)",
                  border: "1px solid rgba(139,92,246,0.3)",
                  borderRadius: "4px",
                  padding: "1px 4px",
                  letterSpacing: "0.05em",
                }}>✦ Semantic AI</span>
              </div>
              <div className="panel-section__body">
                <div className="mood-badge mood-badge--primary" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#c4b5fd", border: "1px solid rgba(139, 92, 246, 0.3)" }}>
                  <span>{r.lyricMood === "Happy" ? "😊" : r.lyricMood === "Sad" ? "😢" : r.lyricMood === "Romantic" ? "💖" : r.lyricMood === "Angry" ? "😡" : "🤔"}</span>
                  <span>{r.lyricMood}</span>
                </div>
              </div>
            </div>
          )}

          {/* Mood Distribution */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.moodDist}</span>
            </div>
            <div className="panel-section__body">
              <div className="mood-distribution">
                {r.mood.distribution.slice(0, 8).map((m) => (
                  <div key={m.mood} className="mood-bar">
                    <span className="mood-bar__label">{m.mood}</span>
                    <div className="mood-bar__track">
                      <div className="mood-bar__fill" style={{ width: `${m.value}%`, background: m.color }} />
                    </div>
                    <span className="mood-bar__value">{m.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Musical Metrics */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.musicalMetrics}</span>
            </div>
            <div className="panel-section__body">
              <div className="analysis-grid">
                {[
                  { label: t.key,        value: r.key.root,               accent: true },
                  { label: t.mode,       value: r.key.mode,               accent: false },
                  { label: t.tempo,      value: `${r.bpm} BPM`,           accent: false },
                  { label: t.timeSig,    value: r.timeSignature,           accent: false },
                  { label: t.totalNotes, value: r.totalNotes.toLocaleString(), accent: false },
                  { label: t.keyConf,    value: `${r.key.confidence}%`,   accent: false },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="analysis-cell">
                    <span className="analysis-cell__label">{label}</span>
                    <span className={`analysis-cell__value ${accent ? "analysis-cell__value--accent" : "analysis-cell__value--small"}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Chromagram */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.chromagram}</span>
            </div>
            <div className="panel-section__body">
              <div className="chromagram">
                {r.chromagram.map((c) => (
                  <div key={c.note} className="chromagram__cell"
                    style={{ background: `rgba(99,102,241,${c.value * 0.85})`, color: c.value > 0.5 ? "var(--text-primary)" : "var(--text-dim)" }}
                    title={`${c.note}: ${(c.value * 100).toFixed(0)}%`}>
                    {c.note}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Notes ── */}
      {activeTab === "notes" && (
        <div style={{ overflow: "auto", flex: 1 }}>
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.solfeggioDistrib}</span>
            </div>
            <div className="panel-section__body">
              <table className="note-table">
                <thead>
                  <tr>
                    <th>{t.solfege}</th><th>{t.abs}</th>
                    <th>{t.count}</th><th>%</th><th>Dist</th>
                  </tr>
                </thead>
                <tbody>
                  {r.dominantNotes.map((n) => (
                    <tr key={n.solfege}>
                      <td className="note-name">{n.solfege}</td>
                      <td className="note-freq">{n.absolute}</td>
                      <td style={{ color: "var(--text-secondary)" }}>{n.count}</td>
                      <td className="note-pct">{n.percentage}%</td>
                      <td>
                        <div className="note-minibar">
                          <div className="note-minibar__fill" style={{ width: `${(n.percentage / 25) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tension Peaks */}
          {r.tensionPeaks && r.tensionPeaks.length > 0 && (
            <div className="panel-section">
              <div className="panel-section__header">
                <span className="panel-section__title">◈ {lang === "id" ? "Puncak Tensi" : "Tension Peaks"}</span>
              </div>
              <div className="panel-section__body">
                <div className="file-info">
                  {r.tensionPeaks.map((sec, i) => {
                    const m = Math.floor(sec / 60);
                    const s = String(Math.floor(sec % 60)).padStart(2, "0");
                    return (
                      <div key={i} className="file-info__row">
                        <span className="file-info__label">Peak {i + 1}</span>
                        <span className="file-info__value" style={{ color: "var(--accent-danger)" }}>
                          {m > 0 ? `${m}:${s}` : `${sec}s`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Interval Pattern */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.intervalPattern}</span>
            </div>
            <div className="panel-section__body">
              <div className="interval-pattern">
                {r.intervals.map((v, i) => (
                  <div key={i} className="interval-bar"
                    style={{ height: `${(v / 8) * 100}%`, background: v > 5 ? "var(--accent-danger)" : v > 3 ? "var(--accent-warning)" : "var(--accent-primary)" }}
                    title={`Interval: ${v} semitones`} />
                ))}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"var(--font-mono)", fontSize:"7px", color:"var(--text-dim)", marginTop:"4px" }}>
                <span>{t.stepwise}</span><span>{t.skip}</span><span>{t.leap}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Detail ── */}
      {activeTab === "detail" && (
        <div style={{ overflow: "auto", flex: 1 }}>
          {/* Pipeline */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.processingPipeline}</span>
            </div>
            <div className="panel-section__body">
              <div style={{ fontFamily:"var(--font-mono)", fontSize:"8px", lineHeight:"1.8" }}>
                {[
                  t.step_decode, t.step_fft, t.step_spec, t.step_chroma,
                  t.step_key,   t.step_bpm, t.step_solfeg, t.step_mood,
                ].map((step) => (
                  <div key={step} style={{ display:"flex", justifyContent:"space-between", borderBottom:"1px solid var(--border-default)", padding:"1px 0" }}>
                    <span style={{ color:"var(--accent-success)" }}>✓</span>
                    <span style={{ color:"var(--text-secondary)", flex:1, marginLeft:6 }}>{step}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", fontWeight:600 }}>
                  <span /><span>{t.total}</span>
                  <span style={{ color:"var(--accent-primary)" }}>{r.processingTime}ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* Phase 4 Scoring */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.phase4Scoring}</span>
            </div>
            <div className="panel-section__body">
              <div className="file-info">
                {[
                  { label: t.key,      value: `${r.key.root} ${r.key.mode} (${r.key.confidence}%)` },
                  { label: "BPM",      value: String(r.bpm) },
                  { label: t.valence,  value: String(mood.valence ?? "—"), color: mood.valence > 0 ? "var(--accent-success)" : "var(--accent-danger)" },
                  { label: t.arousal,  value: String(mood.arousal ?? "—"), color: mood.arousal > 0 ? "var(--accent-warning)" : "var(--accent-info)" },
                  { label: t.processed,value: `${r.processingTime}ms`, color: "var(--accent-primary)" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="file-info__row">
                    <span className="file-info__label">{label}</span>
                    <span className="file-info__value" style={color ? { color } : {}}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Valence-Arousal Circumplex */}
          <div className="panel-section">
            <div className="panel-section__header">
              <span className="panel-section__title">◈ {t.valenceArousalMap}</span>
            </div>
            <div className="panel-section__body">
              <div style={{ position:"relative", width:"100%", aspectRatio:"1", background:"var(--bg-input)", border:"1px solid var(--border-default)", borderRadius:"var(--radius-sm)", overflow:"hidden" }}>
                {/* Axis lines */}
                <div style={{ position:"absolute", left:"50%", top:0, width:"1px", height:"100%", background:"var(--border-default)" }} />
                <div style={{ position:"absolute", top:"50%", left:0, width:"100%", height:"1px", background:"var(--border-default)" }} />
                {/* Quadrant labels */}
                {[
                  { label: lang==="id" ? "Tegang" : "Tense",     top:"8%",    left:"8%" },
                  { label: lang==="id" ? "Energik" : "Energetic", top:"8%",    right:"8%" },
                  { label: lang==="id" ? "Sedih" : "Sad",         bottom:"8%", left:"8%" },
                  { label: lang==="id" ? "Tenang" : "Calm",       bottom:"8%", right:"8%" },
                ].map((q) => (
                  <span key={q.label} style={{ position:"absolute", fontFamily:"var(--font-mono)", fontSize:"7px", color:"var(--text-dim)", ...(q.top?{top:q.top}:{}), ...(q.bottom?{bottom:q.bottom}:{}), ...(q.left?{left:q.left}:{}), ...("right" in q?{right:q.right}:{}) }}>
                    {q.label}
                  </span>
                ))}
                {/* Axis labels */}
                <span style={{ position:"absolute", top:"2%", left:"50%", transform:"translateX(-50%)", fontFamily:"var(--font-mono)", fontSize:"6px", color:"var(--text-dim)" }}>
                  {lang==="id" ? "AROUSAL TINGGI" : "HIGH AROUSAL"}
                </span>
                <span style={{ position:"absolute", bottom:"2%", left:"50%", transform:"translateX(-50%)", fontFamily:"var(--font-mono)", fontSize:"6px", color:"var(--text-dim)" }}>
                  {lang==="id" ? "AROUSAL RENDAH" : "LOW AROUSAL"}
                </span>
                {/* Real data dot */}
                {(() => {
                  const v = mood.valence ?? 0;
                  const a = mood.arousal ?? 0;
                  const left = `${((v + 1) / 2) * 100}%`;
                  const top  = `${((1 - a) / 2) * 100}%`;
                  return (
                    <>
                      <div style={{ position:"absolute", left, top, width:10, height:10, background:"var(--accent-primary)", borderRadius:"50%", transform:"translate(-50%,-50%)", border:"1px solid #fff", boxShadow:"0 0 4px var(--accent-primary)" }} />
                      <span style={{ position:"absolute", left, top, fontFamily:"var(--font-mono)", fontSize:"7px", color:"var(--accent-secondary)", fontWeight:600, marginLeft:8, transform:"translateY(-50%)", whiteSpace:"nowrap" }}>
                        {r.mood.primary}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
