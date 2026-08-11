import useAckOnTimeout from './useAckOnTimeout';
import useCreateObservation from './useCreateObservation';
import type {
  AnnotationLocation,
  TaskAcknowledgement,
} from './annotationTypes';

interface UseTaskCompletionProps {
  location: AnnotationLocation;
  visible: boolean;
  next?: () => void;
  ack?: TaskAcknowledgement;
  isTest?: boolean;
  testPresetId?: string;
  testSetId?: string;
  queueId?: string;
  observationId?: string;
  observationSource?: string;
}

/*
Composes observation/test recording with the delayed queue acknowledgement.
The lower-level hooks stay separate; annotation screens use this single task
completion API so their ordering and timestamp semantics remain consistent.
*/
export default function useTaskCompletion({
  location,
  visible,
  next,
  ack,
  isTest,
  testPresetId,
  testSetId,
  queueId,
  observationId,
  observationSource,
}: UseTaskCompletionProps) {
  const observationAck = useCreateObservation({
    location,
    ack: ack ?? (() => {}),
    isTest,
    testPresetId,
    testSetId,
    queueId,
    observationId,
    observationSource,
  });

  return useAckOnTimeout({
    next,
    visible,
    ack: observationAck,
  });
}

export { WaitingOverlay } from './useAckOnTimeout';
