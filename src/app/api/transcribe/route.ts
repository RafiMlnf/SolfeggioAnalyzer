import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

// Allow large audio uploads — Groq limit is 25MB
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '25mb',
  },
};

// Next.js 15 Route Segment Config
export const maxDuration = 60; // 60s max — Groq is fast but allow for large files

/**
 * POST /api/transcribe
 * Temporarily kept the same endpoint name for compatibility, but now it 
 * fetches human-synced lyrics from LRCLIB API instead of using AI STT.
 * 
 * LRCLIB is completely free, open source, requires no API key, and gives 100% 
 * of the lyrics (unlike Musixmatch free tier which restricts to 30%).
 */

function parseLrc(lrc: string) {
  const lines = lrc.split('\n');
  const chunks: { time: number; text: string }[] = [];
  
  for (const line of lines) {
    // Match [mm:ss.xx] text
    const match = line.match(/^\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\](.*)/);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseFloat(match[2]);
      const time = min * 60 + sec;
      const text = match[3].trim();
      if (text) {
        chunks.push({ time, text });
      }
    }
  }

  // Convert to timestamp [start, end] format expected by frontend
  const finalChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const start = chunks[i].time;
    // Assume each line lasts until the next line starts, or 5 seconds for the last line
    const end = chunks[i + 1] ? chunks[i + 1].time : start + 5; 
    finalChunks.push({
      text: chunks[i].text,
      timestamp: [start, end] as [number, number],
    });
  }
  return finalChunks;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const songId = formData.get('songId') as string;

    if (!songId) {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    // Clean up filename to make it a good search query (e.g., "Shape of You - Ed Sheeran")
    // Remove "official video", "lyrics", etc. if present
    const searchQuery = songId
      .replace(/official/gi, '')
      .replace(/video/gi, '')
      .replace(/audio/gi, '')
      .replace(/lyrics/gi, '')
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cacheKey = `lyrics:lrc:${searchQuery}`;

    // 1. Check Upstash Redis cache
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`[Redis HIT] ${cacheKey}`);
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return NextResponse.json({ result: parsed, cached: true });
      }
    } catch (e) {
      console.error('Redis read error:', e);
    }

    console.log(`[Redis MISS] Searching LRCLIB for "${searchQuery}"...`);

    // 2. Fetch from LRCLIB API
    const lrclibRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`);
    
    if (!lrclibRes.ok) {
      return NextResponse.json({ error: 'Failed to search LRCLIB' }, { status: 502 });
    }

    const results = await lrclibRes.json();
    
    // Find the first result that has syncedLyrics
    const bestMatch = results.find((r: any) => r.syncedLyrics);

    let chunks: any[] = [];
    if (bestMatch && bestMatch.syncedLyrics) {
      chunks = parseLrc(bestMatch.syncedLyrics);
    }

    const result = { chunks, text: bestMatch?.plainLyrics || '' };

    // 3. Save to Upstash Redis (30-day expiry)
    if (chunks.length > 0) {
      try {
        await redis.set(cacheKey, JSON.stringify(result), { ex: 60 * 60 * 24 * 30 });
        console.log(`[Redis SET] ${cacheKey} (${chunks.length} synced lines cached)`);
      } catch (e) {
        console.error('Redis write error:', e);
      }
    }

    return NextResponse.json({ result, cached: false });
  } catch (error) {
    console.error('Lyrics fetch error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
