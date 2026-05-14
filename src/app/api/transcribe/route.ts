import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

// Next.js 15 Route Segment Config
export const maxDuration = 120; // 120s — Groq Whisper needs more time for full songs

/**
 * POST /api/transcribe
 *
 * Mode A — LRCLIB (default, fast):
 *   FormData: { songId: string }
 *   → Searches LRCLIB for synced lyrics. Result cached 30 days.
 *
 * Mode B — Groq Whisper (fallback, AI STT):
 *   FormData: { songId: string, audio: File (WAV, vocal-filtered) }
 *   → Sends audio to Groq whisper-large-v3. Result cached 7 days.
 */

function parseLrc(lrc: string) {
  const lines = lrc.split('\n');
  const chunks: { time: number; text: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\](.*)/);
    if (match) {
      const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
      const text = match[3].trim();
      if (text) chunks.push({ time, text });
    }
  }

  return chunks.map((c, i) => ({
    text: c.text,
    timestamp: [c.time, chunks[i + 1] ? chunks[i + 1].time : c.time + 5] as [number, number],
  }));
}

// ── Mode B: Groq Whisper (Internal) ───────────────────────────
async function transcribeWithGroqInternal(audioFile: File, songId: string, force: boolean) {
  const cacheKey = `lyrics:whisper:${songId}`;

  // Check cache first
  if (!force) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`[Whisper/Redis HIT] ${cacheKey}`);
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
      }
    } catch (e) {
      console.error('[Whisper] Redis read error:', e);
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY not configured');
    return null;
  }

  console.log(`[Whisper] Sending ${(audioFile.size / 1024).toFixed(0)}KB to Groq Whisper...`);

  // Build Groq multipart request
  const groqForm = new FormData();
  groqForm.append('file', audioFile, 'vocal.wav');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('timestamp_granularities[]', 'segment');
  // Note: Do NOT use 'prompt' for instructions in Whisper API.
  // Whisper uses 'prompt' as preceding context. If you put instructions there, 
  // it will hallucinate the instructions as the transcribed text.
  const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: groqForm,
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error('[Whisper] Groq API error:', err);
    return null;
  }

  const whisperData = await groqRes.json();

  // Convert Whisper segments → our chunks format
  const chunks = (whisperData.segments ?? [])
    .map((seg: any) => ({
      text: seg.text.trim(),
      timestamp: [seg.start, seg.end] as [number, number],
    }))
    .filter((c: any) => c.text.length > 0);

  const result = { chunks, text: whisperData.text ?? '' };
  console.log(`[Whisper] Done — ${chunks.length} segments transcribed.`);

  // Cache 7 days
  if (chunks.length > 0) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: 60 * 60 * 24 * 7 });
      console.log(`[Whisper/Redis SET] ${cacheKey}`);
    } catch (e) {
      console.error('[Whisper] Redis write error:', e);
    }
  }

  return result;
}

// ── Main handler ──────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const songId = (formData.get('songId') as string) ?? '';
    const audioFile = formData.get('audio') as File | null;
    const force = formData.get('force') === 'true';

    // ── Mode A: Direct LRCLIB Search (using Filename/SongId) ──
    if (!songId) {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    const cleanSongId = songId
      .replace(/official/gi, '')
      .replace(/video/gi, '')
      .replace(/audio/gi, '')
      .replace(/lyrics/gi, '')
      .replace(/[^a-zA-Z0-9\s\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cacheKey = `lyrics:lrc:${cleanSongId}`;

    if (!force) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          console.log(`[LRCLIB/Redis HIT] ${cacheKey}`);
          const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
          return NextResponse.json({ result: parsed, cached: true, source: 'lrclib' });
        }
      } catch (e) {
        console.error('[LRCLIB] Redis read error:', e);
      }
    }

    console.log(`[LRCLIB] Searching for "${cleanSongId}"...`);
    let lrclibRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanSongId)}`);
    
    let bestMatch = null;
    if (lrclibRes.ok) {
      const results = await lrclibRes.json();
      bestMatch = results.find((r: any) => r.syncedLyrics);
    }

    // ── Mode B: Whisper-guided LRCLIB Search ──
    // If filename search failed to find synced lyrics, and we have an audio file
    if (!bestMatch && audioFile && audioFile.size > 0) {
      console.log(`[Hybrid] LRCLIB direct failed. Transcribing audio to find song...`);
      const whisperResult = await transcribeWithGroqInternal(audioFile, songId, force);
      
      if (whisperResult && whisperResult.text) {
        // Use the first ~100 characters of the transcribed lyrics to search LRCLIB
        const transcribedQuery = whisperResult.text.substring(0, 100).trim();
        console.log(`[Hybrid] Searching LRCLIB with transcribed lyrics: "${transcribedQuery}"`);
        
        lrclibRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(transcribedQuery)}`);
        if (lrclibRes.ok) {
          const results = await lrclibRes.json();
          bestMatch = results.find((r: any) => r.syncedLyrics);
        }

        // If LRCLIB STILL fails, fallback to Whisper's own chaotic timestamps
        if (!bestMatch) {
          console.log(`[Hybrid] LRCLIB lyric search failed. Falling back to Whisper timestamps.`);
          return NextResponse.json({ result: whisperResult, cached: false, source: 'groq-whisper' });
        }
      }
    }

    // Process LRCLIB match
    let chunks: any[] = [];
    if (bestMatch?.syncedLyrics) {
      console.log(`[LRCLIB] Found match: ${bestMatch.artistName} - ${bestMatch.trackName}`);
      chunks = parseLrc(bestMatch.syncedLyrics);
    }

    const result = { chunks, text: bestMatch?.plainLyrics ?? '' };

    if (chunks.length > 0) {
      try {
        await redis.set(cacheKey, JSON.stringify(result), { ex: 60 * 60 * 24 * 30 });
        console.log(`[LRCLIB/Redis SET] ${cacheKey} (${chunks.length} lines)`);
      } catch (e) {
        console.error('[LRCLIB] Redis write error:', e);
      }
    } else {
      // Complete failure
      if (audioFile && audioFile.size > 0) {
         return NextResponse.json({ error: 'Failed to transcribe or find lyrics' }, { status: 404 });
      }
    }

    return NextResponse.json({ result, cached: false, source: 'lrclib' });
  } catch (error) {
    console.error('Transcribe error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
