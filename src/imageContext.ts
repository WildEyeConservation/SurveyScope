import { createContext } from 'react';
import type { Schema } from './amplify/client-schema';
import type { AnnotationsHook } from './data/types';

type NeighbourTransform = {
  fwd: ((c1: [number, number]) => [number, number]) | undefined;
  bwd: ((c1: [number, number]) => [number, number]) | undefined;
} | undefined;

export interface ImageContextType {
  annotationsHook: AnnotationsHook;
  annoCount: number;
  startLoadingTimestamp: number;
  visibleTimestamp: number | undefined;
  fullyLoadedTimestamp: number | undefined;
  setVisibleTimestamp: React.Dispatch<React.SetStateAction<number | undefined>>;
  setFullyLoadedTimestamp: React.Dispatch<React.SetStateAction<number | undefined>>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  prevImages:
    | {
        image: Schema['Image']['type'];
        transform: NeighbourTransform;
      }[]
    | undefined;
  nextImages:
    | {
        image: Schema['Image']['type'];
        transform: NeighbourTransform;
      }[]
    | undefined;
  queriesComplete: boolean;
}

export const ImageContext = createContext<ImageContextType | undefined>(
  undefined
);
