const VALID_SIDES = [4, 6, 8, 10, 12, 20, 100];

export function parseDice(notation: string): { count: number; sides: number } {
  const match = notation.match(/^(\d+)d(\d+)$/);
  if (!match) throw new Error(`Invalid dice notation: ${notation}`);

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);

  if (count < 1 || count > 20) throw new Error(`Die count must be 1–20`);
  if (!VALID_SIDES.includes(sides))
    throw new Error(
      `Invalid die sides: ${sides}. Must be one of ${VALID_SIDES.join(', ')}`,
    );

  return { count, sides };
}

export function rollDice(
  count: number,
  sides: number,
): { results: number[]; total: number } {
  const results = Array.from(
    { length: count },
    () => Math.floor(Math.random() * sides) + 1,
  );
  const total = results.reduce((a, b) => a + b, 0);
  return { results, total };
}
