import { CommandCenter } from '../components/CommandCenter';
import { RoleGate } from '../components/RoleGate';

export function ControlPage() {
  return <RoleGate role="admin">{(s, logout) => <CommandCenter session={s} mode="control" onLogout={logout} />}</RoleGate>;
}
