import childProcess from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Gate } from '../gate/gate.types.ts';

export type CaptureProcess = {
  stdout: Readable;
  on(event: 'error' | 'close', listener: () => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
};
/** 단말이 내보내는 RTSP 영상을 서버 FFmpeg로 받아 최근 JPEG 장면을 들고 있음 (D-53) */
export type TerminalVideo = ReturnType<typeof createTerminalVideo>;
/** null: 등록되지 않은 단말. busy: 동시 캡처 수 초과. unavailable: 열 수 없음. starting: 첫 장면 대기 */
export type FrameResult =
  { jpeg: Buffer; ageMs: number } | { state: 'starting' | 'busy' | 'unavailable' } | null;

type Capture = {
  /** 캡처를 띄운 주소. 단말 IP가 바뀌면 다시 띄운다 */
  uri: string;
  active: boolean;
  frame: Buffer | null;
  frameAt: number;
  touch: () => void;
  stop: () => void;
};

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

export function createTerminalVideo({
  gates,
  ffmpegPath = 'ffmpeg',
  launch = (uri) =>
    childProcess.spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        // 지연 줄이기: 입력 버퍼링과 첫 분석을 최소로 (관리자 웹 영상이 1초 넘게 늦던 문제)
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-probesize',
        '32768',
        '-analyzeduration',
        '0',
        '-rtsp_transport',
        'tcp',
        '-timeout',
        '5000000',
        '-i',
        uri,
        '-an',
        '-vf',
        'fps=10,scale=960:-2',
        '-c:v',
        'mjpeg',
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ),
  now = Date.now,
  firstFrameMs = 10_000,
  stallMs = 5000,
  idleMs = 10_000,
  retryMs = 5000,
  maxCaptures = 8,
  log = console.warn,
}: {
  gates: Pick<Gate, 'terminals'>[];
  ffmpegPath?: string;
  launch?: (uri: string) => CaptureProcess;
  now?: () => number;
  /** RTSP 접속과 첫 장면까지 */
  firstFrameMs?: number;
  /** 첫 장면 뒤 장면이 끊긴 것으로 보는 시간 */
  stallMs?: number;
  /** 요청이 없으면 캡처를 끄는 시간 */
  idleMs?: number;
  /** 실패 직후 다시 띄우지 않는 시간 */
  retryMs?: number;
  maxCaptures?: number;
  log?: (line: string) => void;
}) {
  const captures = new Map<string, Capture>();
  const failedAt = new Map<string, number>();
  let closed = false;

  function start(key: string, label: string, uri: string): Capture | null {
    let process: CaptureProcess | undefined;
    let killed = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let partial: Buffer | null = null;
    const capture: Capture = { uri, active: true, frame: null, frameAt: 0, touch, stop };

    function kill() {
      if (!process || killed) return;
      killed = true;
      try {
        process.kill('SIGKILL');
      } catch {
        // Process errors can race with shutdown; cleanup must still finish.
      }
      process.stdout.destroy();
    }

    function stop() {
      if (!capture.active) return;
      capture.active = false;
      if (captures.get(key) === capture) captures.delete(key);
      clearTimeout(stallTimer);
      clearTimeout(idleTimer);
      capture.frame = null;
      partial = null;
      process?.stdout.off('data', onData);
      process?.stdout.off('end', failed);
      process?.stdout.off('close', failed);
      kill();
    }

    function failed() {
      if (!capture.active) return;
      failedAt.set(key, now());
      stop();
    }

    function exited(code: number | null) {
      if (capture.active && !killed) log(`terminal ${label} video exited code ${code}`);
      failed();
    }

    function touch() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, idleMs);
    }

    function armStall(ms: number) {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(failed, ms);
    }

    function onData(chunk: Buffer) {
      if (!capture.active) return;
      const data: Buffer = partial ? Buffer.concat([partial, chunk]) : chunk;
      partial = null;
      let pos = 0;
      for (;;) {
        const soi = data.indexOf(SOI, pos);
        if (soi < 0) {
          // SOI가 청크 경계에서 갈라질 수 있다.
          if (data.at(-1) === 0xff) partial = Buffer.from([0xff]);
          return;
        }
        const eoi = data.indexOf(EOI, soi + 2);
        if (eoi < 0) {
          if (data.length - soi <= MAX_FRAME_BYTES) partial = Buffer.from(data.subarray(soi));
          return;
        }
        // 끝나지 않은 앞 장면은 버리고 EOI 바로 앞의 SOI부터 한 장면으로 본다.
        const begin = data.lastIndexOf(SOI, eoi);
        if (eoi + 2 - begin <= MAX_FRAME_BYTES) {
          capture.frame = Buffer.from(data.subarray(begin, eoi + 2));
          capture.frameAt = now();
          armStall(stallMs);
        }
        pos = eoi + 2;
      }
    }

    // Reserve before launch so reentrant close/start cannot bypass resource limits.
    captures.set(key, capture);
    armStall(firstFrameMs);
    touch();
    try {
      process = launch(uri);
      process.on('error', failed);
      process.on('exit', exited);
      process.on('close', failed);
      // Keep error handlers after shutdown to absorb late process/pipe errors.
      process.stdout.on('error', failed);
      if (!capture.active) {
        kill();
        return null;
      }
      process.stdout.on('end', failed);
      process.stdout.on('close', failed);
      process.stdout.on('data', onData);
      return capture.active ? capture : null;
    } catch {
      failed();
      return null;
    }
  }

  return {
    /** 가장 최근 장면. 필요할 때 캡처를 띄우고, 요청이 끊기면 idleMs 뒤 끈다 */
    frame(terminalKey: number): FrameResult {
      const terminal = gates
        .flatMap((gate) => gate.terminals)
        .find((t) => t.terminalKey === terminalKey);
      if (!terminal) return null;
      if (closed) return { state: 'unavailable' };
      try {
        const source = new URL(terminal.rtspUri);
        if (!['rtsp:', 'rtsps:'].includes(source.protocol) || !source.hostname)
          return { state: 'unavailable' };
      } catch {
        return { state: 'unavailable' };
      }

      const key = String(terminalKey);
      let capture = captures.get(key);
      if (capture && capture.uri !== terminal.rtspUri) {
        capture.stop(); // 단말 IP가 바뀜. 실패로 치지 않고 바로 새 주소로 띄운다
        capture = undefined;
      }
      if (capture) capture.touch();
      else {
        const failed = failedAt.get(key);
        if (failed !== undefined && now() - failed < retryMs) return { state: 'unavailable' };
        if (captures.size >= maxCaptures) return { state: 'busy' };
        capture = start(key, key, terminal.rtspUri) ?? undefined;
        if (!capture) return { state: 'unavailable' };
      }
      return capture.frame
        ? { jpeg: capture.frame, ageMs: Math.max(0, now() - capture.frameAt) }
        : { state: 'starting' };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const capture of [...captures.values()]) capture.stop();
    },
  };
}
