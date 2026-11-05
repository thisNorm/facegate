import net from 'node:net';
import type { GateAdapter } from '../gate.types.ts';

let transactionId = 0;

export function writeCoil({
  host,
  port = 502,
  unitId = 1,
  coil,
  on,
  timeoutMs = 300,
}: {
  host: string;
  port?: number;
  unitId?: number;
  coil: number;
  on: boolean;
  timeoutMs?: number;
}): Promise<void> {
  transactionId = (transactionId + 1) & 0xffff;
  // MBAP 헤더(트랜잭션, 프로토콜 0, 길이 6, 유닛) + 함수 0x05(코일 하나 쓰기)
  const frame = Buffer.from([
    transactionId >> 8, transactionId & 0xff, 0, 0, 0, 6, unitId,
    0x05, coil >> 8, coil & 0xff, on ? 0xff : 0x00, 0x00,
  ]); // prettier-ignore

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`modbus timeout ${host}:${port}`)), timeoutMs);
    socket.once('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    socket.once('connect', () => socket.write(frame));
    socket.once('data', (data: Buffer) => {
      clearTimeout(timer);
      socket.end();
      if (data[7] !== 0x05) {
        reject(new Error(`modbus exception 0x${data[8]?.toString(16)}`));
        return;
      }
      resolve();
    });
  });
}

const OFF_RETRY_MS = 1000;
// 코일마다 대기 중인 OFF 하나 (겹친 펄스가 서로 끊지 않도록)
const pendingOff = new Map<string, { timer?: NodeJS.Timeout }>();

export async function openDryContact(
  adapter: Extract<GateAdapter, { type: 'DRY_CONTACT' }>,
  log: (line: string) => void,
  offRetryMs = OFF_RETRY_MS,
): Promise<void> {
  const target = {
    host: adapter.host,
    port: adapter.port,
    unitId: adapter.unitId,
    coil: adapter.coil,
  };
  const key = `${adapter.host}:${adapter.port}:${adapter.coil}`;
  clearTimeout(pendingOff.get(key)?.timer);
  const pending: { timer?: NodeJS.Timeout } = {};
  pendingOff.set(key, pending);

  const closeRelay = () => {
    writeCoil({ ...target, on: false }).then(
      () => {
        if (pendingOff.get(key) === pending) pendingOff.delete(key);
      },
      (error: Error) => {
        log(`relay ${adapter.host} close pulse failed: ${error.message}`);
        // 접점이 붙은 채 남지 않도록 성공할 때까지 재시도 (새 펄스가 시작되면 중단)
        if (pendingOff.get(key) === pending)
          pending.timer = setTimeout(closeRelay, offRetryMs).unref();
      },
    );
  };

  let onError: unknown;
  try {
    try {
      await writeCoil({ ...target, on: true });
    } catch {
      await writeCoil({ ...target, on: true }); // 1회 재시도
    }
  } catch (error) {
    onError = error; // 응답만 잃고 릴레이는 ON일 수 있으므로 OFF는 그래도 예약
  }
  if (pendingOff.get(key) === pending)
    pending.timer = setTimeout(closeRelay, adapter.pulseMs).unref();
  if (onError) throw onError; // 호출자가 GATE_ERROR 처리
}
