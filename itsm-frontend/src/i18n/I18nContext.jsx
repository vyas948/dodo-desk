import { createContext, useContext, useState, useEffect } from 'react';
import en from './en';
import fr from './fr';

const I18nContext = createContext();

const translations = { en, fr };

export function I18nProvider({ children, initialLang = 'en' }) {
  const [language, setLanguage] = useState(initialLang);

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