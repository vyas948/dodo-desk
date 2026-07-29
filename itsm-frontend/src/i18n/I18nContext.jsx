import { API } from '../api';
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

  // On mount, sync localStorage language to backend so emails use correct language
  useEffect(() => {
    const lang = detectLanguage();
    const token = localStorage.getItem('token');
    if (token && lang) {
      fetch(`${API}/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ language: lang }),
      }).catch(() => {});
    }
  }, []);

  const setLanguage = (lang) => {
    if (SUPPORTED_LANGS.includes(lang)) {
      localStorage.setItem(STORAGE_KEY, lang);
      setLanguageState(lang);
      // Save to backend so emails are sent in the correct language
      const token = localStorage.getItem('token');
      if (token) {
        fetch(`${API}/users/me`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ language: lang }),
        }).catch(() => {}); // silent fail — localStorage is the source of truth for UI
      }
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
