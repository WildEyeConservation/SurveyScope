import { useCallback, useContext } from 'react';
import { Schema } from './amplify/client-schema';
import { GlobalContext, ProjectContext, UserContext } from './Context';
import { hasModelField } from './modelFields';
import { fetchAllPaginatedResults, isWithinLocationBounds } from './utils';

interface UseCreateTestResultProps {
  locationId?: string;
  annotationSetId?: string;
  /** The ephemeral set the user's test annotations were written to. */
  testSetId?: string;
  testPresetId?: string;
  /** Job labels used for name-based scoring. */
  labelNames?: string[];
}

/*
Scores a completed test task: compares the user's annotations (tracked in
currentAnnoCount) against the expected per-category counts stored for the test
location, and records a TestResult plus per-category counts. If the user
already completed this test in the session (e.g. paged back to it), the
existing result is updated instead of creating a duplicate.

Only name-linked labels contribute to per-label accuracy; totals include all labels.
*/
export default function useCreateTestResult({
  locationId,
  annotationSetId,
  testSetId,
  testPresetId,
  labelNames,
}: UseCreateTestResultProps) {
  const { project, categoriesHook, currentPM } = useContext(ProjectContext)!;
  const { client } = useContext(GlobalContext)!;
  const {
    currentAnnoCount,
    setCurrentAnnoCount,
    sessionTestsResults,
    setSessionTestsResults,
  } = useContext(UserContext)!;
  const annotationSetToUse = testSetId ?? annotationSetId;

  return useCallback(async () => {
    //check if the user already completed this test (in the case where the user accidentally skips over the animal and navigates back to the test)
    const existingTestResult = sessionTestsResults.find(
      (result) =>
        result.locationId === locationId &&
        result.annotationSetId === annotationSetToUse,
    );

    const userAnnotations = Object.entries(currentAnnoCount).filter(
      ([, annotations]) => annotations.length > 0,
    );

    setCurrentAnnoCount({});

    const surveyCategories = categoriesHook.data?.reduce(
      (acc, c) => ({ ...acc, [c.id]: c.name.toLowerCase() }),
      {} as Record<string, string>,
    );

    const { data: location } = await client.models.Location.get(
      { id: locationId! },
      { selectionSet: ['x', 'y', 'width', 'height'] },
    );

    if (!location) {
      console.error('No location found');
      return;
    }

    // Fetch counts per category for the test location
    const categoryCounts = await fetchAllPaginatedResults(
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

    // Filter annotations to those within the test location and count them per category
    const annotationCounts: { [key: string]: number } = {};
    for (const [categoryId, annotations] of userAnnotations) {
      for (const annotation of annotations) {
        if (isWithinLocationBounds(annotation, location)) {
          annotationCounts[surveyCategories[categoryId]] =
            (annotationCounts[surveyCategories[categoryId]] || 0) + 1;
        }
      }
    }

    const userAnnotationsEntries = Object.entries(annotationCounts);

    // Total count of annotations
    const totalUserCounts = userAnnotationsEntries.reduce(
      (acc, [, count]) => acc + count,
      0,
    );
    const totalTestCounts = categoryCounts.reduce(
      (acc, count) => acc + (count.count as number),
      0,
    );

    const linkedFlag = (
      hasModelField('TestResult', 'labelsLinked') ? { labelsLinked: true } : {}
    ) as object;

    let testResult: Schema['TestResult']['type'];
    if (existingTestResult) {
      //update the test result
      const { data: updatedTestResult } = await client.models.TestResult.update(
        {
          id: existingTestResult.id,
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
      const { data: updated } = existingTestResult
        ? await client.models.TestResultCategoryCount.update(counts)
        : { data: null };
      if (!updated) {
        await client.models.TestResultCategoryCount.create({
          ...counts,
          group: project.organizationId,
        });
      }
    }

    if (!existingTestResult) {
      setSessionTestsResults((prev) => [
        ...prev,
        {
          id: testResult.id,
          locationId: locationId!,
          annotationSetId: annotationSetToUse!,
        },
      ]);
    }
  }, [
    sessionTestsResults,
    setSessionTestsResults,
    currentAnnoCount,
    setCurrentAnnoCount,
    categoriesHook.data,
    client,
    currentPM.userId,
    project,
    locationId,
    annotationSetId,
    annotationSetToUse,
    testPresetId,
    labelNames,
  ]);
}
