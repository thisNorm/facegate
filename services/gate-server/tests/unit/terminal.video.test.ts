import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../src/shared/secret.ts';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createTerminalVideo,
  type TerminalVideo,
  type CaptureProcess,
} from '../../src/modules/terminal/terminal.video.ts';

const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
const other = Buffer.from([0xff, 0xd8, 3, 0xff, 0xd9]);
const maxFrame = 2 * 1024 * 1024;
const terminal = (terminalKey: number, rtspUri: string) => ({
  terminalKey,
  tokenHash: sha256('t'),
  rtspUri,
});
const gates = [
  {
    terminals: [1, 2, 3, 4, 5].map((terminalKey) =>
      terminal(terminalKey, `rtsp://user:secret@configured.invalid/${terminalKey}`),
    ),
  },
  { terminals: [terminal(6, 'rtsps://other.invalid/six')] },
  { terminals: [] },
];

class FakeCapture extends EventEmitter implements CaptureProcess {
  stdout = new PassThrough();
  kills = 0;

  kill() {
    this.kills++;
    this.emit('exit', null, 'SIGKILL');
    this.stdout.destroy();
    return true;
  }
}

function fixture(t: TestContext, options: Partial<Parameters<typeof createTerminalVideo>[0]> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = { now: 0 };
  const children: FakeCapture[] = [];
  const uris: string[] = [];
  const logs: string[] = [];
  const video: TerminalVideo = createTerminalVideo({
    gates,
    now: () => clock.now,
    log: (line) => logs.push(line),
    maxCaptures: 4,
    ...options,
    launch:
      options.launch ??
      ((uri) => {
        uris.push(uri);
        const child = new FakeCapture();
        children.push(child);
        return child;
      }),
  });
  const tick = (ms: number) => {
    clock.now += ms;
    t.mock.timers.tick(ms);
  };
  t.after(() => {
    video.close();
    for (const child of children) child.stdout.destroy();
  });
  return { video, children, uris, logs, tick };
}

const state = (state: string) => ({ state });

test('never launches for unknown terminals', (t) => {
  const { video, children } = fixture(t);
  assert.equal(video.frame(99), null);
  assert.equal(children.length, 0);
});

test('starts one shared capture on demand and returns the latest frame with its age', (t) => {
  const { video, children, uris, tick } = fixture(t);
  assert.deepEqual(video.frame(1), state('starting'));
  assert.deepEqual(video.frame(1), state('starting'));
  assert.deepEqual(uris, ['rtsp://user:secret@configured.invalid/1']);
  children[0].stdout.emit('data', Buffer.concat([jpeg, other]));
  tick(300);
  assert.deepEqual(video.frame(1), { jpeg: other, ageMs: 300 });
  assert.equal(children.length, 1);
});

test('stops a capture after idle and keeps it while frames are requested', (t) => {
  const { video, children, tick } = fixture(t, { idleMs: 1000, stallMs: 100_000 });
  video.frame(1);
  children[0].stdout.emit('data', jpeg);
  for (let i = 0; i < 5; i++) {
    tick(900);
    assert.ok(video.frame(1));
  }
  assert.equal(children[0].kills, 0);
  tick(1000);
  assert.equal(children[0].kills, 1);
  assert.deepEqual(video.frame(1), state('starting'));
  assert.equal(children.length, 2);
});

test('keeps captures separate per terminal across gates', (t) => {
  const { video, children, uris } = fixture(t);
  video.frame(1);
  video.frame(6);
  assert.deepEqual(uris, ['rtsp://user:secret@configured.invalid/1', 'rtsps://other.invalid/six']);
  children[1].stdout.emit('data', jpeg);
  assert.deepEqual(video.frame(1), state('starting'));
  assert.deepEqual(video.frame(6), { jpeg, ageMs: 0 });
});

test('restarts a capture on the new address when the terminal IP changes', (t) => {
  const moving = [{ terminals: [terminal(1, 'rtsp://u:p@10.0.0.5:8555/')] }];
  const { video, children, uris } = fixture(t, { gates: moving });
  video.frame(1);
  children[0].stdout.emit('data', jpeg);
  moving[0].terminals[0] = terminal(1, 'rtsp://u:p@10.0.0.9:8555/');
  assert.deepEqual(video.frame(1), state('starting'));
  assert.equal(children[0].kills, 1);
  assert.deepEqual(uris, ['rtsp://u:p@10.0.0.5:8555/', 'rtsp://u:p@10.0.0.9:8555/']);
});

test('caps simultaneous captures and reuses a slot freed by idle', (t) => {
  const { video, children, tick } = fixture(t, { idleMs: 1000 });
  for (const key of [1, 2, 3, 4]) assert.deepEqual(video.frame(key), state('starting'));
  assert.deepEqual(video.frame(5), state('busy'));
  assert.equal(children.length, 4);
  tick(500);
  for (const key of [1, 3, 4]) video.frame(key);
  tick(500);
  assert.equal(children[1].kills, 1);
  assert.deepEqual(video.frame(5), state('starting'));
  assert.equal(children.length, 5);
});

test('extracts split SOI and EOI markers across chunks', (t) => {
  const { video, children } = fixture(t);
  video.frame(1);
  children[0].stdout.emit('data', Buffer.from([9, 0xff]));
  children[0].stdout.emit('data', Buffer.from([0xd8, 1, 2, 0xff]));
  assert.deepEqual(video.frame(1), state('starting'));
  children[0].stdout.emit('data', Buffer.from([0xd9]));
  assert.deepEqual(video.frame(1), { jpeg, ageMs: 0 });
});

test('discards junk and abandoned partial JPEGs when a fresh SOI arrives', (t) => {
  const { video, children } = fixture(t);
  video.frame(1);
  children[0].stdout.emit('data', Buffer.from([0xff, 0xd9, 9, 0xff, 0xd8, 7]));
  children[0].stdout.emit('data', jpeg);
  assert.deepEqual(video.frame(1), { jpeg, ageMs: 0 });
});

test('accepts a JPEG of exactly two MiB and drops larger ones', (t) => {
  const { video, children } = fixture(t);
  video.frame(1);
  const large = Buffer.alloc(maxFrame, 1);
  large.set([0xff, 0xd8], 0);
  large.set([0xff, 0xd9], large.length - 2);
  children[0].stdout.emit('data', large);
  assert.deepEqual(video.frame(1), { jpeg: large, ageMs: 0 });
  const giant = Buffer.alloc(maxFrame * 3, 1);
  giant.set([0xff, 0xd8], 0);
  giant.set([0xff, 0xd9], giant.length - 2);
  children[0].stdout.emit('data', giant);
  assert.deepEqual(video.frame(1), { jpeg: large, ageMs: 0 });
  children[0].stdout.emit('data', Buffer.concat([giant, jpeg]));
  assert.deepEqual(video.frame(1), { jpeg, ageMs: 0 });
});

test('bounds incomplete frames across chunks and recovers a split SOI after overflow', (t) => {
  const { video, children } = fixture(t);
  video.frame(1);
  children[0].stdout.emit('data', Buffer.from([0xff, 0xd8]));
  for (let i = 0; i < 10; i++) children[0].stdout.emit('data', Buffer.alloc(maxFrame / 2, 1));
  assert.deepEqual(video.frame(1), state('starting'));
  children[0].stdout.emit('data', Buffer.from([0xff]));
  children[0].stdout.emit('data', jpeg.subarray(1));
  assert.deepEqual(video.frame(1), { jpeg, ageMs: 0 });
});

test('allows ten seconds for the first frame, then the shorter stall timeout', (t) => {
  const { video, children, tick } = fixture(t, { idleMs: 60_000 });
  video.frame(1);
  tick(9999);
  assert.equal(children[0].kills, 0);
  children[0].stdout.emit('data', jpeg);
  tick(4999);
  assert.equal(children[0].kills, 0);
  children[0].stdout.emit('data', jpeg.subarray(0, 3));
  tick(1);
  assert.equal(children[0].kills, 1);
  assert.deepEqual(video.frame(1), state('unavailable'));
});

test('a terminal video that never sends a frame is killed and retried only after the cooldown', (t) => {
  const { video, children, tick } = fixture(t, { idleMs: 60_000 });
  video.frame(1);
  tick(10_000);
  assert.equal(children[0].kills, 1);
  tick(4999);
  assert.deepEqual(video.frame(1), state('unavailable'));
  assert.equal(children.length, 1);
  tick(1);
  assert.deepEqual(video.frame(1), state('starting'));
  assert.equal(children.length, 2);
});

for (const event of ['error', 'exit', 'close', 'stdout-error', 'stdout-end', 'stdout-close']) {
  test(`cleans capture failure (${event}) once and frees its slot`, (t) => {
    const { video, children } = fixture(t);
    for (const key of [1, 2, 3, 4]) video.frame(key);
    children[0].stdout.emit('data', jpeg);
    if (event.startsWith('stdout-')) {
      children[0].stdout.emit(event.slice(7), new Error('fake capture failure'));
    } else {
      children[0].emit(event, 1);
    }
    assert.equal(children[0].kills, 1);
    assert.deepEqual(video.frame(1), state('unavailable'));
    children[0].emit('error', new Error('late fake failure'));
    children[0].emit('exit', 1);
    assert.equal(children[0].kills, 1);
    assert.deepEqual(video.frame(5), state('starting'));
  });
}

test('logs an unexpected exit once without the video address', (t) => {
  const { video, children, logs, tick } = fixture(t, { idleMs: 1000 });
  video.frame(2);
  children[0].emit('exit', 1);
  children[0].emit('exit', 1);
  video.frame(6);
  tick(1000);
  assert.equal(children[1].kills, 1);
  assert.deepEqual(logs, ['terminal 2 video exited code 1']);
});

test('handles synchronous launch throws without leaking timers or slots', (t) => {
  const { video, tick } = fixture(t, {
    launch: () => {
      throw new Error('fake startup failure');
    },
  });
  assert.deepEqual(video.frame(1), state('unavailable'));
  tick(5000);
  for (const key of [1, 2, 3, 4, 5]) assert.deepEqual(video.frame(key), state('unavailable'));
  tick(20_000);
});

test('ignores late data from a stopped capture', (t) => {
  const { video, children, tick } = fixture(t, { idleMs: 1000 });
  video.frame(1);
  const lateData = children[0].stdout.listeners('data')[0] as (data: Buffer) => void;
  tick(1000);
  assert.deepEqual(video.frame(1), state('starting'));
  lateData(jpeg);
  children[0].emit('close', 1);
  assert.deepEqual(video.frame(1), state('starting'));
  assert.equal(children[1].kills, 0);
});

test('server close is idempotent and nothing launches afterwards', (t) => {
  const { video, children, tick } = fixture(t);
  video.frame(1);
  video.frame(2);
  video.close();
  video.close();
  children[0].emit('error', new Error('late closed failure'));
  children[0].stdout.emit('error', new Error('late closed stdout failure'));
  tick(20_000);
  assert.deepEqual(video.frame(1), state('unavailable'));
  assert.deepEqual(
    children.map((child) => child.kills),
    [1, 1],
  );
});

test('kills a process returned after a synchronous close during launch', (t) => {
  const child = new FakeCapture();
  t.after(() => child.stdout.destroy());
  const { video } = fixture(t, {
    launch: () => {
      video.close();
      return child;
    },
  });
  assert.deepEqual(video.frame(1), state('unavailable'));
  child.emit('error', new Error('late startup failure'));
  child.stdout.emit('data', jpeg);
  assert.equal(child.kills, 1);
});

test('rejects non-RTSP and malformed configured sources without launching anything', (t) => {
  const sources = [
    'http://camera.invalid',
    'file:///video',
    'pipe:0',
    '-i',
    'rtsp://',
    'not a URL',
  ];
  const { video, children } = fixture(t, {
    gates: [{ terminals: sources.map((rtspUri, terminalKey) => terminal(terminalKey, rtspUri)) }],
  });
  for (let key = 0; key < sources.length; key++)
    assert.deepEqual(video.frame(key), state('unavailable'));
  assert.equal(children.length, 0);
});

test('default launcher uses configured RTSP as one FFmpeg argument with no shell or secret pipes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new FakeCapture();
  t.after(() => child.stdout.destroy());
  const calls: [string, readonly string[], childProcess.SpawnOptions][] = [];
  t.mock.method(
    childProcess,
    'spawn',
    (command: string, args: readonly string[], options: childProcess.SpawnOptions) => {
      calls.push([command, args, options]);
      return child;
    },
  );
  const video = createTerminalVideo({ gates, ffmpegPath: 'configured-ffmpeg' });
  t.after(() => video.close());
  assert.deepEqual(video.frame(1), state('starting'));
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, 'configured-ffmpeg');
  assert.ok(Array.isArray(args));
  assert.equal(args[args.indexOf('-i') + 1], 'rtsp://user:secret@configured.invalid/1');
  assert.equal(args[args.indexOf('-timeout') + 1], '5000000');
  assert.ok(args.indexOf('-timeout') < args.indexOf('-i'));
  assert.ok(args.includes('fps=10,scale=960:-2'));
  for (const flag of ['nobuffer', 'low_delay'])
    assert.ok(args.indexOf(flag) < args.indexOf('-i'), `${flag} must apply to the input`);
  assert.ok(args.includes('mjpeg'));
  assert.equal(args.at(-1), 'pipe:1');
  assert.deepEqual(options, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
});
