import { useEffect, useRef } from 'react';
import { request } from '../api';

const EVENTS_URL = '/api/v1/events';
const EVENT_TYPES = ['stock.updated', 'forecast.updated', 'alert.opened', 'alert.resolved'];
const RETRY_MS = 5000;

// One stream per session. Handlers live in a ref so changing them never reopens the stream.
export function useLiveEvents(handlers) {
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    let source;
    let retryTimer;
    let hasOpened = false;
    let stopped = false;

    function connect() {
      source = new EventSource(EVENTS_URL);
      source.addEventListener('open', () => {
        // No replay on the server, so a reconnect must refetch whatever it missed.
        if (hasOpened) latest.current.onReconnect?.();
        hasOpened = true;
      });
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => latest.current.onEvent?.(JSON.parse(message.data)));
      }
      source.addEventListener('error', () => {
        // The browser retries dropped connections itself but gives up on an HTTP error,
        // which here means an expired token. Renew it through the API, then reconnect.
        if (source.readyState !== EventSource.CLOSED || stopped) return;
        retryTimer = setTimeout(() => {
          request('GET', '/auth/me')
            .catch(() => null)
            .finally(() => {
              if (!stopped) connect();
            });
        }, RETRY_MS);
      });
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source.close();
    };
  }, []);
}
