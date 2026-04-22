import { useStore } from '../state/store';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RollHistory() {
  const { state } = useStore();

  return (
    <div className="panel chronicle-panel">
      <div className="panel-title">Chronicle of Rolls</div>
      {state.rollHistory.map(entry => (
        <div key={entry.id} className="roll-entry">
          <div className="roll-entry-header">
            <span className="roll-username">{entry.username}</span>
            <span className="dice-tag">{entry.dice}</span>
            <span className="roll-timestamp">{formatTime(entry.timestamp)}</span>
          </div>
          <div className="roll-entry-body">
            {entry.results.length > 1 &&
              entry.results.map((r, i) => (
                <span key={i} className="die-pip">{r}</span>
              ))}
            {entry.results.length > 1 && <span className="roll-separator">=</span>}
            <span className="roll-total">{entry.total}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
