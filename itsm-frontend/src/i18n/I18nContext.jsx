import { API } from '../api';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en from './en';
import fr from './fr';

const I18nContext = createContext();

const translations = { en, fr };
const SUPPORTED_LANGS = ['en', 'fr'];
const STORAGE_KEY = 'dodesk_lang';

function detectLanguage() {
  // 1. User's saved preference in localStorage
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;

  // 2. Browser language
  const browser = (navigator.language || navigator.userLanguage || 'en')
    .toLowerCase().split('-')[0];
  if (SUPPORTED_LANGS.includes(browser)) return browser;

  return 'en';
}

function syncLanguageToBackend(lang) {
  const token = localStorage.getItem('token');
  if (!token || !lang) return;
  fetch(`${API}/users/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ language: lang }),
  }).catch(() => {});
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  // Sync to backend whenever the token appears (login) or on mount if already logged in
  // Use a storage event listener to detect when token is set after login
  useEffect(() => {
    // Sync immediately if token exists
    const token = localStorage.getItem('token');
    if (token) {
      syncLanguageToBackend(language);
    }

    // Also sync when storage changes (e.g. after login sets the token)
    const handleStorage = (e) => {
      if (e.key === 'token' && e.newValue) {
        // Token just appeared — sync current language
        const currentLang = localStorage.getItem(STORAGE_KEY) || 'en';
        syncLanguageToBackend(currentLang);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [language]);

  const setLanguage = (lang) => {
    if (SUPPORTED_LANGS.includes(lang)) {
      localStorage.setItem(STORAGE_KEY, lang);
      setLanguageState(lang);
      syncLanguageToBackend(lang);
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
