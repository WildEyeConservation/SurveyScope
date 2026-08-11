import { useEffect } from 'react';
import { useIsMutating } from '@tanstack/react-query';

/*
Warns before the page is unloaded while writes are still in flight.

An annotation write can legitimately be outstanding for a while: every client
call is funnelled through pLimit(15) in limitedClient, and transient failures
are retried four times with exponential backoff. The optimistic marker is on
screen for that whole period, so closing the tab or navigating away looks
harmless while actually discarding work the user believes is already saved.

Returns the number of in-flight writes so callers can surface it if they want.
*/
export default function useUnsavedWorkGuard() {
  const pendingWrites = useIsMutating();

  useEffect(() => {
    if (pendingWrites === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only raise the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingWrites]);

  return pendingWrites;
}
