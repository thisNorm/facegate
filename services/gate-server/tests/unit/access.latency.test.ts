import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLatency } from '../../src/modules/access/access.latency.ts';

test('summarizeLatency uses granted rows only', () => {
  const rows = [
    {
      result: 'GRANTED' as const,
      appearTime: '2026-10-28 08:00:00',
      receivedAt: '2026-10-28 08:00:01.000',
      openedAt: '2026-10-28 08:00:01.040',
    },
    {
      result: 'GRANTED' as const,
      appearTime: '2026-10-28 08:00:10',
      receivedAt: '2026-10-28 08:00:12.000',
      openedAt: '2026-10-28 08:00:12.080',
    },
    {
      result: 'UNREGISTERED' as const,
      appearTime: '2026-10-28 08:00:20',
      receivedAt: '2026-10-28 08:00:29.000',
      openedAt: null,
    },
  ];
  assert.deepEqual(summarizeLatency(rows), {
    count: 2,
    serverMs: { p50: 40, p95: 80, max: 80 },
    aiToServerSec: { p50: 1, p95: 2, max: 2 },
  });
});
