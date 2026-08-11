import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface UseAckOnTimeoutProps {
  next?: () => void;
  visible: boolean;
  /** Called to ack the task. Receives the timestamp at which the user submitted (paged past), since the call itself is deliberately delayed. */
  ack: (submittedAt?: number) => void | Promise<void>;
}

export interface UseAckOnTimeoutResult {
  onNext: (() => void) | undefined;
  waiting: boolean;
  waitingMessage: string;
}

// How long to wait for new messages before considering the job complete (in ms)
const QUEUE_WAIT_TIMEOUT = 60000; // 60 seconds

/* This hook implements the following functionality:
- It will wait until the image has been paged past
- It will then start a configurable timeout and monitor the visibility of the component it is attached to 
  (the component is expected to be invisible at this point as it has been paged past)
- If the component becomes visible again before the timeout expires (typically because the user has paged back to it), the timer is canceled and we 
  wait to be paged past again
- If the timer expires, the ack function is called

When the queue is empty (next is undefined):
- Instead of immediately alerting, we enter a "waiting" state with a loading indicator
- We wait up to 60 seconds for new messages to arrive
- If new messages arrive (next becomes defined), we continue normally
- If the timeout expires, we alert the user and navigate back to surveys

Obviously, the hook needs access to an attribute indicating whether the component is visible and to a handle to the ack function (so it can call it).
We also need to hook into the onNext function, we do this by taking onNext as an input and yielding an instrumented version of onNext as output
*/

export default function useAckOnTimeout({
  next,
  visible,
  ack,
}: UseAckOnTimeoutProps): UseAckOnTimeoutResult {
  const navigate = useNavigate();
  const [timer, setTimer] = useState<number | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [wasHidden, setWasHidden] = useState<boolean>(false);

  // Waiting state for when queue is temporarily empty
  const [waiting, setWaiting] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState('');
  const waitingTimerRef = useRef<number | undefined>(undefined);
  const countdownRef = useRef<number | undefined>(undefined);
  const [secondsRemaining, setSecondsRemaining] = useState(QUEUE_WAIT_TIMEOUT / 1000);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  // Handle when next becomes available while waiting
  useEffect(() => {
    if (next && waiting) {
      // Clear the waiting timeout
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = undefined;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = undefined;
      }
      setWaiting(false);
      setWaitingMessage('');
      setSecondsRemaining(QUEUE_WAIT_TIMEOUT / 1000);
    }
  }, [next, waiting]);

  const onNext = useCallback(() => {
    setWasHidden(false);
    // Capture the submit time now — the ack fires 2s later (grace period for
    // paging back), and observation timing must not include that delay.
    const submittedAt = Date.now();
    setTimer(
      window.setTimeout(() => {
        void Promise.resolve(ack(submittedAt)).catch((error) => {
          // SQS acknowledgement follows Observation persistence, so a failed
          // completion leaves the task available for a safe retry.
          console.error('Task completion failed; the task will be retried', error);
        });
      }, 2000)
    );
    if (next) {
      next();
    } else {
      // Queue is empty: wait for new messages. Guard against repeated next
      // clicks stacking up multiple timers.
      if (waiting || waitingTimerRef.current) {
        return;
      }

      setWaiting(true);
      setSecondsRemaining(QUEUE_WAIT_TIMEOUT / 1000);
      setWaitingMessage('Waiting for new work to be loaded...');

      // Start countdown display
      countdownRef.current = window.setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) {
              clearInterval(countdownRef.current);
              countdownRef.current = undefined;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Set timeout for job completion
      waitingTimerRef.current = window.setTimeout(() => {
        setWaiting(false);
        waitingTimerRef.current = undefined;
        setDone(true);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = undefined;
        }
        alert(
          'No new work was loaded. The job appears to be complete. Thank you for your contribution!'
        );
        navigate('/surveys');
      }, QUEUE_WAIT_TIMEOUT);
    }
  }, [next, ack, navigate, waiting]);

  useEffect(() => {
    // If the component was hidden but is now visible and there is a timer running, cancel the timer.
    // This is intended to cancel timers in the event where the user paged back to the item after initially paging past it.
    // However, just checking for visible && timer is vulnerable to race conditions (where we have paged past, and set the timer, but
    // the rest of the system hasn't updated the visibility state yet). So we need to check for a rising edge on visible, thus wasHidden && visible && timer && next.

    if (wasHidden && visible && timer && next) {
      // Read the number of milliseconds left on the timer
      clearTimeout(timer); // Cancel the timer
      setTimer(undefined);
      setWasHidden(false);
    } else if (wasHidden && visible && waiting) {
      // User navigated back while waiting for new work - cancel the waiting timer
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = undefined;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = undefined;
      }
      setWaiting(false);
      setWaitingMessage('');
      setSecondsRemaining(QUEUE_WAIT_TIMEOUT / 1000);
      setWasHidden(false);
    } else if (!wasHidden && !visible) {
      setWasHidden(true);
    }
  }, [visible, timer, next, wasHidden, waiting]);

  useEffect(() => {
    // If the provided onNext has changed, new work may have been loaded to the queue. In this case we need to clear the done flag again
    if (next && done) {
      setDone(false);
    }
  }, [next, done]);

  // Build waiting message with countdown
  const displayMessage = waiting
    ? `${waitingMessage} (${secondsRemaining}s remaining)`
    : '';

  return {
    onNext: done ? undefined : onNext,
    waiting,
    waitingMessage: displayMessage,
  };
}

// Subtle loading overlay component for when waiting for new work
export function WaitingOverlay({ message }: { message: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: '12px',
        padding: '20px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(255, 255, 255, 0.2)',
          borderTopColor: '#fff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <div
        style={{
          color: '#fff',
          fontSize: '14px',
          textAlign: 'center',
          maxWidth: '280px',
        }}
      >
        {message}
      </div>
    </div>
  );
}
