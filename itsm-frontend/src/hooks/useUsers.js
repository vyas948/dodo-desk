import { useState, useEffect } from 'react';
import { API } from '../api';

/**
 * Fetches the active user list from /users/ (accessible to agent + admin).
 * Returns { users, loadingUsers } for use in dropdowns.
 */
export function useUsers(token) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/users/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingUsers(false));
  }, [token]);

  return { users, loadingUsers };
}
