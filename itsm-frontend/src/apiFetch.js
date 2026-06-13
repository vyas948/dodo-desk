import { API } from '../api';

/**
 * Wrapper around fetch that:
 * - Prepends the API base URL
 * - Attaches the Bearer token automatically
 * - Throws a descriptive Error on non-2xx responses
 * - Parses JSON automatically
 *
 * Usage:
 *   const data = await apiFetch('/tickets/', token);
 *   const data = await apiFetch('/tickets/', token, { method: 'POST', body: JSON.stringify(payload) });
 */
export async function apiFetch(path, token, options = {}) {
  const headers = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      message = err.detail || err.message || message;
    } catch {
      // response wasn't JSON, keep default message
    }

    // If session was invalidated (logged in elsewhere) or token invalid, force logout
    if (res.status === 401) {
      try {
        localStorage.clear();
      } catch {}
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }

    throw new Error(message);
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}
