import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import { sha256 } from '../../shared/secret.ts';
import { kst, parseKst } from '../../shared/time.ts';
import type { GateRegistry } from '../gate/gate.registry.ts';
import type { GateRepository } from '../gate/gate.repository.ts';

/** 단말이 연결 순간 알려주는 자기 정보 */
export type DeviceInfo = { model: string; appVersion: string; rtspPort: number };
/** 서버가 만들어 단말에 한 번만 넘기는 연결 정보 */
export type PairingInfo = {
  terminalKey: number;
  token: string;
  gateKey: number;
  gateName: string;
  rtspUser: string;
  rtspPassword: string;
  serverUrls: string[];
};
export type PairingService = ReturnType<typeof createPairingService>;
/** 번호 연결: 서버가 단말 번호 창구로 연결 정보를 보낸다 */
export type Push = (address: string, body: object) => Promise<{ status: number; json: unknown }>;

export const PIN_PORT = 8556;
const CODE_TTL_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_MISSES = 5;

/** 사내망에서 흔한 대역부터. 172.16/12(WSL·Docker 가상)와 100.64/10(VPN)은 뒤로 */
const lanRank = (ip: string) =>
  ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;

/**
 * 단말이 차례로 확인할 서버 주소 후보. 사내망 주소를 앞에 두고, adb 개발 연결을 위해
 * 127.0.0.1을 마지막에 둔다. QR이 촘촘해지지 않게 외부 주소는 3개까지
 */
export function serverUrlsFrom(port: number, interfaces = os.networkInterfaces()): string[] {
  const external = Object.values(interfaces)
    .flat()
    .filter((i) => i !== undefined && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    .sort((a, b) => lanRank(a) - lanRank(b))
    .slice(0, 3)
    .map((ip) => `http://${ip}:${port}`);
  return [...external, `http://127.0.0.1:${port}`];
}

export const sixDigits = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

export function parseDevice(body: unknown): DeviceInfo | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const text = (v: unknown): v is string =>
    typeof v === 'string' && v.length >= 1 && v.length <= 64;
  const port = b.rtspPort;
  if (!text(b.model) || !text(b.appVersion)) return null;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return null;
  return { model: b.model, appVersion: b.appVersion, rtspPort: port as number };
}

const defaultPush: Push = async (address, body) => {
  const res = await fetch(`http://${address}:${PIN_PORT}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
};

/**
 * 단말 연결 (D-57). 토큰과 RTSP 계정은 서버가 만들고 사람이 입력하지 않는다.
 * QR: 단말이 1회용 코드로 요청. 번호: 관리자가 웹에 단말 주소와 번호를 넣으면 서버가 단말로 보낸다.
 */
export function createPairingService({
  repo,
  registry,
  now,
  serverUrls,
  push = defaultPush,
  onPaired = () => {},
}: {
  repo: GateRepository;
  registry: GateRegistry;
  now: () => Date;
  serverUrls: () => string[];
  push?: Push;
  /** 작업 이력용 */
  onPaired?: (
    adminKey: number,
    terminalKey: number,
    gateKey: number,
    method: 'QR' | 'NUMBER',
  ) => void;
}) {
  const misses = new Map<string, { count: number; until: number }>();

  function credentials(gateKey: number): PairingInfo {
    const terminalKey = repo.nextTerminalKey();
    return {
      terminalKey,
      token: crypto.randomBytes(32).toString('hex'),
      gateKey,
      gateName: repo.getGate(gateKey)!.name,
      rtspUser: `gate${terminalKey}`,
      rtspPassword: crypto.randomBytes(16).toString('hex'),
      serverUrls: serverUrls(),
    };
  }

  function save(info: PairingInfo, device: DeviceInfo, ip: string) {
    repo.insertTerminal({
      terminalKey: info.terminalKey,
      gateKey: info.gateKey,
      name: device.model,
      model: device.model,
      appVersion: device.appVersion,
      tokenHash: sha256(info.token),
      rtspUser: info.rtspUser,
      rtspPassword: info.rtspPassword,
      rtspPort: device.rtspPort,
      lastIp: ip,
      lastSeenAt: null,
      pairedAt: kst(now()),
    });
    registry.reload();
  }

  function locked(ip: string): boolean {
    const m = misses.get(ip);
    if (!m) return false;
    if (m.until > now().getTime()) return true;
    if (m.until) misses.delete(ip); // 잠금이 풀리면 다시 다섯 번
    return false;
  }

  function miss(ip: string) {
    const m = misses.get(ip) ?? { count: 0, until: 0 };
    m.count++;
    if (m.count >= MAX_MISSES) m.until = now().getTime() + LOCK_MS;
    misses.set(ip, m);
  }

  return {
    issueCode(gateKey: number, adminKey: number) {
      if (!repo.getGate(gateKey)) return null;
      const code = sixDigits();
      const expiresAt = kst(new Date(now().getTime() + CODE_TTL_MS));
      repo.replaceCode({ code, gateKey, issuedBy: adminKey, expiresAt });
      return { code, expiresAt, serverUrls: serverUrls() };
    },

    pairWithCode(
      code: string,
      device: DeviceInfo,
      ip: string,
    ): PairingInfo | 'INVALID' | 'EXPIRED' | 'USED' | 'LOCKED' {
      if (locked(ip)) return 'LOCKED';
      const found = repo.findCode(code);
      if (!found) {
        miss(ip);
        return 'INVALID';
      }
      if (found.usedAt) return 'USED';
      if (parseKst(found.expiresAt)!.getTime() < now().getTime()) return 'EXPIRED';
      if (!repo.useCode(code, kst(now()))) return 'USED';
      misses.delete(ip);
      const info = credentials(found.gateKey);
      save(info, device, ip);
      onPaired(found.issuedBy, info.terminalKey, info.gateKey, 'QR');
      return info;
    },

    async pairByNumber(
      gateKey: number,
      address: string,
      pin: string,
      adminKey: number,
    ): Promise<{ terminalKey: number } | 'NOT_FOUND' | 'WRONG_PIN' | 'UNREACHABLE'> {
      if (!repo.getGate(gateKey)) return 'NOT_FOUND';
      const info = credentials(gateKey);
      let reply: { status: number; json: unknown };
      try {
        reply = await push(address, { pin, ...info });
      } catch {
        return 'UNREACHABLE';
      }
      if (reply.status === 401) return 'WRONG_PIN';
      const device = reply.status === 200 ? parseDevice(reply.json) : null;
      if (!device) return 'UNREACHABLE';
      save(info, device, address);
      onPaired(adminKey, info.terminalKey, gateKey, 'NUMBER');
      return { terminalKey: info.terminalKey };
    },
  };
}

/** 서버가 그 주소·포트에 TCP로 닿는지. 공유기(NAT) 너머 주소를 걸러낸다 */
export function canReach(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * 영상 주소 후보 중 서버가 RTSP 포트에 닿는 첫 주소. 지금 주소, 접속해 온 주소, 단말이 알려 준 자기 주소,
 * adb 개발 연결(127.0.0.1) 순서로 본다. 하나도 닿지 않으면 null
 */
export async function pickReachable(
  candidates: string[],
  port: number,
  reach: (host: string, port: number) => Promise<boolean> = canReach,
): Promise<string | null> {
  for (const host of [...new Set(candidates)]) if (await reach(host, port)) return host;
  return null;
}
