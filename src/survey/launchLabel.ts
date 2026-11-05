import { createContext, useContext, useEffect } from 'react';

export type LaunchLabel = { text: string; disabledReason?: string } | null;

export const LaunchLabelContext = createContext<
  ((label: LaunchLabel) => void) | null
>(null);

// Lets the active tab name what the Launch button will start.
export function useLaunchLabel(text: string | null, disabledReason?: string) {
  const setLabel = useContext(LaunchLabelContext);
  useEffect(() => {
    setLabel?.(
      text || disabledReason
        ? { text: text ?? 'Launch', disabledReason }
        : null,
    );
  }, [setLabel, text, disabledReason]);
  useEffect(() => () => setLabel?.(null), [setLabel]);
}

export function plural(count: number, noun: string, many = `${noun}s`) {
  return `${count.toLocaleString()} ${count === 1 ? noun : many}`;
}
