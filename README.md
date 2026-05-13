# Solfeggio Analyzer

Aplikasi web berkinerja tinggi yang dirancang untuk analisis notasi musik secara real-time dan pengambilan lirik tersinkronisasi. Sistem ini memadukan pengolahan sinyal digital di sisi klien dengan kecerdasan buatan di sisi server.

*A high-performance web application designed for real-time musical notation analysis and synchronized lyrics retrieval. This system integrates client-side digital signal processing with server-side artificial intelligence.*

## Arsitektur Sistem | System Architecture

| Komponen (Component) | Teknologi (Technology) | Fungsi Utama (Primary Function) |
| :--- | :--- | :--- |
| **Inti Frontend (Core)** | Next.js, React, TypeScript | Kerangka utama aplikasi dan manajemen antarmuka. / *Application shell and UI management.* |
| **Audio Processing** | Web Audio API, Canvas API | Eksekusi FFT di sisi klien dan visualisasi 60FPS. / *Client-side FFT execution and 60FPS visualization.* |
| **Data Persistence** | Upstash Redis | Lapisan caching serverless untuk akses data instan. / *Serverless caching layer for instant data access.* |
| **Integrasi AI (LLM)** | Groq Llama-3.3-70b | Generasi narasi analisis musik secara dinamis. / *Dynamic musical analysis narrative generation.* |
| **Mesin Lirik (Lyrics)** | LRCLIB API | Pengambilan lirik LRC yang sinkron secara otomatis. / *Automated synchronized LRC lyrics retrieval.* |

---

## Rincian Fitur | Feature Details

### ▤ Spektrogram & Heatmap Real-Time
**ID:** Menggunakan HTML5 Canvas API untuk merender data frekuensi secara efisien. Mengonversi audio mentah ke spektrogram log-spaced dan heatmap Solfeggio untuk visualisasi pitch di tiga oktaf.  
**EN:** *Utilizes the HTML5 Canvas API to render frequency data efficiently. Converts raw audio into log-spaced spectrograms and Solfeggio heatmaps for pitch visualization across three octaves.*

---

### ⚙ Pemrosesan Sinyal Sisi Klien | Client-Side Signal Processing
**ID:** Menjalankan algoritma FFT langsung di thread peramban. Pendekatan ini menekan beban server dan bandwidth karena pemrosesan audio berat dilakukan di mesin lokal pengguna.  
**EN:** *Executes FFT algorithms directly within the browser thread. This approach minimizes server load and bandwidth requirements by processing heavy audio data locally on the user's machine.*

---

### 📊 Deteksi Heuristik Musikal | Musical Heuristics Detection
**ID:** Analisis otomatis parameter temporal dan frekuensi untuk menghitung metrik spesifik:
- **Tempo (BPM):** Deteksi ritme via akustik onset.
- **Kunci Nada:** Pencocokan algoritmik terhadap profil chroma mayor/minor.
- **Solfeggio Dominan:** Statistik kepadatan nada untuk identifikasi derajat skala.
- **Mood:** Pemetaan emosional berdasarkan model valence-arousal.

**EN:** *Automated analysis of temporal and frequency parameters to calculate specific metrics:*
- ***Tempo (BPM):*** *Rhythm extraction via acoustic onset detection.*
- ***Tonal Key:*** *Algorithmic matching against major/minor chroma profiles.*
- ***Dominant Solfeggio:*** *Pitch density statistics for scale degree identification.*
- ***Mood:*** *Emotional mapping based on valence-arousal models.*

---

### ✦ Narasi AI Dinamis | Dynamic AI Narrative
**ID:** Terintegrasi dengan Groq (Llama 3) untuk menghasilkan analisis mendalam. Sistem menggabungkan data teknis (BPM, Mood, Key) dengan lirik lagu untuk menyintesis narasi puitis yang menghubungkan musik dengan makna lirik.  
**EN:** *Integrated with Groq (Llama 3) to generate in-depth analysis. The system combines technical data (BPM, Mood, Key) with lyrics to synthesize a poetic narrative correlating music with lyrical meaning.*

---

### ◗ Lirik Tersinkronisasi | Synchronized Lyrics
**ID:** Mengambil lirik sinkron (LRC) langsung dari pangkalan data LRCLIB. Menampilkan teks secara real-time di atas kanvas visualisasi selaras dengan pemutaran audio tanpa beban Speech-to-Text lokal.  
**EN:** *Retrieves synchronized lyrics (LRC) directly from the LRCLIB database. Displays real-time text on the visualization canvas aligned with audio playback without the overhead of local Speech-to-Text.*

---

### ◈ Caching Agresif | Aggressive Caching
**ID:** Memanfaatkan Upstash Redis untuk menyimpan hasil analisis. Setiap permintaan lirik dan narasi di-hash berdasarkan lagu; permintaan berulang akan selesai secara instan tanpa memicu API eksternal.  
**EN:** *Leverages Upstash Redis to store analysis results. Every lyric and narrative request is hashed by track; repeated requests resolve instantly without triggering external APIs.*
