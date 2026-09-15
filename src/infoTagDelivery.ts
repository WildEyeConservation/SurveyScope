/** Serialize ack/release so failed deletes remain retryable and never look done. */
export function createInfoTagDelivery(options: {
  remove: () => Promise<void>;
  visibility: (seconds: number) => Promise<void>;
  stopHeartbeat: () => void;
  onSettled: () => void;
}) {
  let settled = false;
  let tail = Promise.resolve();
  const settle = (operation: () => Promise<void>) => {
    const result = tail.then(async () => {
      if (settled) return;
      await operation();
      settled = true;
      options.stopHeartbeat();
      options.onSettled();
    });
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    ack: () => settle(options.remove),
    release: () => settle(() => options.visibility(0)),
    defer: () => settle(() => options.visibility(30)),
  };
}
