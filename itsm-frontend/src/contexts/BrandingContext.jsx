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
    trial_days_remaining: null,
    on_trial: false,
    trial_expired: false,
    plan: 'free',
    plan_limits: { label: 'Free', max_users: 1, branding: false, sla: false, mfa: false, sso: false, approval_workflows: false, ai_chatbot: false, max_tenants: 1 },
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
        // Fetch trial status if logged in
        if (token) {
          try {
            const bRes = await fetch(`${API}/billing/config`, { headers });
            if (bRes.ok) {
              const billing = await bRes.json();
              data.trial_days_remaining = billing.trial_days_remaining ?? null;
              data.on_trial = billing.on_trial ?? false;
              data.trial_expired = billing.trial_expired ?? false;
              data.trial_plan = billing.trial_plan ?? null;
              data.trial_plan_label = billing.trial_plan_label ?? null;
            }
          } catch {}
          // Fetch signed logo URL if a logo exists
          if (data.logo_url) {
            try {
              const lRes = await fetch(`${API}/admin/branding/logo-url`, { headers });
              if (lRes.ok) {
                const lData = await lRes.json();
                data.logo_signed_url = lData.url;
              }
            } catch {}
          }
        }
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
