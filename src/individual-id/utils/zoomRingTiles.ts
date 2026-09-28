import { getTileBlob, onImageSessionChange } from '../../StorageLayer';
import { maskTile } from './maskTile';
import { createPreparedTileCache } from './preparedTileCache';

const cache = createPreparedTileCache(getTileBlob, maskTile);

// Prepared tiles are only valid for the user who was authorized to load them.
onImageSessionChange(cache.clear);

export const getZoomRingTile = cache.get;
