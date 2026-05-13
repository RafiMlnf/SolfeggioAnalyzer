/**
 * narration.ts — AI-like natural language analysis narration
 * Seed-consistent: same song = same narration every time.
 */

import { AnalysisResult } from "@/types";
import { Lang } from "./i18n";

function pick<T>(arr: T[], seed: number, offset = 0): T {
  return arr[Math.abs(Math.floor(seed + offset)) % arr.length];
}

function secToStr(sec: number, lang: Lang): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return lang === "id" ? `detik ke-${sec}` : `${sec}s`;
}

// ── Vocabulary ─────────────────────────────────────────────────
type MoodV = { adj: string; emot: string; quality: string };

const MV_ID: Record<string, MoodV> = {
  Happy:       { adj: "ceria dan asik",                emot: "vibe hepi",               quality: "bikin mood naik" },
  Energetic:   { adj: "enerjik dan nge-beat",          emot: "semangat membara",        quality: "bikin pengen gerak" },
  Catchy:      { adj: "catchy banget",                 emot: "vibe asik",               quality: "langsung nempel di kepala" },
  Calm:        { adj: "chill dan santai",              emot: "ketenangan",              quality: "bikin rileks" },
  Romantic:    { adj: "romantis dan hangat",           emot: "rasa hangat",             quality: "nyentuh di hati" },
  Bittersweet: { adj: "bittersweet",                   emot: "rasa campur aduk",        quality: "bikin senyum tipis tapi kangen" },
  Nostalgic:   { adj: "nostalgik",                     emot: "vibe kangen",             quality: "bawa kita flashback" },
  Solemn:      { adj: "syahdu dan khidmat",            emot: "suasana deep",            quality: "bikin merenung" },
  Melancholy:  { adj: "melankolis",                    emot: "rasa galau",              quality: "nyentuh banget" },
  Sad:         { adj: "sedih dan deep",                emot: "rasa sendu",              quality: "bikin baper" },
  Tense:       { adj: "intens dan tegang",             emot: "ketegangan",              quality: "bikin deg-degan" },
  Dramatic:    { adj: "dramatis",                      emot: "vibe dramatis",           quality: "kerasa epik dari awal sampai akhir" },
  Epic:        { adj: "megah dan epik",                emot: "suasana megah",           quality: "bikin merinding" },
};

const MV_EN: Record<string, MoodV> = {
  Happy:       { adj: "joyful and uplifting",           emot: "happiness",               quality: "bright and full of hope" },
  Energetic:   { adj: "high-energy and dynamic",        emot: "burning passion",          quality: "adrenaline-pumping" },
  Catchy:      { adj: "catchy and infectious",          emot: "groove",                  quality: "instantly earworm-worthy" },
  Calm:        { adj: "calm and peaceful",               emot: "tranquility",             quality: "soothing to the mind" },
  Romantic:    { adj: "romantic and warm",               emot: "heartfelt warmth",         quality: "deeply touching" },
  Bittersweet: { adj: "bittersweet and touching",       emot: "sweet longing",            quality: "somewhere between a smile and a tear" },
  Nostalgic:   { adj: "nostalgic and reminiscent",      emot: "deep longing",             quality: "pulling you back in time" },
  Solemn:      { adj: "solemn and dignified",            emot: "grandeur",                quality: "touching the deepest parts" },
  Melancholy:  { adj: "melancholic and introspective",  emot: "contemplative sadness",    quality: "slowly draining the emotions" },
  Sad:         { adj: "sorrowful and poignant",          emot: "pure sadness",            quality: "washing over the soul" },
  Tense:       { adj: "tense and intense",               emot: "tension",                 quality: "making you hold your breath" },
  Dramatic:    { adj: "dramatic and conflict-driven",   emot: "drama",                   quality: "gripping from start to finish" },
  Epic:        { adj: "epic and soul-stirring",          emot: "epic grandeur",            quality: "awakening something immense" },
};

const MODE_ID: Record<string, string[][]> = {
  Major: [["cerah","bikin aura lagu jadi positif"], ["terang","ngasih warna yang ceria"]],
  Minor: [["gelap","bikin lagunya makin deep"], ["sendu","nambahin sisi emosional yang lumayan kompleks"]],
};
const MODE_EN: Record<string, string[][]> = {
  Major: [["bright and open","giving an optimistic impression"], ["luminous","bringing a positive color palette"]],
  Minor: [["dark and contemplative","creating a space for deep reflection"], ["somber","reinforcing complex emotional shades"]],
};

const TEMPO_ID = (b: number) => b>140?"cepet banget dan ngegas":b>120?"cepet dan asik":b>100?"lumayan cepet dan bertenaga":b>80?"sedang dan pas buat ngangguk":b>65?"lambat dan santai":"super lambat dan bikin merenung";
const TEMPO_EN = (b: number) => b>140?"very fast and intense":b>120?"fast and enthusiastic":b>100?"moderately fast and energetic":b>80?"moderate and comfortable":b>65?"slow and reflective":"very slow and contemplative";

const ACT_ID: Record<string, string[]> = {
  Happy:["olahraga pagi","nongkrong bareng temen","kerja sambil ngopi"],
  Energetic:["nge-gym","lari pagi","main game kompetitif"],
  Catchy:["road trip","kerja santai","karaoke di mobil"],
  Calm:["baca buku","nyantai sore","fokus nugas"],
  Romantic:["dinner bareng pasangan","jalan bareng","me-time nyantai"],
  Bittersweet:["lagi di perjalanan sore","scroll foto lama","nginget masa lalu"],
  Nostalgic:["hujan sore-sore","jalan-jalan ke tempat lama","ngelamun pas senja"],
  Solemn:["lagi deep talk","me-time malem hari","kontemplasi"],
  Melancholy:["galau tengah malem","duduk sendirian pas hujan","nulis jurnal"],
  Sad:["lagi butuh nangis","healing dari patah hati","bengong dengerin hujan"],
  Tense:["ngedit video mepet deadline","nge-game hardcore","olahraga intens"],
  Dramatic:["nonton film epik","brainstorming ide","mikirin plot cerita"],
  Epic:["nonton bareng","workout berat","lagi on fire"],
};
const ACT_EN: Record<string, string[]> = {
  Happy:["a morning workout","hanging out with friends","a productive work session"],
  Energetic:["an intense gym session","a morning sprint","an action-packed game session"],
  Catchy:["a road trip","working while humming along","a casual hangout"],
  Calm:["reading a book","an evening meditation","a focused work session"],
  Romantic:["a romantic dinner","a first date","a quiet moment for two"],
  Bittersweet:["a farewell moment","a reunion with old friends","a twilight drive"],
  Nostalgic:["looking through old photos","revisiting childhood places","a rainy afternoon"],
  Solemn:["a moment of deep reflection","honoring the departed","a spiritual ritual"],
  Melancholy:["late-night journaling","sitting alone in the rain","self-introspection"],
  Sad:["crying it out alone","healing from a heartbreak","when the world feels heavy"],
  Tense:["editing a climactic video","a hardcore game session","a high-pressure workout"],
  Dramatic:["watching an epic film","writing a dramatic story","a creative brainstorm"],
  Epic:["a film marathon","a passionate training session","reaching a personal peak"],
};

const NOTE_SIG_ID: Record<string, string> = {
  "1 (Do)":"berarti lagunya sering nemu 'rumah' atau resolusi — rasanya lega dan tuntas",
  "2 (Re)":"bikin rasanya ada dorongan buat terus maju",
  "3 (Mi)":"ngasih karakter melodi yang kuat banget",
  "4 (Fa)":"bikin lagunya kerasa ngalir terus tanpa henti",
  "5 (Sol)":"jadi fondasi chord yang super stabil",
  "6 (La)":"bikin aura lagunya kerasa makin minor dan galau",
  "7 (Si)":"nandain banyak banget ketegangan yang nunggu buat di-resolve",
};
const NOTE_SIG_EN: Record<string, string> = {
  "1 (Do)":"indicating frequent resolution to the tonic — grounded and complete",
  "2 (Re)":"giving a sense of constant forward movement without resolution",
  "3 (Mi)":"lending a strong major character or expressive minor quality",
  "4 (Fa)":"indicating movement toward the subdominant — a forward-pushing feel",
  "5 (Sol)":"providing a strong, stable harmonic foundation",
  "6 (La)":"significantly reinforcing the minor and melancholic quality",
  "7 (Si)":"indicating frequent harmonic tension waiting for resolution",
};

const INT_ID = (avg: number) => avg<2?"langkah nada yang rapet dan ngalir":avg<4?"kombinasi nada rapet sama lompatan yang pas":"lompatan nada yang dramatis banget";
const INT_EN = (avg: number) => avg<2?"smooth, stepwise motion with gentle phrasing":avg<4?"a balanced mix of stepwise and skipping movement":"dramatic melodic leaps full of expression";

// ── Main Generator ─────────────────────────────────────────────
export function generateNarration(result: AnalysisResult, lang: Lang, duration: number): string {
  const { key, bpm, mood, dominantNotes, intervals, tensionPeaks } = result;
  const primary = mood.primary;
  const seed = bpm * 7 + key.root.charCodeAt(0) + (key.midiRoot ?? 0) * 3;

  const mv   = (lang === "id" ? MV_ID : MV_EN)[primary] ?? { adj:"unik", emot:"feel unik", quality:"khas" };
  const modeArr = (lang === "id" ? MODE_ID : MODE_EN)[key.mode] ?? [["",""]];
  const [modeAdj, modeImpact] = pick(modeArr, seed, 0) as string[];

  const tempoDesc  = lang === "id" ? TEMPO_ID(bpm) : TEMPO_EN(bpm);
  const actArr     = (lang === "id" ? ACT_ID : ACT_EN)[primary] ?? ["mendengarkan musik"];
  const activity   = pick(actArr, seed, 2);
  const topNote    = dominantNotes[0];
  const noteSig    = topNote ? ((lang==="id" ? NOTE_SIG_ID : NOTE_SIG_EN)[topNote.solfege] ?? "") : "";
  const avgInt     = intervals.length ? intervals.reduce((a,b)=>a+b,0)/intervals.length : 2;
  const intDesc    = lang==="id" ? INT_ID(avgInt) : INT_EN(avgInt);
  const peakSec    = tensionPeaks?.[0];

  const out: string[] = [];

  // S1: Vibe
  if (lang==="id") {
    out.push(pick([
      `Track ini ngasih feel yang ${mv.adj}, dibalut nuansa ${modeAdj} yang ${modeImpact}.`,
      `Dari dengerin awalnya aja, ${mv.emot} udah kerasa banget — warnanya ${mv.adj} dan pastinya ${mv.quality}.`,
      `Secara emosi, lagu ini mancarin vibe ${mv.adj}, makin dapet gara-gara kuncinya di ${key.root} ${key.mode} yang ${modeAdj}.`,
    ], seed, 10));
  } else {
    out.push(pick([
      `This track carries a feel that is ${mv.adj}, wrapping the listener in a ${modeAdj} atmosphere that ${modeImpact}.`,
      `From the very first note, ${mv.emot} flows powerfully — a sonic color that is ${mv.adj} and ${mv.quality}.`,
      `Emotionally, this composition radiates ${mv.adj} energy, reinforced by the ${key.root} ${key.mode} key that feels ${modeAdj}.`,
    ], seed, 10));
  }

  // S2: Tempo
  if (lang==="id") {
    out.push(pick([
      `Temponya jalan di ${bpm} BPM, kerasa ${tempoDesc} dan ngebangun pondasi asik buat vibe lagunya.`,
      `Beat-nya konstan di ${bpm} BPM — hitungannya ${tempoDesc} — bikin *flow* lagunya enak diikutin dari awal sampai habis.`,
    ], seed, 20));
  } else {
    out.push(pick([
      `At ${bpm} BPM, the tempo is ${tempoDesc}, forming a solid rhythmic foundation for the overall mood.`,
      `The rhythm moves at ${bpm} BPM — ${tempoDesc} — maintaining consistent energy throughout.`,
    ], seed, 20));
  }

  // S3: Dominant note
  if (topNote) {
    if (lang==="id") {
      out.push(pick([
        `Kalau dibedah, nada ${topNote.solfege} (${topNote.absolute}) paling sering muncul sampai ${topNote.percentage}%. Ini ${noteSig}.`,
        `Nada dominannya ada di ${topNote.solfege} (sekitar ${topNote.percentage}% dari total nada), yang ${noteSig}.`,
      ], seed, 30));
    } else {
      out.push(pick([
        `Solfeggio ${topNote.solfege} (${topNote.absolute}) dominates at ${topNote.percentage}%, ${noteSig}.`,
        `The degree ${topNote.solfege} appears ${topNote.percentage}% throughout the track, ${noteSig}.`,
      ], seed, 30));
    }
  }

  // S4: Tension peak
  if (peakSec != null) {
    const ts = secToStr(peakSec, lang);
    const leaps = avgInt > 3;
    if (lang==="id") {
      out.push(pick([
        `Coba perhatiin pas masuk menit ${ts}, tensi musiknya langsung naik dan melodinya jadi lebih ${leaps?"loncat-loncat dramatis":"padat dan intens"}.`,
        `Puncak gregetnya ada di sekitar ${ts}, waktu semua instrumen atau beat-nya bener-bener nyatu dan pecah.`,
        `Sekitar ${ts}, auranya agak beda — makin kerasa *hype* dan nadanya mulai ${leaps?"dramatis":"lebih rapet"}.`,
      ], seed, 40));
    } else {
      out.push(pick([
        `Notably around ${ts}, tension rises sharply and the melody moves more ${leaps?"dramatically with large leaps":"quickly and densely"}.`,
        `The most intense moment arrives around ${ts}, where harmonic energy reaches its peak.`,
        `Around ${ts}, the atmosphere shifts — intensity builds and the melody begins to ${leaps?"leap dramatically":"move more tightly"}.`,
      ], seed, 40));
    }
  }

  // S5: Interval movement
  if (lang==="id") {
    out.push(`Secara keseluruhan melodi lagunya dibentuk dari ${intDesc}, cocok banget buat nyampein feel yang ${mv.quality}.`);
  } else {
    out.push(`The melodic movement is dominated by ${intDesc}, lending a distinctive ${mv.quality} character.`);
  }

  // S6: Activity
  if (lang==="id") {
    out.push(pick([
      `Lagu ini enak banget lo puter pas lagi ${activity} — *perfect timing* buat nikmatin ${mv.emot}-nya.`,
      `Cocok banget masuk playlist buat ${activity}, biar suasana ${mv.adj}-nya makin dapet.`,
    ], seed, 50));
  } else {
    out.push(pick([
      `This track is best enjoyed during ${activity} — a moment where ${mv.emot} can be felt fully.`,
      `It works perfectly as a soundtrack for ${activity}, creating a ${mv.adj} atmosphere.`,
    ], seed, 50));
  }

  return out.join(" ");
}
