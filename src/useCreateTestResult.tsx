import { useCallback, useContext, useRef } from 'react';
import { Schema } from './amplify/client-schema';
import { GlobalContext, ImageContext, ProjectContext } from './Context';
import { hasModelField } from './modelFields';
import {
  countTestAnnotations,
  countTestKey,
  type KeyAnnotation,
  type TestAnnotation,
} from './testScoring';
import { fetchAllPaginatedResults } from './utils';

interface UseCreateTestResultProps {
  locationId?: string;
  annotationSetId?: string;
  /** The ephemeral set the user's test annotations were written to. */
  testSetId?: string;
  testPresetId?: string;
  /** Job labels used for name-based scoring. */
  labelNames?: string[];
  /** Set when the test was served grown to a tile; scored in this box. */
  grownBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageId: string;
  };
}

// Only name-linked labels contribute to per-label accuracy; totals include all labels.
export default function useCreateTestResult({
  locationId,
  annotationSetId,
  testSetId,
  testPresetId,
  labelNames,
  grownBox,
}: UseCreateTestResultProps) {
  const { project, categoriesHook, currentPM } = useContext(ProjectContext)!;
  const { client } = useContext(GlobalContext)!;
  const { annotationsHook, deletedAnnotationIds } = useContext(ImageContext)!;
  const annotationSetToUse = testSetId ?? annotationSetId;
  // Scoring runs after the user has paged on, so it reads the latest local state.
  const localAnnotationsRef = useRef(annotationsHook.data);
  localAnnotationsRef.current = annotationsHook.data;
  const testResultIdRef = useRef<string>();

  return useCallback(async () => {
    const surveyCategories = categoriesHook.data?.reduce(
      (acc, c) => ({ ...acc, [c.id]: c.name.toLowerCase() }),
      {} as Record<string, string>,
    );

    const { data: location } = grownBox
      ? { data: grownBox }
      : await client.models.Location.get(
          { id: locationId! },
          { selectionSet: ['x', 'y', 'width', 'height'] },
        );

    if (!location) {
      console.error('No location found');
      return;
    }

    // Fetch counts per category for the test location
    const categoryCounts = grownBox
      ? countTestKey(
          (await fetchAllPaginatedResults(
            client.models.Annotation.annotationsByImageIdAndSetId,
            {
              imageId: grownBox.imageId,
              setId: { eq: annotationSetId! },
              selectionSet: ['x', 'y', 'categoryId', 'category.name'] as const,
              limit: 10000,
            },
          )) as KeyAnnotation[],
          grownBox,
        )
      : await fetchAllPaginatedResults(
          client.models.LocationAnnotationCount
            .categoryCountsByLocationIdAndAnnotationSetId,
          {
            locationId: locationId!,
            annotationSetId: { eq: annotationSetId },
            selectionSet: ['categoryId', 'category.name', 'count'],
          },
        );

    if (!categoryCounts) {
      console.error('No category counts found');
      return;
    }

    // Local rows cover writes still in flight; stored rows cover earlier visits.
    const stored = (await fetchAllPaginatedResults(
      client.models.Annotation.annotationsByAnnotationSetId,
      {
        setId: annotationSetToUse!,
        selectionSet: ['id', 'x', 'y', 'categoryId'],
      },
    )) as TestAnnotation[];
    const local = localAnnotationsRef.current.filter(
      (a) => a.setId === annotationSetToUse,
    );
    const annotationCounts = countTestAnnotations(
      { local, stored, deletedIds: deletedAnnotationIds },
      location,
      surveyCategories ?? {},
    );

    const totalUserCounts = Object.values(annotationCounts).reduce(
      (acc, count) => acc + count,
      0,
    );
    const totalTestCounts = categoryCounts.reduce(
      (acc, count) => acc + (count.count as number),
      0,
    );

    const linkedFlag = (
      hasModelField('TestResult', 'labelsLinked') ? { labelsLinked: true } : {}
    ) as object;

    const existingId = testResultIdRef.current;
    let testResult: Schema['TestResult']['type'];
    if (existingId) {
      const { data: updatedTestResult } = await client.models.TestResult.update(
        {
          id: existingId,
          testAnimals: totalTestCounts,
          totalMissedAnimals: totalTestCounts - totalUserCounts,
          // Placeholder to satisfy current schema; not used for reporting
          passedOnTotal: false,
          ...linkedFlag,
        },
      );
      testResult = updatedTestResult!;
    } else {
      const { data: newTestResult } = await client.models.TestResult.create({
        userId: currentPM.userId,
        projectId: project.id,
        testPresetId: testPresetId!,
        locationId: locationId!,
        annotationSetId: annotationSetId!,
        testAnimals: totalTestCounts,
        totalMissedAnimals: totalTestCounts - totalUserCounts,
        // Placeholder to satisfy current schema; not used for reporting
        passedOnTotal: false,
        group: project.organizationId,
        ...linkedFlag,
      });
      testResult = newTestResult!;
    }

    if (!testResult) {
      console.error('Failed to create TestResult');
      return;
    }
    testResultIdRef.current = testResult.id;

    const jobLabels = new Set(labelNames?.map((name) => name.toLowerCase()));
    const linked = categoryCounts.filter(
      (c) => !jobLabels.size || jobLabels.has(c.category.name.toLowerCase()),
    );
    for (const c of linked) {
      const counts = {
        testResultId: testResult.id,
        categoryName: c.category.name,
        userCount: annotationCounts[c.category.name.toLowerCase()] ?? 0,
        testCount: c.count ?? 0,
      };
      const { data: updated } = existingId
        ? await client.models.TestResultCategoryCount.update(counts)
        : { data: null };
      if (!updated) {
        await client.models.TestResultCategoryCount.create({
          ...counts,
          group: project.organizationId,
        });
      }
    }
  }, [
    categoriesHook.data,
    client,
    deletedAnnotationIds,
    currentPM.userId,
    project,
    locationId,
    annotationSetId,
    annotationSetToUse,
    testPresetId,
    labelNames,
    grownBox,
  ]);
}
