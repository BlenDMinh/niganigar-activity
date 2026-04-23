interface Props {
  value: number;
}

export function Pip({ value }: Props) {
  return <span className="pip">{value}</span>;
}
