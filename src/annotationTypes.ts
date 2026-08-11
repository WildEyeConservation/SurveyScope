import type { ImageType } from './schemaTypes';

export type TaskAcknowledgement = (
  submittedAt?: number
) => void | Promise<void>;

export type AnnotationImage = Pick<ImageType, 'id' | 'width' | 'height'> &
  Partial<
    Pick<
      ImageType,
      | 'timestamp'
      | 'latitude'
      | 'longitude'
      | 'altitude_wgs84'
      | 'altitude_egm96'
      | 'altitude_agl'
    >
  >;

/** The location shape required by the annotation workspace. */
export interface AnnotationLocation {
  id?: string;
  annotationSetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number | null;
  image: AnnotationImage;
}

export interface AnnotationWorkspaceProps {
  location: AnnotationLocation;
  visible: boolean;
  next?: () => void;
  prev?: () => void;
  ack?: TaskAcknowledgement;
  revalidate?: () => Promise<boolean>;
  allowOutside?: boolean;
  zoom?: number;
  viewBoundsScale?: number;
  hideNavButtons?: boolean;
  hideZoomSetting?: boolean;
  testPresetId?: string;
  isTest?: boolean;
  queueId?: string;
  /** Stable identifier for retry-safe Observation creation. */
  observationId?: string;
  taskTag?: string;
}

/** A fully hydrated task returned by the annotation queue source. */
export type AnnotationTaskPayload = Omit<
  AnnotationWorkspaceProps,
  'visible' | 'next' | 'prev'
> & {
  ack: TaskAcknowledgement;
};
