export interface TestCadenceConfig {
  testType?: string | null;
  interval?: number | null;
  random?: number | null;
  deadzone?: number | null;
}

interface TestCadenceInput {
  unannotatedJobs: number;
  userAnnotated: boolean;
  isTestTask: boolean;
  testingEnabled: boolean;
  config?: TestCadenceConfig;
  /** Number of tasks completed before the task currently being submitted. */
  jobsCompleted: number;
  randomValue?: number;
}

export interface TestCadenceDecision {
  nextUnannotatedJobs: number;
  shouldInsertTest: boolean;
}

/**
 * Decide whether the task immediately following a completed visible task
 * should be a test. The count is intentionally not reset here when a test is
 * due: callers reset it only after a test has actually been prepared.
 */
export function decideTestCadence({
  unannotatedJobs,
  userAnnotated,
  isTestTask,
  testingEnabled,
  config,
  jobsCompleted,
  randomValue = Math.random(),
}: TestCadenceInput): TestCadenceDecision {
  if (isTestTask || userAnnotated) {
    return { nextUnannotatedJobs: 0, shouldInsertTest: false };
  }

  const nextUnannotatedJobs = unannotatedJobs + 1;
  if (!testingEnabled || !config || config.testType === 'none') {
    return { nextUnannotatedJobs, shouldInsertTest: false };
  }

  if (config.testType === 'interval') {
    const interval = config.interval ?? 0;
    return {
      nextUnannotatedJobs,
      shouldInsertTest: interval > 0 && nextUnannotatedJobs >= interval,
    };
  }

  if (config.testType === 'random') {
    const completedJobs = jobsCompleted + 1;
    const pastDeadzone = completedJobs > (config.deadzone ?? 0);
    const selected = randomValue < (config.random ?? 0) / 100;
    return {
      nextUnannotatedJobs,
      shouldInsertTest: pastDeadzone && selected,
    };
  }

  return { nextUnannotatedJobs, shouldInsertTest: false };
}
