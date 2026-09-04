import type { Schema } from '../amplify/client-schema';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import outputs from '../../amplify_outputs.json';

type ModelType = keyof DataClient['models'];

export type BackendOutputs = Omit<typeof outputs, 'custom'> & {
  custom: typeof outputs.custom & {
    owlDDetectorTaskQueueUrl: string;
  };
};

export type CRUDhook<T extends ModelType> = {
  data: Schema[T]['type'][];
  create: (arg: Parameters<DataClient['models'][T]['create']>[0]) => string;
  update: (arg: Parameters<DataClient['models'][T]['update']>[0]) => void;
  delete: (arg: Parameters<DataClient['models'][T]['delete']>[0]) => void;
};

export type AnnotationsHook = CRUDhook<'Annotation'>;
