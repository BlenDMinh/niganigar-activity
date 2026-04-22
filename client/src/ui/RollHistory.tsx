import { useStore } from '../state/store';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RollHistory() {
  const { state } = useStore();

  return (
    <div className="slab chronicle-panel">
      <div className="slab-title">
        <span className="slab-title-rune">✦</span>
        <span className="slab-title-text">Chronicle of Rolls</span>
        <span className="slab-title-rune">✦</span>
      </div>
      <div className="chronicle-body">
        {state.rollHistory.length === 0 ? (
          <p className="panel-empty">The bones have yet to speak…</p>
        ) : (
          state.rollHistory.map(entry => (
            <div key={entry.id} className="roll-entry">
              <div className="entry-header">
                <span className="entry-name">{entry.username}</span>
                <span className="entry-dice-tag">{entry.dice}</span>
                <span className="entry-time">{formatTime(entry.timestamp)}</span>
              </div>
              <div className="entry-result">
                {entry.results.length > 1 &&
                  entry.results.map((r, i) => (
                    <span key={i} className="entry-pip">{r}</span>
                  ))}
                {entry.results.length > 1 && <span className="entry-equals">=</span>}
                <span className="entry-total">{entry.total}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
