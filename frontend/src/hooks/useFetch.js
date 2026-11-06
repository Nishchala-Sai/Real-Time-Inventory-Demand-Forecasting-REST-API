import { useEffect, useState } from 'react';
import { request } from '../api';

// Previous data stays visible while a new request runs, so live refetches do not flicker.
export function useFetch(path, refreshKey = 0) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    request('GET', path)
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState((previous) => ({ data: previous.data, error }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey]);

  return state;
}
