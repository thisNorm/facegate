const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 다음 한국 시간 hour:00까지 남은 ms (지금이 정각이면 다음 날) */
export function msUntilKstHour(now: Date, hour: number): number {
  const kstMs = now.getTime() + KST_OFFSET_MS;
  const sinceMidnight = ((kstMs % DAY_MS) + DAY_MS) % DAY_MS;
  const target = hour * 60 * 60 * 1000;
  const wait = target - sinceMidnight;
  return wait > 0 ? wait : wait + DAY_MS;
}

/** 매일 한국 시간 hour시에 task 실행. 돌려주는 함수로 취소 */
export function scheduleDaily(
  hour: number,
  task: () => void,
  now: () => Date = () => new Date(),
): () => void {
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(
      () => {
        try {
          task();
        } catch (error) {
          console.error('[daily]', error);
        }
        arm();
      },
      msUntilKstHour(now(), hour),
    );
    timer.unref();
  };
  arm();
  return () => clearTimeout(timer);
}
