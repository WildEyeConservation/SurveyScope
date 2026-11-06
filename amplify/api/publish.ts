import { Sha256 } from '@aws-crypto/sha256-js';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { channelsFor } from '../../shared/dataChannels';

interface StreamRecord {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  eventSourceARN: string;
  dynamodb: {
    NewImage?: Record<string, AttributeValue>;
    OldImage?: Record<string, AttributeValue>;
  };
}

const MAX_EVENT_BYTES = 200_000;

const signer = new SignatureV4({
  service: 'appsync',
  region: process.env.AWS_REGION!,
  sha256: Sha256,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});

async function post(channel: string, events: string[]) {
  const host = process.env.EVENTS_HTTP_DOMAIN!;
  const request = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname: host,
    path: '/event',
    headers: { host, 'content-type': 'application/json' },
    body: JSON.stringify({ channel, events }),
  });
  const signed = await signer.sign(request);
  const response = await fetch(`https://${host}/event`, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body: request.body as string,
  });
  if (!response.ok) {
    throw new Error(
      `Publish to ${channel} failed: ${response.status} ${await response.text()}`,
    );
  }
}

function modelOf(record: StreamRecord) {
  const table = record.eventSourceARN.split(':table/')[1]?.split('/')[0] ?? '';
  return table.split('-')[0];
}

export const handler = async (event: { Records: StreamRecord[] }) => {
  const byChannel = new Map<string, string[]>();
  const add = (
    channel: string,
    type: string,
    item: Record<string, unknown>,
  ) => {
    let payload = JSON.stringify({ type, item });
    if (payload.length > MAX_EVENT_BYTES)
      payload = JSON.stringify({ type, item: { id: item.id } });
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), payload]);
  };
  for (const record of event.Records) {
    const model = modelOf(record);
    const before = record.dynamodb.OldImage
      ? unmarshall(record.dynamodb.OldImage)
      : undefined;
    const after = record.dynamodb.NewImage
      ? unmarshall(record.dynamodb.NewImage)
      : undefined;
    const afterChannels = after ? channelsFor(model, after) : [];
    if (before) {
      for (const channel of channelsFor(model, before)) {
        if (!afterChannels.includes(channel)) add(channel, 'delete', before);
      }
    }
    for (const channel of afterChannels) {
      add(channel, record.eventName === 'INSERT' ? 'create' : 'update', after!);
    }
  }
  const posts: Promise<void>[] = [];
  for (const [channel, events] of byChannel) {
    for (let i = 0; i < events.length; i += 5)
      posts.push(post(channel, events.slice(i, i + 5)));
  }
  await Promise.all(posts);
};
