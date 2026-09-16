import { getTileBlob } from '../../StorageLayer';
import { maskTile } from './maskTile';
import { createPreparedTileCache } from './preparedTileCache';

export const getZoomRingTile = createPreparedTileCache(getTileBlob, maskTile);
