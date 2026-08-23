import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../state/store";
import { Pip } from "../atoms/Pip";

function isNat20(dice: string, results: number[]): boolean {
  return dice.endsWith("d20") && results.includes(20);
}
function isNat1(dice: string, results: number[]): boolean {
  return dice.endsWith("d20") && results.includes(1);
}

const HOLD_MS = 2600;

const cardVariants = {
  hidden: { opacity: 0, scale: 0.6, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 320, damping: 20 },
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    y: -18,
    transition: { duration: 0.3, ease: [0.4, 0, 1, 1] as const },
  },
};

// The bottom-left RollToast log is easy to miss mid-action — this puts
// the same reveal front-and-center for a couple seconds, one at a time
// (queued rather than stacking several giant cards if rolls land close
// together). Uses the same state.newRollIds/rollHistory feed as
// RollToast, so it naturally inherits the same hidden-roll visibility
// rule and the server's frame-40-synced reveal timing.
export function BigRollReveal() {
  const { state } = useStore();
  // FIFO of roll ids waiting to (or currently) showing — the front of the
  // queue is "currently displayed", derived at render time rather than
  // mirrored into its own state, so dismissing one only ever needs a
  // single setQueue call (from the timeout below, not synchronously from
  // an effect reacting to the queue itself).
  const [queue, setQueue] = useState<string[]>([]);
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = state.newRollIds.filter(
      (id) => !processedRef.current.has(id),
    );
    if (fresh.length === 0) return;
    fresh.forEach((id) => processedRef.current.add(id));
    setQueue((prev) => [...prev, ...fresh]);
  }, [state.newRollIds]);

  const currentId = queue[0] ?? null;

  useEffect(() => {
    if (!currentId) return;
    const timer = window.setTimeout(() => {
      setQueue((prev) => prev.slice(1));
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [currentId]);

  const entry = currentId
    ? (state.rollHistory.find((e) => e.id === currentId) ?? null)
    : null;

  const gold = !!entry && isNat20(entry.dice, entry.results) && !isNat1(entry.dice, entry.results);
  const red = !!entry && isNat1(entry.dice, entry.results);
  const variantClass = gold ? " big-reveal__card--gold" : red ? " big-reveal__card--red" : "";

  return (
    <div className="big-reveal">
      <AnimatePresence mode="wait">
        {entry && (
          <motion.div
            key={entry.id}
            className={`big-reveal__card${variantClass}`}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {(gold || red) && (
              <span className="big-reveal__banner">
                {gold ? "Natural 20!" : "Natural 1!"}
              </span>
            )}
            <div className="big-reveal__meta">
              <span className="big-reveal__name">{entry.username}</span>
              <span className="big-reveal__dice">{entry.dice}</span>
            </div>
            <div className="big-reveal__total">{entry.total}</div>
            {entry.results.length > 1 && (
              <div className="big-reveal__pips">
                {entry.results.map((r, i) => (
                  <Pip key={i} value={r} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
