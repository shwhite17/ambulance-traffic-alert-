import { CommandCenter } from '../components/CommandCenter';
import { RoleGate } from '../components/RoleGate';

export function DemoPage() {
  return <RoleGate role="admin">{(s) => <CommandCenter session={s} mode="demo" />}</RoleGate>;
}
