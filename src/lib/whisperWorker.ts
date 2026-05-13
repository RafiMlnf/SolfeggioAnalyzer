import { pipeline, env } from "@xenova/transformers";

// Disable local models since we're running in the browser and loading from HF Hub
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber: any = null;

self.onmessage = async (e) => {
  const { type, audioData } = e.data;

  if (type === "init") {
    if (!transcriber) {
      self.postMessage({ status: "loading" });
      try {
        transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
          progress_callback: (progress: any) => {
            self.postMessage({ status: "progress", progress });
          },
        });
        self.postMessage({ status: "ready" });
      } catch (err) {
        self.postMessage({ status: "error", error: String(err) });
      }
    } else {
      self.postMessage({ status: "ready" });
    }
  } else if (type === "transcribe") {
    if (!transcriber) {
      self.postMessage({ status: "error", error: "Transcriber not initialized" });
      return;
    }

    self.postMessage({ status: "transcribing" });

    try {
      // audioData must be a Float32Array at 16000Hz mono.
      const result = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });

      self.postMessage({ status: "complete", result });
    } catch (err) {
      self.postMessage({ status: "error", error: String(err) });
    }
  }
};
