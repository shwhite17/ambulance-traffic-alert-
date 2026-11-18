import { OfficerDashboard } from '../components/OfficerDashboard';
import { RoleGate } from '../components/RoleGate';

export function OfficerPage() {
  return (
    <RoleGate role="officer">
      {(session, logout) => (
        <div className="h-full">
          <OfficerDashboard session={session} onLogout={logout} />
        </div>
      )}
    </RoleGate>
  );
}
