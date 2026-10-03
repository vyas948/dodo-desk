import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AuthContext = createContext();

// How often to re-validate the session against the backend.
// 10 seconds means a second login on another device kicks the first within ~10s.
const SESSION_CHECK_INTERVAL_MS = 10000; // 10 seconds

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until auth state is resolved
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null);
  // MSP "acting as a client tenant" state — set by switchTenant(), cleared by exitTenant().
  // { id, name, slug } of the client tenant currently being managed, or null when the admin
  // is in their own account. Persisted so a page refresh mid-switch doesn't lose the banner
  // or the ability to switch back.
  const [actingTenant, setActingTenant] = useState(() => {
    try {
      const saved = localStorage.getItem('dodesk_acting_tenant');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const intervalRef = useRef(null);

  const forceLogout = useCallback((message) => {
    localStorage.removeItem('token');
    localStorage.removeItem('dodesk_home_token');
    localStorage.removeItem('dodesk_acting_tenant');
    setToken(null);
    setUser(null);
    setActingTenant(null);
    if (message) setSessionExpiredMessage(message);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Validates the current token against the backend. Returns the user object on
  // success, or null (and force-logs-out) on any auth failure — including the
  // single-session 401 the backend sends when a newer login has invalidated this one.
  const validateSession = useCallback(async (currentToken) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.status === 401) {
        let detail = 'Your session has ended. Please log in again.';
        try {
          const body = await res.json();
          if (body.detail) detail = body.detail;
        } catch {}
        forceLogout(detail);
        return null;
      }
      if (!res.ok) return null; // transient error — don't log out on network blips
      const data = await res.json();
      if (data.email) {
        setUser(data);
        return data;
      }
      forceLogout('Your session is no longer valid. Please log in again.');
      return null;
    } catch {
      // Network error — don't force logout, could just be offline momentarily
      return null;
    }
  }, [forceLogout]);

  // Initial load — validate whatever's in localStorage
  useEffect(() => {
    const stored = localStorage.getItem('token');
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);
    validateSession(stored).finally(() => setIsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic re-validation while the app is open and a token exists — this is
  // what actually detects "someone logged in elsewhere" without requiring the
  // user to click something that happens to trigger an API call.
  useEffect(() => {
    if (!token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      validateSession(token);
    }, SESSION_CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token, validateSession]);

  // Also re-validate whenever the tab regains focus/visibility — catches the
  // common case of someone switching back to an old tab after logging in
  // elsewhere, without waiting for the next interval tick.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && token) {
        validateSession(token);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [token, validateSession]);

  const login = (newToken) => {
    localStorage.setItem('token', newToken);
    localStorage.removeItem('dodesk_home_token');
    localStorage.removeItem('dodesk_acting_tenant');
    setActingTenant(null);
    setSessionExpiredMessage(null);
    setToken(newToken);
    validateSession(newToken);
    // Sync UI language to backend immediately after login
    const lang = localStorage.getItem('dodesk_lang') || 'en';
    fetch(`${import.meta.env.VITE_API_URL || ''}/users/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` },
      body: JSON.stringify({ language: lang }),
    }).catch(() => {});
  };

  const logout = () => {
    forceLogout(null);
  };

  const clearSessionExpiredMessage = () => setSessionExpiredMessage(null);

  // MSP "act as client tenant" — called after POST /admin/switch-tenant succeeds.
  // Stashes the admin's own token so exitTenant() can restore it later, then activates
  // the newly issued tenant-scoped token. If already acting as another tenant when this
  // is called (switching directly from client A to client B), the original home token —
  // not the client-A one — is kept, so exitTenant() always returns to the real account.
  const switchTenant = (newToken, tenantInfo) => {
    if (!localStorage.getItem('dodesk_home_token')) {
      localStorage.setItem('dodesk_home_token', token);
    }
    localStorage.setItem('token', newToken);
    localStorage.setItem('dodesk_acting_tenant', JSON.stringify(tenantInfo));
    setActingTenant(tenantInfo);
    setToken(newToken);
    validateSession(newToken);
  };

  // Restores the admin's own token, dropping the acting-tenant context entirely.
  const exitTenant = () => {
    const homeToken = localStorage.getItem('dodesk_home_token');
    if (!homeToken) return; // not currently acting as anyone — nothing to restore
    localStorage.setItem('token', homeToken);
    localStorage.removeItem('dodesk_home_token');
    localStorage.removeItem('dodesk_acting_tenant');
    setActingTenant(null);
    setToken(homeToken);
    validateSession(homeToken);
  };

  return (
    <AuthContext.Provider value={{
      token, user, setUser, login, logout, isLoading,
      sessionExpiredMessage, clearSessionExpiredMessage,
      actingTenant, switchTenant, exitTenant,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
