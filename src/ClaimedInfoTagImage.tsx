import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Alert, Button } from 'react-bootstrap';
import { GlobalContext } from './Context';
import { useNavigate } from 'react-router-dom';
import InfoTagAnnotation from './InfoTagAnnotation';
import { InfoTagSession, requestInfoTagWork } from './infoTagWork';
import {
  INFO_TAG_HEARTBEAT_MS,
  type InfoTagResponse,
} from '../shared/infoTagProtocol';

type Props = Omit<
  ComponentProps<typeof InfoTagAnnotation>,
  'session' | 'snapshot' | 'disabled'
> & {
  defer: () => Promise<void>;
};

export default function ClaimedInfoTagImage(props: Props) {
  const { visible, next } = props;
  const { client } = useContext(GlobalContext)!;
  const navigate = useNavigate();
  const [ready, setReady] = useState<{
    session: InfoTagSession;
    snapshot: InfoTagResponse;
  }>();
  const [error, setError] = useState<string>();
  const [advance, setAdvance] = useState(false);
  const [reload, setReload] = useState(0);
  const [visit, setVisit] = useState(0);
  const visited = useRef(false);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!props.visible) return;
    let cancelled = false;
    let renewing = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const session = new InfoTagSession(
      (request) => requestInfoTagWork(client, request),
      {
        queueId: props.queueId,
        imageId: props.imageId,
        sessionId: crypto.randomUUID(),
      },
      (message) => {
        if (!cancelled) setError(message);
      }
    );
    setReady(undefined);
    if (visited.current) setVisit((value) => value + 1);
    setError(undefined);
    setAdvance(false);
    session
      .claim(visited.current)
      .then(async (snapshot) => {
        if (cancelled) return;
        if (snapshot.status === 'busy') {
          await callbacks.current.defer();
          if (!cancelled) setAdvance(true);
          return;
        }
        if (snapshot.status === 'completed') {
          await callbacks.current.ack?.();
          if (!cancelled) setAdvance(true);
          return;
        }
        visited.current = true;
        setReady({ session, snapshot });
        timer = setInterval(async () => {
          if (renewing) return;
          renewing = true;
          try {
            await session.renew();
          } catch (failure) {
            // Definite ownership loss is reported by the session's onLost callback.
            // Network/service failures leave editing available; the next heartbeat
            // retries and every save still checks ownership on the server.
            if (!cancelled && !session.paused) {
              console.warn('Info Tags heartbeat failed; will retry', failure);
            }
          } finally {
            renewing = false;
          }
        }, INFO_TAG_HEARTBEAT_MS);
      })
      .catch((failure) => {
        if (!cancelled) setError((failure as Error).message);
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      void session
        .close()
        .catch((failure) =>
          console.warn('Info Tags claim release failed', failure)
        );
    };
  }, [client, props.imageId, props.queueId, props.visible, reload]);

  useEffect(() => {
    if (!advance || !visible) return;
    if (next) {
      next();
      return;
    }
    const timer = setTimeout(() => navigate('/jobs'), 60_000);
    return () => clearTimeout(timer);
  }, [advance, navigate, visible, next]);

  return (
    <div className='d-flex flex-column w-100 h-100'>
      {error && (
        <Alert variant='warning'>
          {error}
          <Button
            className='ms-2'
            size='sm'
            onClick={async () => {
              await ready?.session.close().catch(() => undefined);
              setReload((value) => value + 1);
            }}
          >
            Reload image
          </Button>
          <Button className='ms-2' size='sm' onClick={() => navigate('/jobs')}>
            Exit
          </Button>
        </Alert>
      )}
      {!ready && !error && props.visible && (
        <div className='text-muted p-2'>
          {advance ? 'Fetching another image…' : 'Reserving image…'}
        </div>
      )}
      {!advance && (
        <InfoTagAnnotation
          {...props}
          key={reload + ':' + visit}
          session={ready?.session}
          snapshot={ready?.snapshot}
          disabled={!ready || Boolean(error) || !props.visible}
        />
      )}
    </div>
  );
}
