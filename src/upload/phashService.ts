// Long-lived perceptual-hash worker pool used by the upload pipeline.
// Each upload worker awaits hash() per file before deciding whether to
// upload; the pool keeps workers warm so we don't pay Worker startup cost
// for every file.

interface PendingJob {
  resolve: (phash: string | null) => void;
}

interface QueueEntry {
  id: number;
  file: File;
}

// Consecutive crashes before hashing is abandoned, e.g. when the script 404s.
const MAX_CONSECUTIVE_CRASHES = 3;

type WorkerMessage =
  | { id: number; phash: string }
  | { id: number; error: string };

export class PhashService {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private pending = new Map<number, PendingJob>();
  private running = new Map<Worker, number>();
  private queue: QueueEntry[] = [];
  private nextId = 0;
  private crashes = 0;
  private destroyed = false;

  constructor(workerCount = 4) {
    const count = Math.max(1, workerCount);
    for (let i = 0; i < count; i++) this.spawn();
  }

  hash(file: File): Promise<string | null> {
    if (this.destroyed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve });
      this.queue.push({ id, file });
      this.dispatch();
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.running.clear();
    for (const job of this.pending.values()) job.resolve(null);
    this.pending.clear();
    this.queue.length = 0;
  }

  private spawn(): void {
    const worker = new Worker(new URL('./phashWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      this.running.delete(worker);
      this.crashes = 0;
      this.settle(data.id, 'phash' in data ? data.phash : null);
      this.idle.push(worker);
      this.dispatch();
    };
    worker.onerror = () => {
      const id = this.running.get(worker);
      this.running.delete(worker);
      if (id !== undefined) this.settle(id, null);
      worker.terminate();
      this.workers = this.workers.filter((w) => w !== worker);
      this.idle = this.idle.filter((w) => w !== worker);
      if (this.destroyed) return;
      if (++this.crashes >= MAX_CONSECUTIVE_CRASHES) {
        this.destroy();
        return;
      }
      this.spawn();
      this.dispatch();
    };
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private settle(id: number, phash: string | null): void {
    const job = this.pending.get(id);
    this.pending.delete(id);
    job?.resolve(phash);
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(worker, job.id);
      worker.postMessage({ id: job.id, file: job.file });
    }
  }
}
