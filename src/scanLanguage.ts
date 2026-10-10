import { LANGUAGES, type Language } from './setCode';

export const SCAN_LANGUAGE_KEY = 'ygo-scanner.scan-language.v1';

// The languages a scan can be set to: the cards looked for are in this language only.
export const SCAN_LANGUAGES: Language[] = LANGUAGES.filter((language) => language !== 'Unknown');

const BROWSER_LANGUAGE: Record<string, Language> = {
  en: 'English', fr: 'French', de: 'German', it: 'Italian', es: 'Spanish', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean',
};

// The language chosen last; on a first visit, the language of the phone.
export function readScanLanguage(storage: Pick<Storage, 'getItem'>, browserLanguage: string): Language {
  try {
    const saved = storage.getItem(SCAN_LANGUAGE_KEY);
    if (saved && (SCAN_LANGUAGES as string[]).includes(saved)) return saved as Language;
  } catch {
    // Storage is blocked: fall back on the phone's language.
  }
  return BROWSER_LANGUAGE[browserLanguage.slice(0, 2).toLowerCase()] ?? 'English';
}

export function saveScanLanguage(storage: Pick<Storage, 'setItem'>, language: Language): void {
  try {
    storage.setItem(SCAN_LANGUAGE_KEY, language);
  } catch {
    // The choice still holds until the app is closed.
  }
}
