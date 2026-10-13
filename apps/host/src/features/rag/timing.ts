export type Timed<T> = Readonly<{ value: T; ms: number }>;

export async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now();
  const value = await run();
  return { value, ms: performance.now() - started };
}

export function timedSync<T>(run: () => T): Timed<T> {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}
