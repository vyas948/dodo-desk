import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { API } from '../api';

const BrandingContext = createContext({});
const CACHE_KEY = 'dodesk_branding';

export function BrandingProvider({ children }) {
  const { token } = useAuth();

  // Load from localStorage immediately to prevent flash
  const cached = (() => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
  })();

  const [branding, setBranding] = useState(cached || {
    company_name: '',
    company_tagline: null,
    primary_color: null,
    accent_color: null,
    logo_url: null,
    support_email: null,
  });
  const [brandingLoaded, setBrandingLoaded] = useState(!!cached);

  const fetchBranding = useCallback(async () => {
    try {
      const url = token ? `${API}/admin/branding` : `${API}/branding/public`;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setBranding(data);
        setBrandingLoaded(true);
        // Cache in localStorage for instant load next time
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
      }
    } catch {}
  }, [token]);

  useEffect(() => { fetchBranding(); }, [fetchBranding]);

  // Apply CSS variables — use cached values immediately if available
  useEffect(() => {
    if (!brandingLoaded && !cached) return;
    const primary = branding.primary_color || '#4f46e5';
    const accent = branding.accent_color || '#818cf8';
    document.documentElement.style.setProperty('--brand-primary', primary);
    document.documentElement.style.setProperty('--brand-accent', accent);
  }, [branding.primary_color, branding.accent_color, brandingLoaded]);

  return (
    <BrandingContext.Provider value={{ ...branding, brandingLoaded, refreshBranding: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
