import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QrCode } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { saveSession } from '../lib/session';
import type { Session } from '../lib/types';
import { LogoMark } from '../components/Logo';

/**
 * Landing page for the judge QR code: exchanges the short-lived join link for
 * an officer session, then opens the officer app (which asks for the one tap
 * that enables the alarm sound).
 */
export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<Session>('/demo/join', { body: { token } })
      .then((s) => {
        saveSession({ token: s.token, user: s.user });
        navigate('/officer', { replace: true });
      })
      .catch((e) => setError(errorText(e)));
  }, [token, navigate]);

  return (
    <div className="grid-bg grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm space-y-4">
        <LogoMark size={56} />
        {error ? (
          <>
            <p className="text-xl font-bold">This link didn't work</p>
            <p className="text-slate-400">{error}</p>
            <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <QrCode size={16} /> Ask the presenter for a fresh QR code.
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold">Joining as a traffic officer…</p>
            <p className="text-slate-400">You'll be alerted on this phone when the ambulance approaches your junction.</p>
          </>
        )}
      </div>
    </div>
  );
}
