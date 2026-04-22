import { useState, useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { getSocket } from '../socket/client';

const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

interface Props {
  instanceId: string;
}

export function DicePicker({ instanceId }: Props) {
  const { state } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentUserId = state.currentUser?.userId;
  const myPendingRoll = currentUserId
    ? Object.values(state.pendingRolls).find(p => p.userId === currentUserId)
    : null;

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded]);

  function handleRoll() {
    if (!selectedDie) return;
    const dice = `${count}d${selectedDie}`;
    getSocket().emit('roll_start', { instanceId, dice, isHidden: false });
    setExpanded(false);
    setSelectedDie(null);
    setCount(1);
  }

  function handleReveal() {
    if (!myPendingRoll) return;
    getSocket().emit('roll_reveal', { instanceId, rollId: myPendingRoll.rollId });
  }

  if (myPendingRoll) {
    return (
      <div className="dice-picker" ref={containerRef}>
        <button className="reveal-button" onClick={handleReveal}>
          Reveal {myPendingRoll.dice}
        </button>
      </div>
    );
  }

  return (
    <div className="dice-picker" ref={containerRef}>
      {expanded && (
        <>
          {selectedDie && (
            <div className="count-row">
              <span className="count-label">Cast</span>
              <input
                className="count-input"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={e => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              />
              <span className="count-notation">× d{selectedDie}</span>
              <button className="roll-button" onClick={handleRoll}>
                Roll the Bones
              </button>
            </div>
          )}
          <div className="die-grid">
            {DIE_TYPES.map(sides => (
              <button
                key={sides}
                className={`die-button${selectedDie === sides ? ' selected' : ''}`}
                onClick={() => setSelectedDie(sides)}
              >
                d{sides}
              </button>
            ))}
          </div>
        </>
      )}
      <button className="fab" onClick={() => setExpanded(v => !v)}>⚄</button>
    </div>
  );
}
