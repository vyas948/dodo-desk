import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AuthContext = createContext();

// How often to re-validate the session against the backend while the app is open.
// This is what catches "logged in elsewhere" promptly instead of waiting for the
// user's next manual action to trigger a 401.
const SESSION_CHECK_INTERVAL_MS = 60000; // 1 minute

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until auth state is resolved
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null);
  const intervalRef = useRef(null);

  const forceLogout = useCallback((message) => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
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
    setSessionExpiredMessage(null);
    setToken(newToken);
    validateSession(newToken);
  };

  const logout = () => {
    forceLogout(null);
  };

  const clearSessionExpiredMessage = () => setSessionExpiredMessage(null);

  return (
    <AuthContext.Provider value={{
      token, user, setUser, login, logout, isLoading,
      sessionExpiredMessage, clearSessionExpiredMessage,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
