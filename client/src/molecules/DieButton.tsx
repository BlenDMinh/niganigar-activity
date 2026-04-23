import imgD4  from '../assets/HiResDicePack/D4/d4_purple_4.png';
import imgD6  from '../assets/HiResDicePack/D6/D6N_purple_6.png';
import imgD8  from '../assets/HiResDicePack/D8/d8_purple_8.png';
import imgD10 from '../assets/HiResDicePack/D10_and_D100/d10_purple_0.png';
import imgD12 from '../assets/HiResDicePack/D12/d12_purple_12.png';
import imgD20 from '../assets/HiResDicePack/D20/d20_purple_20.png';
import imgD100 from '../assets/HiResDicePack/D10_and_D100/d10_purple_00.png';

const DICE_IMAGES: Record<number, string> = {
  4:   imgD4,
  6:   imgD6,
  8:   imgD8,
  10:  imgD10,
  12:  imgD12,
  20:  imgD20,
  100: imgD100,
};

interface Props {
  sides: number;
  selected: boolean;
  onClick: () => void;
}

export function DieButton({ sides, selected, onClick }: Props) {
  return (
    <button
      className={`die-btn${selected ? ' die-btn--selected' : ''}`}
      onClick={onClick}
      title={`d${sides}`}
    >
      <img className="die-btn__img" src={DICE_IMAGES[sides]} alt={`d${sides}`} />
      <span className="die-btn__label">d{sides}</span>
    </button>
  );
}
