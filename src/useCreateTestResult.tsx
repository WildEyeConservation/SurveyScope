import { useCallback } from 'react';
import {
  setCurrentAnnoCountAction,
  setSessionTestsResultsAction,
  useCurrentAnnoCount,
  useSessionTestsResults,
} from './stores/taskStore';
import { client } from './stores/appClient';
import { fetchAllPaginatedResults, isWithinLocationBounds } from './utils';
import { Schema } from './amplify/client-schema';
import { useCategories } from './data/project';
import {
  useCurrentMembershipRow,
  useCurrentProject,
  useProjectId,
} from './data/projectScope';

interface UseCreateTestResultProps {
  locationId?: string;
  annotationSetId?: string;
  /** The ephemeral set the user's test annotations were written to. */
  testSetId?: string;
  testPresetId?: string;
}

/*
Scores a completed test task: compares the user's annotations (tracked in
currentAnnoCount) against the expected per-category counts stored for the test
location, and records a TestResult plus per-category counts. If the user
already completed this test in the session (e.g. paged back to it), the
existing result is updated instead of creating a duplicate.
*/
export default function useCreateTestResult({
  locationId,
  annotationSetId,
  testSetId,
  testPresetId,
}: UseCreateTestResultProps) {
  const project = useCurrentProject();
  const projectId = useProjectId();
  const categoriesHook = useCategories(projectId);
  const currentPM = useCurrentMembershipRow();
  const currentAnnoCount = useCurrentAnnoCount();
  const setCurrentAnnoCount = setCurrentAnnoCountAction;
  const sessionTestsResults = useSessionTestsResults();
  const setSessionTestsResults = setSessionTestsResultsAction;
  const annotationSetToUse = testSetId ?? annotationSetId;

  return useCallback(async () => {
    //check if the user already completed this test (in the case where the user accidentally skips over the animal and navigates back to the test)
    const existingTestResult = sessionTestsResults.find(
      (result) =>
        result.locationId === locationId &&
        result.annotationSetId === annotationSetToUse
    );

    const userAnnotations = Object.entries(currentAnnoCount).filter(
      ([, annotations]) => annotations.length > 0
    );

    setCurrentAnnoCount({});

    const surveyCategories = categoriesHook.data?.reduce(
      (acc, c) => ({ ...acc, [c.id]: c.name.toLowerCase() }),
      {} as Record<string, string>
    );

    const { data: location } = await client.models.Location.get(
      { id: locationId! },
      { selectionSet: ['x', 'y', 'width', 'height'] }
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
      }
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
      0
    );
    const totalTestCounts = categoryCounts.reduce(
      (acc, count) => acc + (count.count as number),
      0
    );

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
        }
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
      });
      testResult = newTestResult!;
    }

    if (!testResult) {
      console.error('Failed to create TestResult');
      return;
    }

    // Track count of animals missed vs animals in tests, by category
    if (userAnnotationsEntries.length > 0) {
      for (const [categoryName, count] of userAnnotationsEntries) {
        const category = categoryCounts.find(
          (c) => c.category.name.toLowerCase() === categoryName
        );

        if (!category) {
          console.error('Category not found', categoryName);
          continue;
        }

        if (existingTestResult) {
          //update the test result category count
          await client.models.TestResultCategoryCount.update({
            testResultId: existingTestResult.id,
            categoryName: categoryName,
            userCount: count,
            testCount: category.count || 0,
          });
        } else {
          await client.models.TestResultCategoryCount.create({
            testResultId: testResult.id,
            categoryName: categoryName,
            userCount: count,
            testCount: category.count || 0,
            group: project.organizationId,
          });
        }
      }
    } else {
      // User missed all animals; create entries with userCount = 0
      for (const categoryCount of categoryCounts) {
        if (existingTestResult) {
          //update the test result category count
          await client.models.TestResultCategoryCount.update({
            testResultId: existingTestResult.id,
            categoryName: categoryCount.category.name,
            userCount: 0,
            testCount: categoryCount.count || 0,
          });
        } else {
          await client.models.TestResultCategoryCount.create({
            testResultId: testResult.id,
            categoryName: categoryCount.category.name,
            userCount: 0,
            testCount: categoryCount.count || 0,
            group: project.organizationId,
          });
        }
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
    currentPM.userId,
    project,
    locationId,
    annotationSetId,
    annotationSetToUse,
    testPresetId,
  ]);
}
