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
  // Each entry's dismiss timer is tracked independently so that a second,
  // concurrent roll re-rendering this effect can't cancel a still-pending
  // timer for an earlier entry (which used to leave that toast stuck forever).
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const newIds = state.newRollIds.filter(
      (id) => !processedRef.current.has(id),
    );
    if (newIds.length === 0) return;

    newIds.forEach((id) => processedRef.current.add(id));
    setVisibleIds((prev) => {
      const next = new Set(prev);
      newIds.forEach((id) => next.add(id));
      return next;
    });

    newIds.forEach((id) => {
      const timer = window.setTimeout(() => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        timersRef.current.delete(id);
      }, 5000);
      timersRef.current.set(id, timer);
    });
  }, [state.newRollIds]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

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
