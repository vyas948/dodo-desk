import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { API } from '../api';

const BrandingContext = createContext({});

export function BrandingProvider({ children }) {
  const { token } = useAuth();
  const [branding, setBranding] = useState({
    company_name: '',
    company_tagline: null,
    primary_color: null,
    accent_color: null,
    logo_url: null,
    support_email: null,
  });
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  const fetchBranding = useCallback(async () => {
    try {
      const url = token
        ? `${API}/admin/branding`
        : `${API}/branding/public`;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setBranding(data);
        setBrandingLoaded(true);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Only apply colors after branding is loaded — prevents flash
  useEffect(() => {
    if (!brandingLoaded) return;
    document.documentElement.style.setProperty('--brand-primary', branding.primary_color || '#4f46e5');
    document.documentElement.style.setProperty('--brand-accent', branding.accent_color || '#818cf8');
  }, [branding.primary_color, branding.accent_color, brandingLoaded]);

  return (
    <BrandingContext.Provider value={{ ...branding, brandingLoaded, refreshBranding: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
