import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { API } from '../api';

const BrandingContext = createContext({});

export function BrandingProvider({ children }) {
  const { token } = useAuth();
  const [branding, setBranding] = useState({
    company_name: 'ITSM Portal',
    company_tagline: null,
    primary_color: '#1e1e2f',
    accent_color: '#4f46e5',
    logo_url: null,
    support_email: null,
  });

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
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Apply colors to CSS variables whenever branding changes
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', branding.primary_color || '#1e1e2f');
    document.documentElement.style.setProperty('--brand-accent', branding.accent_color || '#4f46e5');
  }, [branding.primary_color, branding.accent_color]);

  return (
    <BrandingContext.Provider value={{ ...branding, refreshBranding: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
