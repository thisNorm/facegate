import { parseKst } from '../../shared/time.ts';
import type { AccessLogRow } from './access.types.ts';

type LatencyRow = Pick<AccessLogRow, 'result' | 'appearTime' | 'receivedAt' | 'openedAt'>;

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { p50: pick(0.5), p95: pick(0.95), max: sorted.at(-1) };
}

const elapsedMs = (from: string, to: string) =>
  (parseKst(to)?.getTime() ?? NaN) - (parseKst(from)?.getTime() ?? NaN);

export function summarizeLatency(rows: LatencyRow[]) {
  const granted = rows.filter(
    (row): row is LatencyRow & { openedAt: string; appearTime: string } =>
      row.result === 'GRANTED' && row.openedAt !== null && row.appearTime !== null,
  );
  return {
    count: granted.length,
    serverMs: percentiles(granted.map((row) => elapsedMs(row.receivedAt, row.openedAt))),
    aiToServerSec: percentiles(
      granted.map((row) => Math.round(elapsedMs(row.appearTime, row.receivedAt) / 1000)),
    ),
  };
}
