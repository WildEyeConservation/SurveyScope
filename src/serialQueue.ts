// Runs operations in order; a failed one stays first so the next drain retries it.
export function createSerialQueue() {
  const ops: Array<() => Promise<void>> = [];
  let running: Promise<void> | null = null;
  return {
    push(op: () => Promise<void>) {
      ops.push(op);
    },
    get busy() {
      return running !== null;
    },
    drain(): Promise<void> {
      if (running) return running;
      if (ops.length === 0) return Promise.resolve();
      const run = (async () => {
        try {
          while (ops.length > 0) {
            await ops[0]();
            ops.shift();
          }
        } finally {
          running = null;
        }
      })();
      running = run;
      return run;
    },
  };
}
