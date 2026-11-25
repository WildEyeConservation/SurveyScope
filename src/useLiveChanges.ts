import { useContext, useEffect, useRef } from 'react';
import { GlobalContext } from './Context';

type Row = Record<string, unknown>;
type Subscribe = (options: { filter: unknown }) => {
  subscribe: (observer: {
    next: (item: Row) => void;
    error?: (error: unknown) => void;
  }) => { unsubscribe: () => void };
};

export function useLiveChanges(
  model: string,
  field: string,
  value: string | null | undefined,
  onChange: (item: Row) => void,
) {
  const { client } = useContext(GlobalContext)!;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!value) return;
    const api = (client.models as unknown as Record<string, Row>)[model];
    const subscriptions = (['onCreate', 'onUpdate', 'onDelete'] as const).map(
      (event) =>
        (api[event] as Subscribe)({
          filter: { [field]: { eq: value } },
        }).subscribe({
          next: (item) => onChangeRef.current(item),
          error: (error) => console.warn(`${model} live updates`, error),
        }),
    );
    return () => subscriptions.forEach((s) => s.unsubscribe());
  }, [client, model, field, value]);
}
