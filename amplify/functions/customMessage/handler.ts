import type { CustomMessageTriggerHandler } from 'aws-lambda';
import { messageFor } from './templates';

export const handler: CustomMessageTriggerHandler = async (event) => {
  const message = messageFor(event.triggerSource, event.request);
  if (message) {
    event.response.emailSubject = message.subject;
    event.response.emailMessage = message.html;
  }
  return event;
};
