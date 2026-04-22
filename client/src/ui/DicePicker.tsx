import { useState } from 'react';
import { useStore } from '../state/store';
import { getSocket } from '../socket/client';

const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

interface Props {
  instanceId: string;
}

export function DicePicker({ instanceId }: Props) {
  const { state } = useStore();
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  const [count, setCount] = useState(1);

  const currentUserId = state.currentUser?.userId;
  const myPendingRoll = currentUserId
    ? Object.values(state.pendingRolls).find(p => p.userId === currentUserId)
    : null;

  function handleRoll() {
    if (!selectedDie) return;
    getSocket().emit('roll_start', { instanceId, dice: `${count}d${selectedDie}`, isHidden: false });
    setSelectedDie(null);
    setCount(1);
  }

  function adjustCount(delta: number) {
    setCount(c => Math.max(1, Math.min(20, c + delta)));
  }

  return (
    <div className="dice-tray">
      {myPendingRoll ? (
        <div className="tray-awaiting">
          <span className="awaiting-dice">{myPendingRoll.dice}</span>
          <span className="awaiting-text">Tap the vision five times to unveil your fate</span>
        </div>
      ) : (
        <div className="tray-row">
          <div className="die-rack">
            {DIE_TYPES.map(sides => (
              <button
                key={sides}
                data-sides={sides}
                className={`die-btn${selectedDie === sides ? ' selected' : ''}`}
                onClick={() => setSelectedDie(prev => prev === sides ? null : sides)}
              >
                <span className="die-face">d{sides}</span>
              </button>
            ))}
          </div>

          {selectedDie !== null && (
            <div className="roll-controls">
              <div className="count-stepper">
                <button className="count-btn" onClick={() => adjustCount(-1)}>−</button>
                <input
                  className="count-value"
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={e => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                />
                <button className="count-btn" onClick={() => adjustCount(1)}>+</button>
              </div>
              <span className="count-label">× d{selectedDie}</span>
              <button className="cast-btn" onClick={handleRoll}>Cast the Bones</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
