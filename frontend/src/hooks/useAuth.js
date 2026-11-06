import { useCallback, useEffect, useState } from 'react';
import { request, setUnauthorizedHandler } from '../api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    request('GET', '/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await request('POST', '/auth/login', { email, password });
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await request('POST', '/auth/logout').catch(() => null);
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
