import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoleGate } from '../components/RoleGate';
import { TripSummaryView } from '../components/TripSummaryView';
import { ErrorBanner, TopBar } from '../components/ui';
import { api, errorText } from '../lib/api';
import type { Session, TripSummary } from '../lib/types';

export function SummaryPage() {
  return <RoleGate role="admin">{(s) => <Summary session={s} />}</RoleGate>;
}

function Summary({ session }: { session: Session }) {
  const { id } = useParams();
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ status: string; summary?: TripSummary | null }>(`/trips/${id}`, { token: session.token })
      .then((r) => (r.summary ? setSummary(r.summary) : setError(r.status === 'active' ? 'This trip is still active.' : 'No summary recorded for this trip.')))
      .catch((e) => setError(errorText(e)));
  }, [id, session.token]);
  return (
    <div className="min-h-full">
      <TopBar title={`Trip #${id} summary`} right={<Link to="/control" className="text-sm underline">Control room</Link>} />
      <main className="mx-auto max-w-5xl p-4">
        <ErrorBanner error={error} />
        {summary && <TripSummaryView summary={summary} />}
      </main>
    </div>
  );
}
