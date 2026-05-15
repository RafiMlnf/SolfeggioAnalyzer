import { NextResponse } from 'next/server';

// Bypass local certificate expiration issues during fetch
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, mode, bpm, mood, topSolfegge, lyrics, songTitle, lang = "id" } = body;
    const isEn = lang === "en";

    if (!GROQ_API_KEY) {
      const fallback = isEn 
        ? `This song is in the key of ${key} ${mode} with a tempo of ${bpm} BPM. The primary mood is ${mood}. The dominant notes are ${topSolfegge}.`
        : `Lagu ini berada di nada dasar ${key} ${mode} dengan tempo ${bpm} BPM. Nuansa utamanya adalah ${mood}. Nada dominan yang sering muncul adalah ${topSolfegge}.`;
      return NextResponse.json({
        error: 'GROQ_API_KEY is missing in .env.local',
        fallback
      });
    }

    // Limit lyrics length to prevent exceeding token limits
    const truncatedLyrics = lyrics && lyrics.length > 1000
      ? lyrics.substring(0, 1000) + '...'
      : (lyrics || (isEn ? 'No lyrics found for this song.' : 'Tidak ada lirik yang ditemukan untuk lagu ini.'));

    // Attempt to fetch exact genre from iTunes API
    let itunesGenre = "";
    if (songTitle) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(songTitle)}&entity=song&limit=1`, {
          signal: AbortSignal.timeout(3000)
        });
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          if (itunesData.results && itunesData.results.length > 0) {
            itunesGenre = itunesData.results[0].primaryGenreName;
            console.log(`[iTunes API] Found genre for "${songTitle}": ${itunesGenre}`);
          }
        }
      } catch (err) {
        console.warn("[iTunes API] Fetch failed or timeout:", err);
      }
    }

    const prompt = `Data Musik:
- Judul Lagu: ${songTitle || (isEn ? "Unknown" : "Tidak diketahui")}
${itunesGenre ? `- Genre Resmi (iTunes): ${itunesGenre}\n` : ''}- Nada Dasar: ${key} ${mode}
- Tempo: ${bpm} BPM
- Mood Audio: ${mood}
- Nada Dominan: ${topSolfegge}

Lirik Lagu:
"${truncatedLyrics}"

Tugas:
1. Identifikasi genre asli dari lagu "${songTitle || (isEn ? "this song" : "ini")}" berdasarkan pengetahuan umum Anda tentang musik (seperti yang tertera di Spotify/Apple Music). JANGAN menebak genre murni dari data audio jika Anda mengenali lagunya. Jika lagu tidak dikenali, barulah tebak genre dari data audio dan lirik.${itunesGenre ? `\nCATATAN PENTING: Gunakan "${itunesGenre}" sebagai salah satu output genre utama Anda karena itu adalah data resmi dari iTunes/Apple Music.` : ''}
2. Analisis makna lagu ini berdasarkan lirik dan audio teknisnya. Gunakan kepintaranmu untuk memahami metafora atau makna tersirat.

Keluarkan jawaban HANYA dalam format JSON yang valid, dengan struktur persis seperti ini:
{
  "narrative": "Narasi analisis mendalam (3-4 kalimat) dalam ${isEn ? 'Bahasa Inggris' : 'Bahasa Indonesia'}. Hubungkan antara makna lirik dengan aspek teknis audio (tempo, nada dasar).",
  "lyricMood": "Pilih SATU klasifikasi yang paling tepat dari 5 opsi ini: Happy, Sad, Romantic, Angry, Reflective",
  "genres": ["Genre Resmi 1", "Genre Resmi 2"] // Isi dengan genre resmi (seperti di Spotify). Jika tidak tahu, tebak berdasarkan fitur audio.
}`;

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: isEn 
              ? 'You are a music critic and literary analyst. You ONLY reply with valid JSON, without extra markdown. Generate the "narrative" in English.'
              : 'Anda adalah kritikus musik dan analis sastra Indonesia. Anda HANYA membalas dengan JSON yang valid, tanpa markdown tambahan. Hasilkan "narrative" dalam Bahasa Indonesia.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 500,
        response_format: { type: "json_object" }
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq API Error Status:', groqRes.status);
      console.error('Groq API Error Body:', err);
      throw new Error(`Groq API error: ${groqRes.status}`);
    }

    const data = await groqRes.json();
    console.log('Groq Response Data:', JSON.stringify(data).substring(0, 200));

    const contentString = data.choices?.[0]?.message?.content?.trim() || '{}';
    let parsedContent;
    try {
      parsedContent = JSON.parse(contentString);
    } catch (e) {
      console.error("Failed to parse Groq JSON:", e);
      parsedContent = {
        narrative: contentString,
        lyricMood: "Reflective",
        genres: []
      };
    }

    return NextResponse.json({
      narrative: parsedContent.narrative || "Gagal menghasilkan narasi.",
      lyricMood: parsedContent.lyricMood || "Reflective",
      genres: Array.isArray(parsedContent.genres) ? parsedContent.genres : []
    });
  } catch (error) {
    console.error('Narrative generation error:', error);
    // Return a fallback explanation if API fails
    const fallback = `Lagu ini memiliki nuansa yang unik berdasarkan komposisinya.`;
    return NextResponse.json({ error: String(error), fallback, lyricMood: "Reflective", genres: [] });
  }
}
