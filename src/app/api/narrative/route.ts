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
- Mood: ${mood}
- Nada Paling Dominan: ${topSolfegge}

Lirik Lagu:
"${truncatedLyrics}"

Tugas:
Buatlah narasi analisis musik yang mendalam (3-4 kalimat) dalam Bahasa Indonesia.
1. Hubungkan aspek teknis (seperti tempo ${bpm} BPM atau nada dasar ${key}) dengan makna emosional dari lirik tersebut.
2. Jangan hanya menyebutkan angka, tapi jelaskan *bagaimana* musiknya mendukung pesan dalam lirik.
3. Gunakan gaya bahasa yang puitis, santai/informal namun tetap berwawasan musik. analisis dan libatkan lirik musik untuk results nya, apa makna lagu ini berdasarkan lirik.
4. JANGAN gunakan awalan seperti "Analisis lagu ini adalah..." atau "Tentu, ini analisanya". Langsung ke inti narasi. dan juga singkat`;

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Newer, more reliable model
        messages: [
          {
            role: 'system',
            content: 'Anda adalah kritikus musik Indonesia yang cerdas. Berikan analisis mendalam dalam Bahasa Indonesia yang indah. Hubungkan antara lirik dan musik.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 400,
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

    const narrative = data.choices?.[0]?.message?.content?.trim() || '';

    if (!narrative) {
      console.warn('Groq returned empty narrative content');
    }

    return NextResponse.json({ narrative });
  } catch (error) {
    console.error('Narrative generation error:', error);
    // Return a fallback explanation if API fails
    const fallback = `Lagu ini memiliki tempo ${body.bpm || 0} BPM dengan nuansa ${body.mood || 'netral'}.`;
    return NextResponse.json({ error: String(error), fallback });
  }
}
