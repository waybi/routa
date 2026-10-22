"use client";

import { useTranslation, SUPPORTED_LOCALES, type Locale } from "@/i18n";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center gap-0.5 rounded-control border border-default bg-subtle p-0.5">
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
            locale === loc
              ? "bg-surface text-primary shadow-sm"
              : "text-secondary hover:text-primary"
          }`}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
