import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../state/store";
import { Pip } from "../atoms/Pip";
import type { RollEntry } from "../types";

function isCritical(dice: string, results: number[]): boolean {
  return dice.endsWith("d20") && results.some((r) => r === 1 || r === 20);
}

const rowVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 460, damping: 32 },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.95,
    transition: { duration: 0.28, ease: [0.4, 0, 1, 1] as const },
  },
};

export function RollToast() {
  const { state } = useStore();
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newEntries = state.rollHistory.filter(
      (e: RollEntry) => !processedRef.current.has(e.id),
    );
    if (newEntries.length === 0) return;

    newEntries.forEach((e: RollEntry) => processedRef.current.add(e.id));
    setVisibleIds((prev) => {
      const next = new Set(prev);
      newEntries.forEach((e: RollEntry) => next.add(e.id));
      return next;
    });

    const timers = newEntries.map((e: RollEntry) =>
      window.setTimeout(() => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          next.delete(e.id);
          return next;
        });
      }, 5000),
    );

    return () => timers.forEach(clearTimeout);
  }, [state.rollHistory]);

  const visible = state.rollHistory.filter((e: RollEntry) =>
    visibleIds.has(e.id),
  );

  return (
    <div className="roll-toast">
      <AnimatePresence mode="sync">
        {visible.length > 0 && (
          <motion.div
            key="toast-inner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <div className="roll-toast__border" />
            <div className="roll-toast__entries">
              <AnimatePresence mode="popLayout">
                {visible.map((entry) => {
                  const crit = isCritical(entry.dice, entry.results);
                  return (
                    <motion.div
                      key={entry.id}
                      variants={rowVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      layout
                    >
                      <div
                        className={`roll-toast__row${crit ? " roll-toast__row--crit" : ""}`}
                      >
                        <span className="roll-toast__name">
                          {entry.username}
                        </span>
                        <span className="roll-toast__dice">{entry.dice}</span>
                        <div className="roll-toast__results">
                          {entry.results.length > 1 &&
                            entry.results.map((r, i) => (
                              <Pip key={i} value={r} />
                            ))}
                          {entry.results.length > 1 && (
                            <span className="roll-toast__sep">→</span>
                          )}
                          <span className="roll-toast__total">
                            {entry.total}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div className="roll-toast__border" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
