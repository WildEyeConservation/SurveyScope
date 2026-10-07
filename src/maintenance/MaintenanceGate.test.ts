import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useEffect, useState, type ContextType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaintenanceGate } from './MaintenanceGate';
import { MaintenanceContext } from './context';
import {
  isMaintenanceAccessBlocked,
  canReloadForMaintenance,
  setMaintenanceAccessBlocked,
  type MaintenanceState,
} from './state';

// The test renderer has no DOM. Bootstrap's SSR-safe modal still uses window
// for timer cleanup, so supply event/timer cleanup APIs. These tests do not
// cover browser portal/focus behavior.
before(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), { clearTimeout }),
  });
});
after(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

const available: MaintenanceState = {
  revision: 0,
  message: '',
  messageType: 'update',
  publishAt: null,
  denyAccessAt: null,
  serverTime: '2026-09-28T10:00:00Z',
};

for (const scope of ['state', 'userState'] as const) {
  test(`${scope}: failed refresh preserves unsaved work and confirmed access cutoff unmounts it`, () => {
    const queryClient = new QueryClient();
    let mounts = 0;
    let unmounts = 0;
    let pauses = 0;
    let resumes = 0;
    const resumeUploads = () => {
      assert.equal(isMaintenanceAccessBlocked(), false);
      resumes++;
    };
    const pauseUploads = () => {
      pauses++;
    };
    function Editor() {
      const [draft, setDraft] = useState('original');
      useEffect(() => {
        mounts++;
        return () => {
          unmounts++;
        };
      }, []);
      return createElement('input', {
        value: draft,
        onChange: (value: string) => setDraft(value),
      });
    }
    let value: NonNullable<ContextType<typeof MaintenanceContext>> = {
      state: available,
      userState: available,
      now: Date.parse(available.serverTime),
      error: null,
      isSysadmin: false,
      refresh: async () => {},
      save: async () => {},
    };
    const tree = () =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MaintenanceContext.Provider,
          { value },
          createElement(MaintenanceGate, {
            signOut: () => {},
            pauseUploads,
            resumeUploads,
            children: createElement(Editor),
          })
        )
      );
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(tree());
      });
      act(() => {
        renderer.root.findByType('input').props.onChange('unsaved points');
      });
      value = { ...value, error: 'Unable to verify availability' };
      act(() => {
        renderer.update(tree());
      });
      assert.equal(
        renderer.root.findByType('input').props.value,
        'unsaved points'
      );
      assert.equal(
        renderer.root.findByProps({ hidden: true }).findByType('input').props
          .value,
        'unsaved points'
      );
      assert.equal(isMaintenanceAccessBlocked(), true);
      assert.equal(canReloadForMaintenance(), false);
      assert.equal(pauses, 1);
      assert.equal(resumes, 1);
      assert.equal(unmounts, 0);

      value = { ...value, error: null };
      act(() => {
        renderer.update(tree());
      });
      assert.equal(
        renderer.root.findByType('input').props.value,
        'unsaved points'
      );
      assert.equal(
        renderer.root.findByProps({ hidden: false }).findByType('input').props
          .value,
        'unsaved points'
      );
      assert.equal(isMaintenanceAccessBlocked(), false);
      assert.equal(mounts, 1);
      assert.equal(resumes, 2);

      value = {
        ...value,
        [scope]: {
          ...available,
          revision: 1,
          message: 'Updating',
          publishAt: available.serverTime,
          denyAccessAt: available.serverTime,
        },
      };
      act(() => {
        renderer.update(tree());
      });
      assert.equal(renderer.root.findAllByType('input').length, 0);
      assert.equal(unmounts, 1);
      assert.equal(canReloadForMaintenance(), true);
      assert.equal(isMaintenanceAccessBlocked(), true);

      value = { ...value, [scope]: { ...available, revision: 2 } };
      act(() => {
        renderer.update(tree());
      });
      assert.equal(renderer.root.findAllByType('input').length, 0);
      assert.equal(isMaintenanceAccessBlocked(), true);
      assert.equal(mounts, 1);
      assert.equal(resumes, 2);
    } finally {
      act(() => {
        renderer?.unmount();
      });
      queryClient.clear();
      setMaintenanceAccessBlocked(false);
    }
  });
}

test('initial availability failure never mounts the workspace, while sysadmins can recover', () => {
  const queryClient = new QueryClient();
  let value: NonNullable<ContextType<typeof MaintenanceContext>> = {
    state: null,
    userState: null,
    now: 0,
    error: 'Offline',
    isSysadmin: false,
    refresh: async () => {},
    save: async () => {},
  };
  const tree = () =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MaintenanceContext.Provider,
        { value },
        createElement(MaintenanceGate, {
          signOut: () => {},
          pauseUploads: () => {},
          resumeUploads: () => {},
          children: createElement('input', {
            value: 'workspace',
            readOnly: true,
          }),
        })
      )
    );
  let renderer!: ReactTestRenderer;
  try {
    act(() => {
      renderer = create(tree());
    });
    assert.equal(renderer.root.findAllByType('input').length, 0);
    assert.equal(isMaintenanceAccessBlocked(), true);
    value = { ...value, isSysadmin: true };
    act(() => {
      renderer.update(tree());
    });
    assert.equal(renderer.root.findByType('input').props.value, 'workspace');
    assert.equal(isMaintenanceAccessBlocked(), false);
  } finally {
    act(() => {
      renderer?.unmount();
    });
    queryClient.clear();
    setMaintenanceAccessBlocked(false);
  }
});
