import { useCallback, useState } from 'react';
import type { Role, Session } from './types';

// sessionStorage, not localStorage: each tab can hold a different role, which is
// how the demo runs driver, officers and control room side by side.
const key = (role: Role) => `ata.session.${role}`;

export function loadSession(role: Role): Session | null {
  try {
    const raw = sessionStorage.getItem(key(role));
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // Drop expired tokens instead of failing on the first request.
    const payload = JSON.parse(atob(s.token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  sessionStorage.setItem(key(s.user.role), JSON.stringify(s));
}

export function useSession(role: Role) {
  const [session, setSession] = useState(() => loadSession(role));
  const logout = useCallback(() => {
    sessionStorage.removeItem(key(role));
    setSession(null);
  }, [role]);
  return { session, setSession, logout };
}
