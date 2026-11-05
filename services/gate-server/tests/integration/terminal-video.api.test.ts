import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, T0 } from './harness.ts';
import type { FrameResult } from '../../src/modules/terminal/terminal.video.ts';

const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);

function fixture(result: FrameResult = { jpeg, ageMs: 120 }) {
  let requested = 0;
  let closed = false;
  return {
    frame(terminalKey: number): FrameResult {
      if (terminalKey !== 101) return null;
      requested++;
      return result;
    },
    close() {
      closed = true;
    },
    get requested() {
      return requested;
    },
    get closed() {
      return closed;
    },
  };
}

async function serve(t: test.TestContext, video = fixture()) {
  const h = await startServer({ terminalVideo: video });
  t.after(() => {
    h.server.closeAllConnections();
    h.server.close();
  });
  return h;
}

const FRAME = '/api/admin/terminals/101/frame';

test('terminal video frames require WEB login and only exist for configured terminals', async (t) => {
  const video = fixture();
  const h = await serve(t, video);
  assert.equal((await h.call('GET', FRAME, undefined, {})).status, 401);
  for (const path of ['/api/admin/terminals/999/frame', '/api/admin/terminals/abc/frame']) {
    assert.equal((await h.call('GET', path)).status, 404);
  }
  assert.equal(video.requested, 0);
});

test('a frame is a private JPEG with its age', async (t) => {
  const h = await serve(t);
  const res = await h.call('GET', FRAME);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(res.headers.get('x-frame-age-ms'), '120');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), jpeg);
});

test('an expired WEB session cannot read frames', async (t) => {
  const h = await serve(t);
  h.setNow(new Date(T0.getTime() + 24 * 60 * 60 * 1000));
  assert.equal((await h.call('GET', FRAME)).status, 401);
});

test('frames reject cross-site reads before starting a capture', async (t) => {
  const video = fixture();
  const h = await serve(t, video);
  const otherSites: Record<string, string>[] = [
    { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://other.invalid' },
  ];
  for (const headers of otherSites) {
    const res = await h.call('GET', FRAME, undefined, { ...h.admin, ...headers });
    assert.equal(res.status, 403);
  }
  assert.equal(video.requested, 0);
});

test('no frame yet is 204, and an unavailable or busy capture is a sanitized 503', async (t) => {
  const starting = await serve(t, fixture({ state: 'starting' }));
  assert.equal((await starting.call('GET', FRAME)).status, 204);
  const failed = await serve(t, fixture({ state: 'unavailable' }));
  const res = await failed.call('GET', FRAME);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'terminal video unavailable' });
  const busy = await serve(t, fixture({ state: 'busy' }));
  const full = await busy.call('GET', FRAME);
  assert.equal(full.status, 503);
  assert.deepEqual(await full.json(), { error: 'too many terminal videos open' });
  assert.equal((await fetch(`${busy.base}/health`)).status, 200);
});

test('HEAD does not start a capture', async (t) => {
  const video = fixture();
  const h = await serve(t, video);
  assert.equal((await h.call('HEAD', FRAME)).status, 405);
  assert.equal(video.requested, 0);
});

test('server close stops terminal video captures', async (t) => {
  const video = fixture();
  const h = await serve(t, video);
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  assert.equal(video.closed, true);
});
