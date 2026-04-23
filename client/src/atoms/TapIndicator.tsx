interface Props {
  filled: boolean;
}

export function TapIndicator({ filled }: Props) {
  return <span className={`tap-indicator${filled ? ' tap-indicator--filled' : ''}`} />;
}
