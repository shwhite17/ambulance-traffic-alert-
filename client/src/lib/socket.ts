import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type Handlers = Record<string, (payload: any) => void>;

/**
 * One authenticated socket per hook instance. Handlers are kept in a ref so
 * callers can pass inline functions without reconnecting on every render.
 * The server sends a `snapshot` on every (re)connect, so state self-heals.
 */
export function useSocket(token: string | undefined, handlers: Handlers) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return;
    const s = io({ auth: { token }, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));
    s.onAny((event: string, payload: unknown) => handlersRef.current[event]?.(payload));
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  return { socket, connected };
}
