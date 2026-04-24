import { Pip } from "../atoms/Pip";
import type { RollEntry } from "../types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isCritical(dice: string, results: number[]): boolean {
  return dice.endsWith("d20") && results.some((r) => r === 1 || r === 20);
}

interface Props {
  entry: RollEntry;
}

export function RollEntryRow({ entry }: Props) {
  const critical = isCritical(entry.dice, entry.results);
  const multiDie = entry.results.length > 1;

  return (
    <div className={`roll-entry${critical ? " roll-entry--critical" : ""}`}>
      <div className="roll-entry__row">
        <span className="roll-entry__name">{entry.username}</span>
        <span className="roll-entry__dice-tag">{entry.dice}</span>
        {entry.isHidden && (
          <span className="roll-entry__hidden-badge">hidden</span>
        )}
        {critical && <span className="roll-entry__crit-badge">crit</span>}
        <span className="roll-entry__total">{entry.total}</span>
      </div>

      <div className="roll-entry__sub">
        {multiDie && entry.results.map((r, i) => <Pip key={i} value={r} />)}
        {multiDie && <span className="roll-entry__sep">→</span>}
        <time className="roll-entry__time">{formatTime(entry.timestamp)}</time>
      </div>
    </div>
  );
}
