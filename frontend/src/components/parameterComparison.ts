export function parametersMatch(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const names = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...names].every((name) => left[name] === right[name])
}
