import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PhashService } from './phashService';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  job?: number;
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: { id: number }) {
    this.job = message.id;
  }
  terminate() {
    this.terminated = true;
  }
  reply(phash: string) {
    this.onmessage?.({ data: { id: this.job, phash } });
  }
}

function install(t: TestContext) {
  FakeWorker.all = [];
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  t.after(() => {
    globalThis.Worker = original;
  });
}

const file = new File(['x'], 'a.jpg');
const busy = () =>
  FakeWorker.all.find((w) => !w.terminated && w.job !== undefined)!;

test('a crashed worker fails its job and is replaced', async (t) => {
  install(t);
  const service = new PhashService(1);
  const first = service.hash(file);
  const second = service.hash(file);
  busy().onerror?.();
  assert.equal(await first, null);
  assert.equal(FakeWorker.all.length, 2);
  busy().reply('abc');
  assert.equal(await second, 'abc');
});

test('repeated crashes stop respawning and resolve remaining jobs', async (t) => {
  install(t);
  const service = new PhashService(1);
  const jobs = [
    service.hash(file),
    service.hash(file),
    service.hash(file),
    service.hash(file),
  ];
  for (let i = 0; i < 3; i++) busy().onerror?.();
  assert.deepEqual(await Promise.all(jobs), [null, null, null, null]);
  assert.equal(FakeWorker.all.length, 3);
  assert.equal(await service.hash(file), null);
});
