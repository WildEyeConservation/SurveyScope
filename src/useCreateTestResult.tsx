import { useCallback, useContext, useRef } from 'react';
import { submitTest } from './api/tasks';
import { ImageContext } from './Context';

interface UseCreateTestResultProps {
  testLeaseId?: string;
  /** The ephemeral set the user's test annotations were written to. */
  testSetId?: string;
}

export default function useCreateTestResult({
  testLeaseId,
  testSetId,
}: UseCreateTestResultProps) {
  const { annotationsHook, deletedAnnotationIds } = useContext(ImageContext)!;
  // Scoring runs after the user has paged on, so it reads the latest local state.
  const localAnnotationsRef = useRef(annotationsHook.data);
  localAnnotationsRef.current = annotationsHook.data;

  return useCallback(async () => {
    if (!testLeaseId) {
      console.error('No test lease to submit');
      return;
    }
    const marks = localAnnotationsRef.current
      .filter((a) => a.setId === testSetId && !deletedAnnotationIds.has(a.id))
      .map((a) => ({ x: a.x, y: a.y, categoryId: a.categoryId }));
    await submitTest(testLeaseId, marks);
  }, [testLeaseId, testSetId, deletedAnnotationIds]);
}
