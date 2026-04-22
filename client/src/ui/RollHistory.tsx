import { useStore } from '../state/store';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isCriticalEntry(dice: string, results: number[]): boolean {
  return dice.endsWith('d20') && results.some(r => r === 1 || r === 20);
}

export function RollHistory() {
  const { state } = useStore();

  return (
    <div className="panel chronicle-panel">
      <div className="panel-title">Chronicle</div>
      <div className="chronicle-body">
        {state.rollHistory.length === 0 ? (
          <p className="panel-empty">The bones have yet to speak…</p>
        ) : (
          state.rollHistory.map(entry => {
            const critical = isCriticalEntry(entry.dice, entry.results);
            return (
              <div key={entry.id} className={`roll-entry${critical ? ' is-critical' : ''}`}>
                <div className="entry-header">
                  <span className="entry-name">{entry.username}</span>
                  <span className="entry-dice-tag">{entry.dice}</span>
                </div>
                <div className="entry-result">
                  {entry.results.length > 1 &&
                    entry.results.map((r, i) => (
                      <span key={i} className="entry-pip">{r}</span>
                    ))}
                  {entry.results.length > 1 && <span className="entry-sep">→</span>}
                  <span className="entry-total">{entry.total}</span>
                </div>
                <span className="entry-time">{formatTime(entry.timestamp)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
