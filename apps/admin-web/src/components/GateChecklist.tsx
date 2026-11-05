import { byFloor, floorName } from '../floor';

export type GateItem = { gateKey: number; name: string; floor: number | null; openToAll: boolean };

/** 게이트를 층별로 묶어 체크. 층 이름 체크로 그 층 전체. 모든 사람 통과와 locked는 체크된 채 잠금 */
export function GateChecklist({
  gates,
  checked,
  locked = new Set(),
  onChange,
}: {
  gates: GateItem[];
  checked: Set<number>;
  locked?: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  const fixed = (g: GateItem) => g.openToAll || locked.has(g.gateKey);
  const toggle = (keys: number[], on: boolean) => {
    const next = new Set(checked);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onChange(next);
  };
  return (
    <div className="gate-checklist">
      {byFloor(gates).map(({ floor, items }) => {
        const free = items.filter((g) => !fixed(g)).map((g) => g.gateKey);
        const all = free.length > 0 && free.every((key) => checked.has(key));
        return (
          <fieldset key={String(floor)}>
            <legend>
              <label className="check">
                <input
                  type="checkbox"
                  checked={all}
                  disabled={free.length === 0}
                  onChange={() => toggle(free, !all)}
                />
                {`${floorName(floor)} 전체`}
              </label>
            </legend>
            {items.map((g) => (
              <label key={g.gateKey} className="check">
                <input
                  type="checkbox"
                  checked={fixed(g) || checked.has(g.gateKey)}
                  disabled={fixed(g)}
                  onChange={(e) => toggle([g.gateKey], e.target.checked)}
                />
                <span>
                  {g.name}
                  {g.openToAll && <span className="muted"> (모든 사람)</span>}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
