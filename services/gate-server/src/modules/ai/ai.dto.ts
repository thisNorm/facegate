import { parseKst } from '../../shared/time.ts';

// AI 요청 본문은 외부 계약(snake_case). 여기서 검사하고 내부 camelCase로 바꾼다.
// AI의 device_key(카메라 번호)는 그 영상을 내보내는 단말의 terminalKey다 (D-56).
export type AppearDto = {
  workerKey: number;
  isWorker: boolean;
  terminalKey: number;
  appearTime: string;
  fullFrame?: string;
  cropFrame?: string;
};

export type DisappearDto = {
  eventKey: number;
  disappearTime: string;
  durationSec: number | null;
  fullFrame?: string;
  cropFrame?: string;
};

/** rtspReport: AI가 보낸 cameras 배열 원문 ({device_key, rtsp_ok}) */
export type StatusDto = { eventTime: string; rtspReport: unknown[] };

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body =>
  typeof body === 'object' && body !== null ? (body as Body) : {};
const optionalText = (value: unknown) => (typeof value === 'string' ? value : undefined);
const isKstTime = (value: unknown): value is string =>
  typeof value === 'string' && parseKst(value) !== null;

export function parseAppear(body: unknown): AppearDto | null {
  const b = asBody(body);
  if (!Number.isInteger(b.worker_key) || typeof b.is_worker !== 'boolean') return null;
  if (!Number.isInteger(b.device_key) || !isKstTime(b.appear_time)) return null;
  return {
    workerKey: b.worker_key as number,
    isWorker: b.is_worker,
    terminalKey: b.device_key as number,
    appearTime: b.appear_time,
    fullFrame: optionalText(b.full_frame),
    cropFrame: optionalText(b.crop_frame),
  };
}

export function parseDisappear(body: unknown): DisappearDto | null {
  const b = asBody(body);
  if (!Number.isInteger(b.event_key) || !isKstTime(b.disappear_time)) return null;
  return {
    eventKey: b.event_key as number,
    disappearTime: b.disappear_time,
    durationSec:
      typeof b.duration_time === 'number' && Number.isFinite(b.duration_time)
        ? Math.round(b.duration_time)
        : null,
    fullFrame: optionalText(b.full_frame),
    cropFrame: optionalText(b.crop_frame),
  };
}

export function parseEventTime(body: unknown): string | null {
  const { event_time } = asBody(body);
  return isKstTime(event_time) ? event_time : null;
}

export function parseStatus(body: unknown): StatusDto | null {
  const eventTime = parseEventTime(body);
  const { cameras } = asBody(body);
  return eventTime && Array.isArray(cameras) ? { eventTime, rtspReport: cameras } : null;
}
