import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkflowSections,
  sectionToCsvRows,
  type WorkflowContribution,
} from './workflowStatsSections';

function contribution(
  userId: string,
  processed: number,
  activeTimeMs: number,
): WorkflowContribution {
  return {
    workflowType: 'info-tags',
    userId,
    completedUnits: 1,
    skippedUnits: 0,
    activeTimeMs,
    waitingTimeMs: 0,
    metrics: {
      annotationsProcessed: processed,
      annotationsTagged: 0,
      tagsAdded: 0,
    },
  };
}

test('Info Tags weights the overall rate by annotations processed across differently sized images', () => {
  const [section] = buildWorkflowSections(
    [
      contribution('buffalo', 100, 600_000),
      contribution('elephants', 2, 20_000),
    ],
    (id) => id,
  );
  const rows = sectionToCsvRows(section);
  const total = rows.find((row) => row.Username === 'All users')!;
  assert.equal('images completed' in total, false);
  assert.equal(total['Annotations processed'], 102);
  assert.equal(total['Seconds per annotation processed'], '6.1');
  assert.equal(total['Annotations tagged'], '0');
  for (const row of rows) {
    assert.equal('Seconds per image' in row, false);
    assert.equal('Tags removed' in row, false);
    assert.equal('Markers repositioned' in row, false);
  }
  assert.equal(section.footer?.length, section.headings.length);
});

test('missing historical counts cannot produce an inflated per-annotation rate', () => {
  const legacy = contribution('user', 100, 600_000);
  legacy.metrics = {
    annotationsTagged: 3,
    tagsRemoved: 1,
    markersRepositioned: 2,
  };
  const [section] = buildWorkflowSections(
    [legacy, contribution('user', 2, 20_000)],
    (id) => id,
  );
  const [row] = sectionToCsvRows(section);
  assert.equal(row['Seconds per annotation processed'], '—');
  assert.equal(row['Annotations processed'], '—');
  assert.equal('Tags removed' in row, false);
  assert.equal('Markers repositioned' in row, false);
});

test('other workflows retain their existing completion-unit average', () => {
  const [section] = buildWorkflowSections(
    [
      {
        ...contribution('user', 2, 20_000),
        workflowType: 'qc-review',
        metrics: { approved: 1 },
      },
    ],
    (id) => id,
  );
  assert.equal(sectionToCsvRows(section)[0]['Seconds per annotation'], '20.0');
});
