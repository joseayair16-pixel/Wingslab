import { useEffect, useRef } from 'react';

export function useForegroundPolling(callback: () => void, intervalMs = 30_000) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        callbackRef.current();
      }
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [intervalMs]);
}
