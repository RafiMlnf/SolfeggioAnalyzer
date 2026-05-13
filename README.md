# Solfeggio Analyzer

Aplikasi web berkinerja tinggi yang dirancang untuk analisis notasi musik secara *real-time* dan pengambilan lirik tersinkronisasi. Sistem ini memadukan pengolahan sinyal digital di sisi klien (komputer pengguna) dengan kecerdasan buatan di sisi server.

## Arsitektur Sistem

| Komponen | Teknologi | Fungsi Utama |
| :--- | :--- | :--- |
| **Inti Frontend** | Next.js, React, TypeScript | Kerangka utama aplikasi, manajemen antarmuka, dan API internal. |
| **Pemrosesan Audio** | Web Audio API, Canvas API | Menjalankan *Fast Fourier Transform* (FFT) di klien dan rendering visual 60FPS. |
| **Penyimpanan Data** | Upstash Redis | Lapisan *caching serverless* untuk memanggil data analisis secara instan. |
| **Integrasi AI** | Groq Llama-3.3-70b | Pembuatan narasi analisis musik bahasa Indonesia secara dinamis. |
| **Mesin Lirik** | LRCLIB API | Pencarian dan pengambilan data lirik berformat LRC yang tersinkronisasi. |

## Rincian Fitur

### ▤ Spektrogram & Heatmap Real-Time
Menggunakan HTML5 Canvas API untuk merender kepadatan data frekuensi secara efisien. Menerjemahkan sinyal audio ke dalam spektrogram *log-spaced* dan *heatmap* notasi Solfeggio khusus yang memperlihatkan distribusi nada pada rentang tiga oktaf.

### ⚙ Pemrosesan Sinyal Sisi Klien
Mengimplementasikan algoritma komputasi FFT secara langsung di dalam peramban web (*browser*). Pendekatan ini secara signifikan menekan beban kerja server dan menghemat pengeluaran *bandwidth* jaringan, karena seluruh proses dekode audio dan perhitungan matematis matriks diselesaikan sepenuhnya secara lokal di mesin pengguna.

### 📊 Deteksi Heuristik Musikal
Melakukan analisis otomatis pada parameter temporal dan frekuensi untuk menghitung karakteristik musikal:
- **Tempo (BPM):** Mengekstraksi ritme melalui deteksi lonjakan energi akustik (*onset detection*).
- **Kunci Nada (Tonal Key):** Melakukan pencocokan algoritma probabilitas terhadap standar profil *chroma* mayor dan minor.
- **Solfeggio Dominan:** Menyusun statistik distribusi tinggi nada untuk mengidentifikasi derajat tangga nada yang paling dominan.
- **Klasifikasi Nuansa (Mood):** Memetakan dimensi lagu berdasarkan teori perbandingan psikologis (*valence-arousal circumplex*).

### ✦ Narasi Kecerdasan Buatan Dinamis
Terintegrasi dengan mesin inferensi Groq (Llama 3) untuk menghasilkan teks dengan pemrosesan bahasa alami. Sistem mengkompilasi seluruh data heuristik lagu (BPM, Nuansa, Kunci Nada) bersama dengan bait-bait lirik lagu, untuk menginstruksikan kecerdasan buatan menyintesis sebuah paragraf analisis yang mampu mengkorelasikan elemen teknis instrumen dengan tema cerita lirik lagu tersebut.

### ◗ Subjudul Lirik Tersinkronisasi
Menggantikan proses *Speech-to-Text* lokal yang membebani komputasi dengan skema permohonan data (*query*) langsung ke pangkalan data publik LRCLIB. Mengambil teks sinkron secara sempurna yang disandarkan pada metadata audio, dan menampilkannya secara langsung di atas antarmuka kanvas yang selaras dengan perpindahan waktu pemutaran audio.

### ◈ Caching Permintaan Agresif
Memanfaatkan fitur integrasi Upstash Redis sebagai tempat singgah penyimpanan sementara yang cerdas. Setiap respon pencarian lirik dan generasi narasi AI akan di-hash menggunakan tanda pengenal lagu dan dicatat di *database* Redis. Pengujian berulang pada berkas audio yang identik akan melangkahi panggilan API pihak ketiga (Groq/LRCLIB) dan langsung menyajikan hasil secara instan.
