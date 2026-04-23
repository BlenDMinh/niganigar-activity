interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function CountStepper({ value, onChange, min = 1, max = 20 }: Props) {
  return (
    <div className="count-stepper">
      <button className="count-stepper__btn" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input
        className="count-stepper__input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
      />
      <button className="count-stepper__btn" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}
