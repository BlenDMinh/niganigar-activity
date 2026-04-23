import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../state/store';
import { getSocket } from '../socket/client';
import { DieButton } from '../molecules/DieButton';
import { CountStepper } from '../molecules/CountStepper';
import toggleImg from '../assets/HiResDicePack/D20/d20_purple_20.png';

const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

const popupVariants = {
  hidden: { opacity: 0, scale: 0.82, y: 16 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 420, damping: 28 },
  },
  exit: {
    opacity: 0, scale: 0.86, y: 12,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as const },
  },
};

const countVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.95 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring' as const, stiffness: 480, damping: 30 },
  },
  exit: {
    opacity: 0, y: -6,
    transition: { duration: 0.14 },
  },
};

interface Props {
  instanceId: string;
}

export function DiceMenu({ instanceId }: Props) {
  const { state } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [isHidden, setIsHidden] = useState(false);

  const currentUserId = state.currentUser?.userId;
  const myPendingRoll = currentUserId
    ? Object.values(state.pendingRolls).find(p => p.userId === currentUserId)
    : null;

  function handleRoll() {
    if (!selectedDie) return;
    getSocket().emit('roll_start', { instanceId, dice: `${count}d${selectedDie}`, isHidden });
    setIsOpen(false);
    setSelectedDie(null);
    setCount(1);
    setIsHidden(false);
  }

  function handleToggle() {
    setIsOpen(p => !p);
    setSelectedDie(null);
    setCount(1);
    setIsHidden(false);
  }

  function handleDieClick(sides: number) {
    setSelectedDie(prev => (prev === sides ? null : sides));
    setCount(1);
  }

  if (myPendingRoll) {
    return (
      <div className="dice-menu">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="dice-menu__awaiting"
        >
          <span className="dice-menu__awaiting-dice">{myPendingRoll.dice}</span>
          <span className="dice-menu__awaiting-hint">tap video 5× to reveal</span>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="dice-menu">
      <AnimatePresence mode="sync">
        {isOpen && (
          <motion.div
            className="dice-menu__popup"
            variants={popupVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Count row slides in when a die is selected */}
            <AnimatePresence mode="sync">
              {selectedDie !== null && (
                <motion.div
                  className="dice-menu__count-row"
                  variants={countVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <span className="dice-menu__count-label">d{selectedDie}</span>
                  <CountStepper value={count} onChange={setCount} />
                  <button
                    className={`dice-menu__hidden-btn${isHidden ? ' dice-menu__hidden-btn--on' : ''}`}
                    onClick={() => setIsHidden(p => !p)}
                    title={isHidden ? 'Hidden roll — only you see the result' : 'Public roll'}
                  >
                    {isHidden ? '✦ Hidden' : '◇ Hidden'}
                  </button>
                  <button className="dice-menu__roll-btn" onClick={handleRoll}>Roll</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Die rack with staggered entrance */}
            <div className="dice-menu__rack">
              {DIE_TYPES.map((sides, i) => (
                <motion.div
                  key={sides}
                  initial={{ opacity: 0, y: 10, scale: 0.80 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    delay: i * 0.04,
                    type: 'spring',
                    stiffness: 500,
                    damping: 30,
                  }}
                >
                  <DieButton
                    sides={sides}
                    selected={selectedDie === sides}
                    onClick={() => handleDieClick(sides)}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className={`dice-menu__toggle${isOpen ? ' dice-menu__toggle--open' : ''}`}
        onClick={handleToggle}
        title={isOpen ? 'Close' : 'Roll dice'}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.90 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      >
        <img src={toggleImg} alt="Dice" className="dice-menu__toggle-img" />
      </motion.button>
    </div>
  );
}
