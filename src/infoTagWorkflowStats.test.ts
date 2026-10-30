import assert from 'node:assert/strict';
import test from 'node:test';
import {
  infoTagWorkflowMetrics,
  type InfoTagChange,
} from './infoTagWorkflowStats';

function change(before: string[], after: string[]): InfoTagChange {
  return {
    beforeTags: new Set(before),
    afterTags: new Set(after),
  };
}

test('counts all processed annotations, including unchanged and empty selections', () => {
  assert.deepEqual(
    infoTagWorkflowMetrics([
      change(['old', 'kept'], ['kept', 'new', 'newer']),
      change([], ['young']),
      change(['kept'], ['kept']),
      change([], []),
    ]),
    { annotationsProcessed: 4, annotationsTagged: 2, tagsAdded: 3 },
  );
});

test('restoring initial tags contributes no net changes', () => {
  assert.deepEqual(infoTagWorkflowMetrics([change(['a', 'b'], ['b', 'a'])]), {
    annotationsProcessed: 1,
    annotationsTagged: 0,
    tagsAdded: 0,
  });
});
