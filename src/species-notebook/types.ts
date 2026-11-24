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

export type {
  NotebookCrop,
  NotebookExample,
  NotebookExamples,
} from '../../shared/speciesNotebook';
