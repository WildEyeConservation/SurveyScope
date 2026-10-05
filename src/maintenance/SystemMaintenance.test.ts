import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Subscription } from 'rxjs';
import { SystemMaintenanceProvider } from './SystemMaintenance';
import { MaintenanceGate } from './MaintenanceGate';
import { useSystemMaintenance } from './context';
import {
  canReloadForMaintenance,
  isMaintenanceAccessBlocked,
  setMaintenanceAccessBlocked,
  type MaintenanceState,
} from './state';
import type { UserAnnouncement } from './api';

const available: MaintenanceState = {
  revision: 0,
  message: '',
  messageType: 'update',
  publishAt: null,
  denyAccessAt: null,
  serverTime: '2026-01-01T00:00:00Z',
};
const personal = { ...available, userId: 'test-user' };
const originals = new Map<string, PropertyDescriptor | undefined>();
let online = true;
beforeEach(() => {
  online = true;
  for (const [name, value] of Object.entries({
    window: Object.assign(new EventTarget(), { clearTimeout }),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    navigator: {
      get onLine() {
        return online;
      },
    },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  setMaintenanceAccessBlocked(true);
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  setMaintenanceAccessBlocked(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeApi() {
  const reads: {
    global: ReturnType<typeof deferred<MaintenanceState>>;
    personal: ReturnType<typeof deferred<UserAnnouncement>>;
    signal?: AbortSignal;
  }[] = [];
  let globalNext!: (state: MaintenanceState) => void;
  let personalNext!: (state: UserAnnouncement) => void;
  const api: NonNullable<
    ComponentProps<typeof SystemMaintenanceProvider>['api']
  > = {
    getMaintenance: (signal) => {
      const read = {
        global: deferred<MaintenanceState>(),
        personal: deferred<UserAnnouncement>(),
        signal,
      };
      reads.push(read);
      return read.global.promise;
    },
    getUserAnnouncement: () => reads[reads.length - 1].personal.promise,
    setMaintenance: async () => available,
    subscribeMaintenance: (next) => {
      globalNext = next;
      return new Subscription();
    },
    subscribeUserAnnouncement: (next) => {
      personalNext = next;
      return new Subscription();
    },
  };
  return {
    api,
    reads,
    announce: (state: MaintenanceState) => {
      globalNext(state);
      personalNext(personal);
    },
    finish: (index: number, state = available) => {
      reads[index].global.resolve(state);
      reads[index].personal.resolve(personal);
    },
  };
}

async function mount(fake: ReturnType<typeof fakeApi>, isSysadmin = false) {
  const client = new QueryClient();
  let context!: ReturnType<typeof useSystemMaintenance>;
  let pauses = 0;
  let resumes = 0;
  const pauseUploads = () => {
    pauses++;
  };
  const resumeUploads = () => {
    assert.equal(isMaintenanceAccessBlocked(), false);
    resumes++;
  };
  function Probe() {
    context = useSystemMaintenance();
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SystemMaintenanceProvider, {
          api: fake.api,
          isSysadmin,
          children: [
            createElement(Probe, { key: 'probe' }),
            createElement(MaintenanceGate, {
              key: 'gate',
              signOut() {},
              pauseUploads,
              resumeUploads,
              children: createElement('input', {
                defaultValue: 'unsaved draft',
              }),
            }),
          ],
        })
      )
    );
  });
  return {
    renderer,
    get context() {
      return context;
    },
    get pauses() {
      return pauses;
    },
    get resumes() {
      return resumes;
    },
    async close() {
      await act(async () => renderer.unmount());
      client.clear();
    },
  };
}

test('sign-out leaves background work blocked after provider cleanup', async () => {
  const fake = fakeApi();
  const view = await mount(fake);
  try {
    await act(async () => fake.finish(0));
    assert.equal(isMaintenanceAccessBlocked(), false);
    await act(async () =>
      fake.announce({
        ...available,
        revision: 1,
        denyAccessAt: available.serverTime,
      })
    );
    assert.equal(isMaintenanceAccessBlocked(), true);
    assert.equal(canReloadForMaintenance(), true);
  } finally {
    await view.close();
  }
  assert.equal(isMaintenanceAccessBlocked(), true);
  assert.ok(view.pauses >= 2);
});

test('a quick reconnect stays blocked until fresh status arrives and ignores pre-offline responses', async () => {
  const fake = fakeApi();
  const onlineObservations: boolean[] = [];
  // The uploader registers this listener before the React provider mounts.
  window.addEventListener('online', () =>
    onlineObservations.push(isMaintenanceAccessBlocked())
  );
  const view = await mount(fake);
  try {
    await act(async () => fake.finish(0));
    assert.equal(view.resumes, 1);
    // Start a read which will finish after connectivity was lost.
    await act(async () => {
      void view.context.refresh();
    });
    await act(async () => {
      online = false;
      window.dispatchEvent(new Event('offline'));
      assert.equal(isMaintenanceAccessBlocked(), true);
      online = true;
      window.dispatchEvent(new Event('online'));
    });
    assert.deepEqual(onlineObservations, [true]);
    assert.equal(fake.reads[1].signal?.aborted, true);
    assert.equal(fake.reads.length, 3);
    await act(async () => fake.finish(1));
    assert.equal(isMaintenanceAccessBlocked(), true);
    assert.equal(view.resumes, 1);
    await act(async () => fake.finish(2));
    assert.equal(isMaintenanceAccessBlocked(), false);
    assert.equal(view.resumes, 2);
    assert.equal(
      view.renderer.root.findByType('input').props.defaultValue,
      'unsaved draft'
    );
  } finally {
    await view.close();
  }
});

test('a hung status read expires, cancels, and permits a successful retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = fakeApi();
  const view = await mount(fake);
  try {
    await act(async () => fake.finish(0));
    await act(async () => {
      void view.context.refresh();
    });
    await act(async () => t.mock.timers.tick(10000));
    assert.equal(isMaintenanceAccessBlocked(), true);
    assert.match(view.context.error || '', /Unable to verify/);
    assert.equal(fake.reads[1].signal?.aborted, true);
    await act(async () => {
      void view.context.refresh();
    });
    assert.equal(fake.reads.length, 3);
    await act(async () => fake.finish(2));
    assert.equal(isMaintenanceAccessBlocked(), false);
    assert.equal(view.context.error, null);
    await act(async () =>
      fake.finish(1, {
        ...available,
        revision: 9,
        denyAccessAt: available.serverTime,
      })
    );
    assert.equal(isMaintenanceAccessBlocked(), false);
  } finally {
    await view.close();
  }
});

test('subscription arrival before initial query waits for server time, without latching a false cutoff', async () => {
  const fake = fakeApi();
  const view = await mount(fake);
  try {
    // Already past according to this computer, but future according to the server.
    const scheduled = {
      ...available,
      revision: 1,
      denyAccessAt: '2026-01-01T01:00:00Z',
    };
    await act(async () => fake.announce(scheduled));
    assert.equal(Number.isFinite(view.context.now), false);
    assert.equal(view.renderer.root.findAllByType('input').length, 0);
    assert.equal(isMaintenanceAccessBlocked(), true);
    assert.equal(canReloadForMaintenance(), false);
    await act(async () => fake.finish(0));
    assert.equal(view.context.state?.revision, 1);
    assert.equal(view.renderer.root.findAllByType('input').length, 1);
    assert.equal(isMaintenanceAccessBlocked(), false);
  } finally {
    await view.close();
  }
});

test('sysadmins retain recovery access when verification times out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = fakeApi();
  const view = await mount(fake, true);
  try {
    await act(async () => t.mock.timers.tick(10000));
    assert.ok(view.context.error);
    assert.equal(view.renderer.root.findAllByType('input').length, 1);
    assert.equal(isMaintenanceAccessBlocked(), false);
  } finally {
    await view.close();
  }
});
