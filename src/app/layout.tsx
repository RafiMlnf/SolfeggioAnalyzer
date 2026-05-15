import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/context/LanguageContext";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"], weight: ["300","400","500","600","700"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["300","400","500","600","700"] });

export const metadata: Metadata = {
  title: "Solfeggio Analyzer — Music Mood Analysis",
  description: "Advanced music notation heatmap analyzer. Upload MP3 to visualize pitch, detect key signatures, and classify emotional mood through solfeggio notation analysis.",
  keywords: ["music analysis","notation heatmap","mood detection","solfeggio","pitch detection","audio analyzer"],
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
