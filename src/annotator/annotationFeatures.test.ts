import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtendedAnnotationType } from '../schemaTypes';
import { buildAnnotationFeatureProperties } from './annotationFeatures';

const annotation = (
  overrides: Partial<ExtendedAnnotationType> = {}
): ExtendedAnnotationType =>
  ({
    id: 'annotation-1',
    categoryId: 'category-1',
    x: 100,
    y: 200,
    source: 'manual',
    ...overrides,
  } as unknown as ExtendedAnnotationType);

const colorForCategory = () => '#bc7cff';

test('builds the canonical primary marker properties', () => {
  const properties = buildAnnotationFeatureProperties(
    annotation(),
    colorForCategory
  );

  assert.equal(properties.markerKind, 'primary');
  assert.equal(properties.color, '#bc7cff');
  assert.equal(properties.borderColor, 'rgba(0, 0, 0, 0.7)');
  assert.equal(properties.borderWidth, 1);
  assert.equal(properties.opacity, 1);
  assert.equal(properties.icon, 'identicon-annotation-1');
});

test('secondary markers omit the primary identity icon', () => {
  const properties = buildAnnotationFeatureProperties(
    annotation({ objectId: 'primary-annotation' }),
    colorForCategory
  );

  assert.equal(properties.markerKind, 'secondary');
  assert.equal(properties.icon, '');
});

test('marker status and transient styles stay consistent across viewers', () => {
  const falseNegative = buildAnnotationFeatureProperties(
    annotation({ source: 'manual-false-negative', obscured: true }),
    colorForCategory
  );
  const shadow = buildAnnotationFeatureProperties(
    annotation({ shadow: true, selected: true }),
    colorForCategory
  );

  assert.equal(falseNegative.icon, 'fn-marker');
  assert.equal(falseNegative.statusIcon, 'obscured-marker');
  assert.equal(shadow.markerKind, 'shadow');
  assert.equal(shadow.borderColor, '#ffffff');
  assert.equal(shadow.borderWidth, 2);
  assert.equal(shadow.opacity, 0.75);
  assert.equal(shadow.active, true);
});
