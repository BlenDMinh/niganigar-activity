import { motion } from 'motion/react';
import { useStore } from '../state/store';
import { RollEntryRow } from '../molecules/RollEntryRow';

interface Props {
  onClose: () => void;
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22 } },
  exit:    { opacity: 0, transition: { duration: 0.20 } },
};

const modalVariants = {
  hidden:  { opacity: 0, scale: 0.88, y: 28 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 340, damping: 26, mass: 0.9 },
  },
  exit: {
    opacity: 0, scale: 0.92, y: 18,
    transition: { duration: 0.20, ease: [0.4, 0, 1, 1] as const },
  },
};

export function RollLogModal({ onClose }: Props) {
  const { state } = useStore();

  return (
    <motion.div
      className="modal-overlay"
      variants={overlayVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={onClose}
    >
      <motion.div
        className="modal"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal__header">
          <span className="modal__title">Roll Log</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {state.rollHistory.length === 0 ? (
            <p className="modal__empty">No rolls yet…</p>
          ) : (
            state.rollHistory.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.035, type: 'spring', stiffness: 420, damping: 30 }}
              >
                <RollEntryRow entry={entry} />
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
