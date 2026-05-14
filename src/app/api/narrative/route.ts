import { NextResponse } from 'next/server';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, mode, bpm, mood, topSolfegge, lyrics } = body;

    if (!GROQ_API_KEY) {
      return NextResponse.json({
        error: 'GROQ_API_KEY is missing in .env.local',
        fallback: `Lagu ini berada di nada dasar ${key} ${mode} dengan tempo ${bpm} BPM. Nuansa utamanya adalah ${mood}. Nada dominan yang sering muncul adalah ${topSolfegge}.`
      });
    }

    // Limit lyrics length to prevent exceeding token limits
    const truncatedLyrics = lyrics && lyrics.length > 1000
      ? lyrics.substring(0, 1000) + '...'
      : (lyrics || 'Tidak ada lirik yang ditemukan untuk lagu ini.');

    const prompt = `Data Musik:
- Nada Dasar: ${key} ${mode}
- Tempo: ${bpm} BPM
- Mood Audio: ${mood}
- Nada Dominan: ${topSolfegge}

Lirik Lagu:
"${truncatedLyrics}"

Tugas:
Analisis makna lagu ini berdasarkan liriknya. Gunakan kepintaranmu untuk memahami metafora, sindiran, atau makna tersirat (misal: lagu sedih yang dibalut nada ceria).

Keluarkan jawaban HANYA dalam format JSON yang valid, dengan struktur persis seperti ini:
{
  "narrative": "Narasi analisis mendalam (3-4 kalimat) dalam Bahasa Indonesia. Hubungkan antara makna lirik dengan aspek teknis audio (tempo, nada dasar). Gunakan gaya puitis, santai/informal namun berwawasan. Langsung ke inti.",
  "lyricMood": "Pilih SATU klasifikasi yang paling tepat dari 5 opsi ini: Happy, Sad, Romantic, Angry, Reflective"
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
            content: 'Anda adalah kritikus musik dan analis sastra Indonesia. Anda HANYA membalas dengan JSON yang valid, tanpa markdown tambahan.'
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
        lyricMood: "Reflective"
      };
    }

    return NextResponse.json({ 
      narrative: parsedContent.narrative || "Gagal menghasilkan narasi.",
      lyricMood: parsedContent.lyricMood || "Reflective"
    });
  } catch (error) {
    console.error('Narrative generation error:', error);
    // Return a fallback explanation if API fails
    const fallback = `Lagu ini memiliki nuansa yang unik berdasarkan komposisinya.`;
    return NextResponse.json({ error: String(error), fallback, lyricMood: "Reflective" });
  }
}
