export type LaunchQueueOptions = {
  name: string;
  hidden: boolean;
  fifo: boolean;
};

export type TiledLaunchImage = {
  id: string;
  width: number;
  height: number;
};

export type TiledLaunchRequest = {
  name: string;
  description: string;
  horizontalTiles: number;
  verticalTiles: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  images: TiledLaunchImage[];
  locationCount: number;
  /** Optional: Reuse this existing location set instead of creating a new one */
  existingLocationSetId?: string;
  launchImageIds?: string[];
};
