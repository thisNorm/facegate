import type { FileGate } from '../../src/app/config.ts';
import type { Repositories } from '../../src/app/repositories.ts';
import { insertFileGates } from '../../src/modules/gate/gate.import.ts';
import { createGateRegistry } from '../../src/modules/gate/gate.registry.ts';

/** gates.json 형식의 게이트를 메모리 DB에 넣고 레지스트리를 만든다 */
export function testRegistry(repos: Repositories, gates: FileGate[] = []) {
  insertFileGates(repos.gates, gates, '2026-11-03 09:00:00');
  const registry = createGateRegistry(repos.gates);
  registry.reload();
  return registry;
}
