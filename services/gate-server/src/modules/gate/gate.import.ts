import fs from 'node:fs';
import { loadGates, type FileGate } from '../../app/config.ts';
import { sha256 } from '../../shared/secret.ts';
import type { GateRepository } from './gate.repository.ts';

export function insertFileGates(repo: GateRepository, gates: FileGate[], at: string): void {
  for (const gate of gates) {
    repo.insertGate(
      {
        gateKey: gate.gateKey,
        name: gate.name,
        adapter: gate.adapter,
        floor: gate.floor ?? null,
        openToAll: gate.openToAll ?? true,
      },
      at,
    );
    for (const t of gate.terminals) {
      const uri = new URL(t.rtspUri);
      repo.insertTerminal({
        terminalKey: t.terminalKey,
        gateKey: gate.gateKey,
        name: `단말 ${t.terminalKey}`,
        model: null,
        appVersion: null,
        tokenHash: sha256(t.token),
        rtspUser: decodeURIComponent(uri.username),
        rtspPassword: decodeURIComponent(uri.password),
        rtspPort: Number(uri.port || 554),
        lastIp: uri.hostname,
        lastSeenAt: null,
        pairedAt: at,
      });
    }
  }
}

/** DB에 게이트가 없을 때 한 번만 가져온다. 그 뒤로 gates.json은 읽지 않는다 (D-57) */
export function importGatesFile(repo: GateRepository, file: string, at: string): number {
  if (repo.listGates().length > 0 || !fs.existsSync(file)) return 0;
  const gates = loadGates(file);
  insertFileGates(repo, gates, at);
  console.log(
    `[gates] ${file}에서 게이트 ${gates.length}대를 DB로 가져왔습니다. 이제 이 파일은 읽지 않습니다.`,
  );
  return gates.length;
}
