import type { UploadBackend, UploadClient } from './types';

// Detector dispatch settings by model.
export interface DetectorArgs {
  projectId: string;
  images: string[];
  setId: string;
  bucket: string;
  queueUrl: string;
}

export interface DetectorConfig {
  /** LocationSet name is `${projectId}${setSuffix}`. */
  setSuffix: string;
  /** ImageProcessedBy source used to skip already-processed images. */
  processedSource: string;
  /** Project status set after dispatch. */
  nextStatus: string;
  queueUrl: (backend: UploadBackend) => string;
  dispatch: (client: UploadClient, args: DetectorArgs) => void;
}

export const DETECTOR_DISPATCH: Record<string, DetectorConfig> = {
  scoutbot: {
    setSuffix: '_scoutbot',
    processedSource: 'scoutbotv3',
    nextStatus: 'processing-scoutbot',
    queueUrl: (backend) => backend.custom.scoutbotTaskQueueUrl,
    dispatch: (client, args) =>
      void client.mutations.runScoutbot(args, { retry: false }),
  },
  'elephant-detection-nadir': {
    setSuffix: '_elephant-detection-nadir',
    processedSource: 'heatmap',
    nextStatus: 'processing-pointFinder',
    queueUrl: (backend) => backend.custom.elephantDetectorTaskQueueUrl,
    dispatch: (client, args) =>
      void client.mutations.runElephantDetector(args, { retry: false }),
  },
  mad: {
    setSuffix: '_mad',
    processedSource: 'mad-v2',
    nextStatus: 'processing-mad',
    queueUrl: (backend) => backend.custom.madDetectorTaskQueueUrl,
    dispatch: (client, args) =>
      void client.mutations.runMadDetector(args, { retry: false }),
  },
  'owl-d': {
    setSuffix: '_owl-d',
    processedSource: 'owl-d',
    nextStatus: 'processing-owl-d',
    queueUrl: (backend) => backend.custom.owlDDetectorTaskQueueUrl,
    dispatch: (client, args) =>
      void client.mutations.runOwlDDetector(args, { retry: false }),
  },
  // No longer selectable in the uploader. Retained so uploads started with
  // Stormfly before its removal still dispatch a detector when resumed.
  'stormfly-testing': {
    setSuffix: '_stormfly-testing',
    processedSource: 'stormfly-testing',
    nextStatus: 'processing-stormfly-testing',
    queueUrl: (backend) => backend.custom.stormflyDetectorTaskQueueUrl,
    dispatch: (client, args) =>
      void client.mutations.runStormflyDetector(args, { retry: false }),
  },
};

export const DEFAULT_MODEL = 'owl-d';

export function modelForProcessedSources(
  sources: Iterable<string>
): string | null {
  const models = new Set<string>();
  for (const source of sources) {
    const model = Object.keys(DETECTOR_DISPATCH).find(
      (key) => DETECTOR_DISPATCH[key].processedSource === source
    );
    if (model) models.add(model);
  }
  return models.size === 1 ? [...models][0] : null;
}
