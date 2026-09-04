import {
  useContext,
  useState,
  useEffect,
  Dispatch,
  SetStateAction,
} from 'react';
import { DateTime } from 'luxon';
import humanizeDuration from 'humanize-duration';
import { ProgressContext } from './progress';

interface UseUpdateProgressParams {
  taskId: string;
  indeterminateTaskName?: string;
  determinateTaskName?: string;
  stepFormatter: (steps: number) => string;
}

export function useUpdateProgress({
  taskId,
  indeterminateTaskName,
  determinateTaskName,
  stepFormatter,
}: UseUpdateProgressParams): [
  Dispatch<SetStateAction<number>>,
  Dispatch<SetStateAction<number>>
] {
  // Use context with type checking
  const { setProgress } = useContext(ProgressContext)!;
  const [stepsCompleted, setStepsCompleted] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  // Whenever the user adjusts totalSteps to a nonzero number, that means we are about to embark on a task with determinate progress.
  // We need to capture a timestamp when this process starts to enable calculation of ETA etc.
  useEffect(() => {
    if (totalSteps) {
      setStartTime(Date.now());
    }
  }, [totalSteps]);
  // Whenever the user adjusts stepsCompleted or totalSteps, we may need to adjust the output that goes to ProgressContext.
  // This effect handles that update
  useEffect(() => {
    console.log('totalSteps', totalSteps);
    console.log('stepsCompleted', stepsCompleted);
    if (totalSteps || stepsCompleted) {
      setProgress((progress) => {
        const newProgress = { ...progress };
        // React only does shallow comparisons. Therefore we need to treat the dict as immutable.
        // Make a copy so that react can pick up the change
        if (totalSteps) {
          const millis = startTime ? DateTime.now().toMillis() - startTime : 0;
          const remaining =
            (stepsCompleted > 0 ? (totalSteps * millis) / stepsCompleted : 0) -
            millis;

          newProgress[taskId] = {
            value: (stepsCompleted / totalSteps) * 100,
            detail: (
              <p>
                {determinateTaskName}
                <br />
                {`Done with ${stepFormatter(stepsCompleted)}/${stepFormatter(
                  totalSteps
                )}`}
                <br />
                {`Elapsed time: ${humanizeDuration(millis, {
                  units: ['d', 'h', 'm', 's'],
                  round: true,
                  largest: 2,
                })}`}
                <br />
                {`Estimated remaining time: ${humanizeDuration(remaining, {
                  units: ['d', 'h', 'm', 's'],
                  round: true,
                  largest: 1,
                })}`}
                <br />
                {`Average rate ${stepFormatter(
                  (stepsCompleted / millis) * 1000
                )}/s`}
                <br />
              </p>
            ),
          };
        } else {
          newProgress[taskId] = {
            detail: (
              <p>
                {indeterminateTaskName}
                <br />
                {`Loaded ${stepFormatter(stepsCompleted)} so far`}
              </p>
            ),
          };
        }
        // If the task has been completed we'll let the progress indicator hang around for 2 more seconds before removing it.
        if (stepsCompleted === totalSteps && totalSteps > 0) {
          setTimeout(() => {
            setProgress((progress) => {
              const updatedProgress = { ...progress };
              delete updatedProgress[taskId];
              return updatedProgress;
            });
          }, 2000);
        }

        return newProgress;
      });
    } else {
      // Clear the progress entry when there is no progress to show
      setProgress((progress) => {
        const updated = { ...progress };
        delete updated[taskId];
        return updated;
      });
    }
  }, [
    stepsCompleted,
    totalSteps,
    setProgress,
    taskId,
    determinateTaskName,
    indeterminateTaskName,
    startTime,
  ]);

  return [setStepsCompleted, setTotalSteps];
}
