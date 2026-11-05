import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories, type Repositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import type { Gate } from '../../src/modules/gate/gate.types.ts';
import { loginAsAdmin } from './admin-session.ts';
import type { TerminalVideo } from '../../src/modules/terminal/terminal.video.ts';
import type { FileGate } from '../../src/app/config.ts';
import { testRegistry } from './registry.ts';
import type { Push } from '../../src/modules/terminal/terminal.pairing.ts';
import type { TerminalMessage } from '../../src/modules/terminal/terminal.types.ts';

export const contract = (name: string) =>
  JSON.parse(
    fs.readFileSync(new URL(`../../../../contracts/examples/${name}`, import.meta.url), 'utf8'),
  );

export const JPEG: string = contract('appear-worker.json').full_frame;
/** 신규 등록용 서로 다른 사진. JPEG 끝 뒤에 한 바이트를 붙여 내용만 다르게 한다 */
export const photoSet = (count = 6): string[] =>
  Array.from(
    { length: count },
    (_, i) =>
      'data:image/jpeg;base64,' +
      Buffer.concat([Buffer.from(JPEG.split(',')[1], 'base64'), Buffer.from([i])]).toString(
        'base64',
      ),
  );
export const INGEST = { 'X-Ingest-Key': 'ingest' };

export const TEST_GATES: FileGate[] = [
  {
    gateKey: 1,
    name: '정문 1',
    adapter: { type: 'MOCK' },
    terminals: [
      { terminalKey: 101, token: 'device-token', rtspUri: 'rtsp://gate101:pw@10.0.0.5:8555/' },
    ],
  },
  {
    gateKey: 2,
    name: '정문 2',
    adapter: { type: 'MOCK' },
    terminals: [
      { terminalKey: 102, token: 'device-token-2', rtspUri: 'rtsp://gate102:pw@10.0.0.6:8555/' },
    ],
  },
];

/** 시험에서 직원 부서로 쓰는 소속 (D-59: 없는 소속으로는 등록할 수 없다) */
export const TEST_ORGS = ['개발팀', '보안팀', '관리팀', '인사팀', '개발_팀'];
export function seedTestOrgs(repos: Repositories): void {
  for (const name of TEST_ORGS)
    repos.orgs.create({ name, kind: 'DEPARTMENT' }, '2026-11-03 09:00:00');
}

/** 2026-11-03 09:00:00 (한국 시간) */
export const T0 = new Date('2026-11-03T00:00:00.000Z');

export async function startServer({
  gateFails = false,
  terminalVideo,
  push,
  phoneBaseUrl,
}: {
  gateFails?: boolean;
  terminalVideo?: TerminalVideo;
  push?: Push;
  phoneBaseUrl?: string;
} = {}) {
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-'));
  const repos = createRepositories(openDatabase(':memory:'));
  seedTestOrgs(repos);
  const opened: number[] = [];
  /** 연결된 단말 번호 */
  const connected = new Set<number>();
  /** 연결 해제로 끊은 단말 번호 */
  const disconnected: number[] = [];
  /** 단말로 보낸 웹소켓 메시지 */
  const broadcasts: { gateKey: number; message: TerminalMessage }[] = [];
  let clock = T0;
  const terminalHub = {
    handleUpgrade() {},
    broadcast(gateKey: number, message: TerminalMessage) {
      broadcasts.push({ gateKey, message });
    },
    isConnected: (terminalKey: number) => connected.has(terminalKey),
    disconnect: (terminalKey: number) => {
      disconnected.push(terminalKey);
    },
  };
  const server = await createServer({
    config: { ingestKey: 'ingest', fileDir, duplicateWindowMs: 5000, phoneBaseUrl },
    repos,
    registry: testRegistry(repos, TEST_GATES),
    gateControl: {
      async open(gate: Gate) {
        if (gateFails) throw new Error('relay down');
        opened.push(gate.gateKey);
      },
      async releaseAll() {},
    },
    terminalHub,
    terminalVideo,
    pairingPush: push,
    now: () => clock,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = await loginAsAdmin(repos, base);
  const call = (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = admin,
  ) =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const setNow = (date: Date) => {
    clock = date;
  };
  return {
    server,
    repos,
    base,
    call,
    admin,
    opened,
    connected,
    disconnected,
    broadcasts,
    fileDir,
    setNow,
  };
}
