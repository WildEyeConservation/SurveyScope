import {
  type InfoTagLease,
  type InfoTagRequest,
  type InfoTagResponse,
} from '../shared/infoTagProtocol';

export async function requestInfoTagWork(
  client: unknown,
  request: InfoTagRequest
): Promise<InfoTagResponse> {
  const mutation = (client as { mutations?: Record<string, unknown> }).mutations
    ?.infoTagWork;
  if (typeof mutation !== 'function')
    throw new Error(
      'Info Tags needs the updated backend. Reload after deployment.'
    );
  const response = await mutation(
    { request: JSON.stringify(request) },
    { retry: false }
  );
  if (response.errors?.length)
    throw new Error(
      response.errors
        .map((error: { message: string }) => error.message)
        .join('; ')
    );
  const data =
    typeof response.data === 'string'
      ? JSON.parse(response.data)
      : response.data;
  if (
    !data ||
    !['claimed', 'busy', 'completed', 'released', 'saved'].includes(data.status)
  ) {
    throw new Error('The Info Tags server did not confirm the operation');
  }
  return data;
}

/** One browser visit owns one session. A new visit must reload its snapshot. */
export class InfoTagSession {
  lease?: InfoTagLease;
  closed = false;
  completed = false;
  paused = false;
  constructor(
    private call: (request: InfoTagRequest) => Promise<InfoTagResponse>,
    private base: Pick<InfoTagRequest, 'queueId' | 'imageId' | 'sessionId'>,
    private onLost: (message: string) => void = () => {}
  ) {}

  async claim(edit: boolean) {
    const response = await this.call({ ...this.base, action: 'claim', edit });
    if (response.status === 'claimed') {
      if (!response.lease || !response.annotations || !response.targetIds)
        throw new Error('Incomplete image claim');
      this.lease = response.lease;
      if (this.closed) await this.releaseLease();
    }
    return response;
  }

  private owned() {
    // Lease expiry is enforced by the server. Browser clocks can be skewed,
    // and a saved operation's receipt remains retryable after the lease expires.
    if (this.closed || this.paused || !this.lease) {
      throw new Error(
        'CLAIM_LOST: Image reservation unavailable. Reload before editing.'
      );
    }
    return { ...this.base, generation: this.lease.generation };
  }

  async renew() {
    if (this.closed || this.completed || this.paused) return;
    try {
      const response = await this.call({ ...this.owned(), action: 'renew' });
      if (!response.lease)
        throw new Error('Image reservation could not be renewed');
      if (!this.closed) this.lease = response.lease;
    } catch (error) {
      if (this.closed || this.completed) return;
      this.reportLost(error);
      throw error;
    }
  }

  async save(
    input: Pick<
      InfoTagRequest,
      'annotationId' | 'expectedRevision' | 'operationId' | 'tagIds' | 'x' | 'y'
    >
  ) {
    try {
      const response = await this.call({
        ...this.owned(),
        ...input,
        action: 'save',
      });
      if (
        response.status !== 'saved' ||
        !Number.isSafeInteger(response.revision)
      )
        throw new Error('Annotation save was not confirmed');
      return response.revision!;
    } catch (error) {
      this.reportLost(error);
      throw error;
    }
  }

  async complete() {
    if (this.completed) return;
    try {
      const response = await this.call({ ...this.owned(), action: 'complete' });
      if (response.status !== 'completed')
        throw new Error('Image completion was not confirmed');
      this.completed = true;
    } catch (error) {
      this.reportLost(error);
      throw error;
    }
  }

  private reportLost(error: unknown) {
    const message = (error as Error).message;
    if (/CLAIM_LOST|REVISION_CONFLICT/.test(message)) {
      this.paused = true;
      this.onLost(message);
    }
  }

  async close() {
    this.closed = true;
    await this.releaseLease();
  }

  private async releaseLease() {
    if (!this.lease) return;
    await this.call({
      ...this.base,
      generation: this.lease.generation,
      action: 'release',
    });
  }
}
