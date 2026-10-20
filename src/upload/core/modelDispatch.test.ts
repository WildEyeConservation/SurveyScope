import test from 'node:test';
import assert from 'node:assert/strict';
import { modelForProcessedSources } from './modelDispatch';

test('modelForProcessedSources maps a single source to its model', () => {
  assert.equal(
    modelForProcessedSources(['scoutbotv3', 'scoutbotv3']),
    'scoutbot'
  );
  assert.equal(
    modelForProcessedSources(['heatmap']),
    'elephant-detection-nadir'
  );
});

test('modelForProcessedSources ignores sources that are not detectors', () => {
  assert.equal(
    modelForProcessedSources(['registration-dispatch', 'manual', 'mad-v2']),
    'mad'
  );
});

test('modelForProcessedSources returns null for mixed or missing models', () => {
  assert.equal(modelForProcessedSources(['scoutbotv3', 'owl-d']), null);
  assert.equal(modelForProcessedSources(['registration-dispatch']), null);
  assert.equal(modelForProcessedSources([]), null);
});
