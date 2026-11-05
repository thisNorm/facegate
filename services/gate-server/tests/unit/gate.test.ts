import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { writeCoil } from '../../src/modules/gate/adapters/dry-contact.adapter.ts';
import { createGateControl } from '../../src/modules/gate/gate.service.ts';
import type { Gate, GateAdapter } from '../../src/modules/gate/gate.types.ts';

// respond: 불리언, 또는 (연결 번호 1부터, 프레임) => 응답 여부. 응답하지 않으면 타임아웃이 난다.
async function fakeRelay({
  respond = true,
}: { respond?: boolean | ((connection: number) => boolean) } = {}) {
  const frames: number[][] = [];
  const times: number[] = [];
  let connections = 0;
  const server = net.createServer((socket) => {
    const connection = ++connections;
    socket.on('data', (data) => {
      frames.push([...data]);
      times.push(Date.now());
      const shouldRespond = typeof respond === 'function' ? respond(connection) : respond;
      if (shouldRespond) socket.write(data); // 정상 응답은 요청을 그대로 되돌려줌
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, frames, times, port: (server.address() as net.AddressInfo).port };
}

/** 고정 시간을 기다리지 않고 조건이 맞을 때까지 짧게 확인한다 */
async function until(done: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const gateWith = (adapter: GateAdapter): Gate => ({
  gateKey: 1,
  name: 'test',
  adapter,
  floor: null,
  openToAll: true,
  terminals: [],
});

test('writeCoil sends function 0x05 frame', async () => {
  const { server, frames, port } = await fakeRelay();
  await writeCoil({ host: '127.0.0.1', port, unitId: 1, coil: 3, on: true, timeoutMs: 300 });
  server.close();
  assert.deepEqual(frames[0].slice(2), [0, 0, 0, 6, 1, 0x05, 0, 3, 0xff, 0x00]);
});

test('writeCoil times out when relay is silent', async () => {
  const { server, port } = await fakeRelay({ respond: false });
  await assert.rejects(
    writeCoil({ host: '127.0.0.1', port, coil: 0, on: true, timeoutMs: 100 }),
    /timeout/,
  );
  server.close();
});

test('dry contact gate pulses ON then OFF', async () => {
  const { server, frames, port } = await fakeRelay();
  const control = createGateControl({ log: () => {} });
  await control.open(
    gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 0, pulseMs: 50 }),
  );
  await until(() => frames.length >= 2);
  server.close();
  assert.deepEqual(
    frames.map((frame) => frame.slice(10)),
    [
      [0xff, 0x00],
      [0x00, 0x00],
    ],
  );
});

test('dry contact retries ON once', async () => {
  // 첫 연결은 무응답(타임아웃), 두 번째 연결부터 응답
  const { server, frames, port } = await fakeRelay({ respond: (connection) => connection >= 2 });
  const control = createGateControl({ log: () => {} });
  await control.open(
    gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 0, pulseMs: 50 }),
  );
  assert.equal(frames.length, 2); // ON 두 번 시도 (OFF는 pulseMs 뒤에 나간다)
  assert.deepEqual(frames[1].slice(10), [0xff, 0x00]);
  await until(() => frames.length >= 3);
  server.close();
});

test('dry contact rejects after two failed ON attempts', async () => {
  const { server, port } = await fakeRelay({ respond: false });
  const control = createGateControl({ log: () => {} });
  await assert.rejects(
    control.open(
      gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 0, pulseMs: 50 }),
    ),
    /timeout/,
  );
  server.close();
});

test('dry contact still sends OFF when both ON attempts fail', async () => {
  // ON 두 번은 무응답, 첫 OFF부터 응답해서 재시도 루프가 자연히 끝나게 함
  const { server, frames, port } = await fakeRelay({ respond: (connection) => connection >= 3 });
  const control = createGateControl({ log: () => {} });
  await assert.rejects(
    control.open(
      gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 5, pulseMs: 50 }),
    ),
    /timeout/,
  );
  await until(() => frames.length >= 3);
  server.close();
  assert.deepEqual(
    frames.map((frame) => frame.slice(10, 12)),
    [[0xff, 0x00], [0xff, 0x00], [0x00, 0x00]], // prettier-ignore
  );
});

test('dry contact keeps retrying OFF until it succeeds', async () => {
  // 1번 연결(ON)은 응답, 2·3번(OFF 두 번)은 무시, 4번(OFF 세 번째)은 응답
  const { server, frames, port } = await fakeRelay({
    respond: (connection) => connection === 1 || connection >= 4,
  });
  const lines: string[] = [];
  const control = createGateControl({ log: (line) => lines.push(line), offRetryMs: 20 });
  await control.open(
    gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 6, pulseMs: 50 }),
  );
  await until(() => frames.length >= 4);
  server.close();
  assert.deepEqual(
    frames.map((frame) => frame.slice(10, 12)),
    [[0xff, 0x00], [0x00, 0x00], [0x00, 0x00], [0x00, 0x00]], // prettier-ignore
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0], /relay 127\.0\.0\.1 close pulse failed/);
});

test('overlapping pulses on one coil send a single OFF after the second ON', async () => {
  const { server, frames, times, port } = await fakeRelay();
  const control = createGateControl({ log: () => {} });
  const gate = gateWith({
    type: 'DRY_CONTACT',
    host: '127.0.0.1',
    port,
    unitId: 1,
    coil: 7,
    pulseMs: 100,
  });
  await control.open(gate);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await control.open(gate);
  await new Promise((resolve) => setTimeout(resolve, 500));
  server.close();
  assert.deepEqual(
    frames.map((frame) => frame.slice(10, 12)),
    [[0xff, 0x00], [0xff, 0x00], [0x00, 0x00]], // prettier-ignore
  );
  assert.ok(times[2] - times[1] >= 80, `OFF came ${times[2] - times[1]}ms after the second ON`);
});

test('MOCK adapter only logs', async () => {
  const lines: string[] = [];
  const control = createGateControl({ log: (line) => lines.push(line) });
  await control.open({ ...gateWith({ type: 'MOCK' }), gateKey: 9 });
  assert.match(lines[0], /gate 9 open \(MOCK\)/);
});

test('releaseAll sends one OFF per DRY_CONTACT gate and nothing for MOCK', async () => {
  const { server, frames, port } = await fakeRelay();
  const control = createGateControl({ log: () => {} });
  await control.releaseAll([
    gateWith({ type: 'MOCK' }),
    gateWith({ type: 'DRY_CONTACT', host: '127.0.0.1', port, unitId: 1, coil: 7, pulseMs: 50 }),
  ]);
  server.close();
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].slice(8), [0, 7, 0x00, 0x00]);
});
