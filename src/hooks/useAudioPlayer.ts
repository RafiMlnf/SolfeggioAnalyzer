"use client";

import { useRef, useState, useEffect, useCallback } from "react";

export function useAudioPlayer(file: File | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef   = useRef<string | null>(null);

  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);

  // Create/replace audio element whenever file changes
  useEffect(() => {
    if (!file) return;

    // Cleanup previous
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    if (urlRef.current)    URL.revokeObjectURL(urlRef.current);

    const url = URL.createObjectURL(file);
    urlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate     = () => setCurrentTime(audio.currentTime);
    audio.onended          = () => { setIsPlaying(false); setCurrentTime(0); };

    setCurrentTime(0);
    setIsPlaying(false);

    return () => {
      audio.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [file]);

  const play   = useCallback(() => { audioRef.current?.play(); setIsPlaying(true);  }, []);
  const pause  = useCallback(() => { audioRef.current?.pause(); setIsPlaying(false); }, []);
  const stop   = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setIsPlaying(false); setCurrentTime(0);
  }, []);

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, time));
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) pause(); else play();
  }, [isPlaying, play, pause]);

  return { isPlaying, currentTime, duration, togglePlay, stop, seekTo };
}
