import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until auth state is resolved

  useEffect(() => {
    const stored = localStorage.getItem('token');
    if (!stored) {
      // No token — nothing to fetch, auth resolved immediately
      setIsLoading(false);
      return;
    }
    // Token exists — validate it by fetching user profile
    setToken(stored);
    fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.email) {
          setUser(data);
        } else {
          // Token invalid — clear it
          localStorage.removeItem('token');
          setToken(null);
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        setToken(null);
      })
      .finally(() => {
        setIsLoading(false); // auth resolved — good or bad
      });
  }, []); // runs once on mount only

  const login = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    // Fetch user after login
    fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    })
      .then((res) => res.json())
      .then((data) => { if (data.email) setUser(data); })
      .catch(() => {});
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, setUser, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
