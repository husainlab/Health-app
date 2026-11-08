import { useSyncExternalStore } from "react";

// The data version: bumped after every scoring run and every write a screen reads
// (a check-in, a log entry, the dashboard, coach log actions): every mounted screen's
// query reloads (src/screens/useScreen.ts).

let version = 0;
const versionListeners = new Set<() => void>();

export function dataChanged(): void {
  version++;
  for (const l of versionListeners) l();
}

export const onDataChanged = (l: () => void) => {
  versionListeners.add(l);
  return () => versionListeners.delete(l);
};

const subscribeVersion = (l: () => void) => {
  versionListeners.add(l);
  return () => versionListeners.delete(l);
};

const inactiveSubscribe = () => () => {};

export const dataVersion = (): number => version;

export const useDataVersion = (active = true): number =>
  useSyncExternalStore(active ? subscribeVersion : inactiveSubscribe, dataVersion);

