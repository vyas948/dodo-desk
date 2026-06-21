import { createContext, useContext, useState, useEffect } from 'react';
import en from './en';
import fr from './fr';

const I18nContext = createContext();

const translations = { en, fr };
const SUPPORTED_LANGS = ['en', 'fr'];
const STORAGE_KEY = 'dodesk_lang';

function detectLanguage() {
  // 1. User's saved preference
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;

  // 2. Browser language (e.g. "fr-FR" → "fr", "en-US" → "en")
  const browser = (navigator.language || navigator.userLanguage || 'en')
    .toLowerCase()
    .split('-')[0];
  if (SUPPORTED_LANGS.includes(browser)) return browser;

  // 3. Default to English
  return 'en';
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  const setLanguage = (lang) => {
    if (SUPPORTED_LANGS.includes(lang)) {
      localStorage.setItem(STORAGE_KEY, lang);
      setLanguageState(lang);
    }
  };

  const t = (key) => {
    const keys = key.split('.');
    let result = translations[language];
    for (const k of keys) {
      result = result?.[k];
    }
    return result || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useTranslation = () => useContext(I18nContext);
