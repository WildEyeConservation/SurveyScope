export const INFO_TAG_LEASE_MS = 5 * 60_000;
export const INFO_TAG_HEARTBEAT_MS = 60_000;
export const MAX_INFO_TAGS_PER_ANNOTATION = 40;

export type InfoTagLease = {
  sessionId: string;
  generation: number;
  expiresAt: number;
};
export type InfoTagSnapshot = {
  id: string;
  imageId: string;
  setId: string;
  projectId: string;
  categoryId: string;
  group: string | null;
  x: number;
  y: number;
  infoTaggedBy: string | null;
  infoTagRevision: number;
  tagIds: string[];
};
export type InfoTagRequest = {
  action: 'claim' | 'renew' | 'release' | 'save' | 'complete';
  queueId: string;
  imageId: string;
  sessionId: string;
  generation?: number;
  edit?: boolean;
  annotationId?: string;
  expectedRevision?: number;
  operationId?: string;
  tagIds?: string[];
  x?: number;
  y?: number;
};
export type InfoTagResponse = {
  status: 'claimed' | 'busy' | 'completed' | 'released' | 'saved';
  lease?: InfoTagLease;
  annotations?: InfoTagSnapshot[];
  targetIds?: string[];
  revision?: number;
};
