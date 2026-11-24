import type { TestContextAnnotation } from './api/tasks';
import type { ImageType } from './schemaTypes';

export type TaskAcknowledgement = (
  submittedAt?: number,
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
      | 'boundaryStatus'
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
  source?: string | null;
  image: AnnotationImage;
  /** A test grown to the job's tile size; its key is recounted in this box. */
  testBoxGrown?: boolean;
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
  testLeaseId?: string;
  testContext?: TestContextAnnotation[];
  queueId?: string;
  /** Stable identifier for retry-safe Observation creation. */
  observationId?: string;
  taskTag?: string;
  /** Set from the task's own queue; unset outside queue work. */
  isFalseNegatives?: boolean;
  /** Image only: no header, side legend or frame, for viewers embedded in a page. */
  embedded?: boolean;
  /** False leaves adding marks to the category hotkeys. */
  clickToCreate?: boolean;
  /** Map bearing in degrees; rotating the map reports the new one. */
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
  otherViews?: OtherViewsHandler;
  neighbourOverlaps?: NeighbourImageLookup;
  focus?: ViewerFocus;
}

export type OtherViewsTarget = {
  id: string;
  imageId: string;
  objectId: string | null;
  categoryId: string;
  x: number;
  y: number;
};

export type OtherViewsHandler = {
  describe: (target: OtherViewsTarget) => { label: string; linked: boolean };
  open: (target: OtherViewsTarget) => void;
};

export type NeighbourImageInfo = {
  width?: number | null;
  height?: number | null;
  originalPath?: string | null;
  timestamp?: number | null;
};

export type NeighbourImageLookup = (
  imageId: string,
) => NeighbourImageInfo | undefined;

// If zoom is omitted, frame the point's surroundings.
export type ViewerFocus = { x: number; y: number; seq: number; zoom?: number };

/** A fully hydrated task returned by the annotation queue source. */
export type AnnotationTaskPayload = Omit<
  AnnotationWorkspaceProps,
  | 'visible'
  | 'next'
  | 'prev'
  | 'bearing'
  | 'onBearingChange'
  | 'otherViews'
  | 'focus'
> & {
  ack: TaskAcknowledgement;
};
