"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { Lang } from "@/lib/i18n";

interface LangCtxType { lang: Lang; toggle: () => void; }
const LangCtx = createContext<LangCtxType>({ lang: "id", toggle: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("id");
  return (
    <LangCtx.Provider value={{ lang, toggle: () => setLang(l => l === "id" ? "en" : "id") }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useLang() { return useContext(LangCtx); }
