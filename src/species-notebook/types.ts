export type LabelRef = {
  projectId: string;
  name: string;
  color?: string | null;
};

export type SurveyCategory = {
  id: string;
  name: string;
  color?: string | null;
  shortcutKey?: string | null;
  annotationSetId: string;
  projectId: string;
};

export type GalleryItem = {
  id: string;
  x: number;
  y: number;
  imageId: string;
  setId: string;
  categoryId: string;
  projectId: string;
  objectId?: string | null;
  source?: string | null;
  reviewed: boolean;
  createdAt?: string | null;
  // Sampled from another survey in the organisation.
  borrowed?: boolean;
};
