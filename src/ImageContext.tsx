import {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { ImageContext } from './Context';
import { client } from './stores/appClient';
import {
  setCurrentAnnoCountAction,
  setCurrentTaskTagAction,
} from './stores/taskStore';
import type { AnnotationImage } from './annotationTypes';
import type { AnnotationsHook } from './Context';
import { inv, type Matrix } from 'mathjs';
import type { Schema } from './amplify/client-schema';
import { array2Matrix, makeTransform } from './utils';
import { useQueries, useQuery } from '@tanstack/react-query';

export function ImageContextFromHook({
  hook,
  image,
  children,
  taskTag,
  active = true,
  onAnnotationCreate,
}: {
  hook: AnnotationsHook;
  locationId?: string;
  image: AnnotationImage;
  children: React.ReactNode;
  taskTag?: string;
  /** Only the visible buffered workspace may update shared task metadata. */
  active?: boolean;
  /** Called synchronously once a locally-created annotation passes validation. */
  onAnnotationCreate?: () => void;
}) {
  const [annoCount, setAnnoCount] = useState(0);
  const lastAnnotationTimeRef = useRef<number>(0);
  const [startLoadingTimestamp, _] = useState<number>(Date.now());
  const [visibleTimestamp, setVisibleTimestamp] = useState<number | undefined>(
    undefined
  );
  const [fullyLoadedTimestamp, setFullyLoadedTimestamp] = useState<
    number | undefined
  >(undefined);
  const [zoom, setZoom] = useState(1);
  //testing - shared task metadata lives in taskStore so per-annotation updates
  // do not re-render UserContext consumers.
  const setCurrentAnnoCount = setCurrentAnnoCountAction;
  const setCurrentTaskTag = setCurrentTaskTagAction;

  // imageNeighboursQueries contains a list of queries that fetch the neighbours of each image.
  const prevNeighboursQuery = useQuery({
    queryKey: ['prevNeighbours', image.id],
    queryFn: () => {
      return client.models.ImageNeighbour.imageNeighboursByImage2key({
        image2Id: image.id,
      });
    },
    staleTime: Infinity, // Data will never become stale automatically
    gcTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  const prevNeighbours = useMemo(() => {
    //return a dictionary using the image1Id as the key and the transform as the value
    return prevNeighboursQuery.data?.data?.reduce((acc, n) => {
      if (n.homography) {
        const m = array2Matrix(n.homography) as unknown as Matrix;
        acc[n.image1Id] = {
          fwd: makeTransform(inv(m) as Matrix),
          bwd: makeTransform(m),
        };
      } else {
        acc[n.image1Id] = { fwd: undefined, bwd: undefined };
      }
      return acc;
    }, {} as Record<string, { fwd: ((c1: [number, number]) => [number, number]) | undefined; bwd: ((c1: [number, number]) => [number, number]) | undefined }>);
  }, [prevNeighboursQuery.data]);

  const nextNeighboursQuery = useQuery({
    queryKey: ['nextNeighbours', image.id],
    queryFn: () => {
      return client.models.ImageNeighbour.imageNeighboursByImage1key({
        image1Id: image.id,
      });
    },
    staleTime: Infinity, // Data will never become stale automatically
    gcTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  const nextNeighbours = useMemo(() => {
    //return a dictionary using the image2Id as the key and the transform as the value
    return nextNeighboursQuery.data?.data?.reduce((acc, n) => {
      if (n.homography) {
        const m = array2Matrix(n.homography) as unknown as Matrix;
        acc[n.image2Id] = {
          fwd: makeTransform(m),
          bwd: makeTransform(inv(m) as Matrix),
        };
      } else {
        acc[n.image2Id] = { fwd: undefined, bwd: undefined };
      }
      return acc;
    }, {} as Record<string, { fwd: ((c1: [number, number]) => [number, number]) | undefined; bwd: ((c1: [number, number]) => [number, number]) | undefined }>);
  }, [nextNeighboursQuery.data]);

  const imageMetaDataQueries = useQueries({
    queries: [
      ...Object.keys(prevNeighbours || {}),
      image.id,
      ...Object.keys(nextNeighbours || {}),
    ].map((n) => ({
      queryKey: ['imageMetaData', n],
      queryFn: () => {
        return client.models.Image.get({ id: n });
      },
      staleTime: Infinity, // Data will never become stale automatically
      gcTime: 1000 * 60 * 60, // Cache for 1 hour
    })),
  });

  const imageMetaData = useMemo(() => {
    return imageMetaDataQueries
      .filter((q) => q.isSuccess)
      .map((q) => q.data.data)
      .filter((d): d is Schema['Image']['type'] => d != null);
  }, [imageMetaDataQueries]);

  const prevImages = useMemo(() => {
    const prevImages = imageMetaData
      ?.filter((i) => Object.keys(prevNeighbours || {}).includes(i.id))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return prevImages?.map((i) => ({
      image: i,
      transform: prevNeighbours?.[i.id],
    }));
  }, [imageMetaData, prevNeighbours]);

  const nextImages = useMemo(() => {
    const nextImages = imageMetaData
      ?.filter((i) => Object.keys(nextNeighbours || {}).includes(i.id))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return nextImages?.map((i) => ({
      image: i,
      transform: nextNeighbours?.[i.id],
    }));
  }, [imageMetaData, nextNeighbours]);

  const queriesComplete =
    imageMetaDataQueries.every((q) => q.isSuccess) &&
    prevNeighboursQuery.isSuccess &&
    nextNeighboursQuery.isSuccess;

  useEffect(() => {
    if (active) setCurrentTaskTag(taskTag ?? '');
  }, [active, setCurrentTaskTag, taskTag]);

  const create = useCallback(
    (annotation: Schema['Annotation']['type']) => {
      // Reject annotations at exactly (0, 0) — these are phantom clicks/hotkeys
      if (annotation.x === 0 && annotation.y === 0) return;
      // Debounce: ignore annotations placed within 100ms of the last one
      const now = Date.now();
      if (now - lastAnnotationTimeRef.current < 300) return;
      lastAnnotationTimeRef.current = now;
      // Reject if an annotation already exists at the exact same position
      if (hook.data.some((a) => a.x === annotation.x && a.y === annotation.y))
        return;
      //Check if this annotation maps to the interior of any of the previous images
      const insidePreviousImage = prevImages.reduce((acc, im) => {
        if (!im?.transform?.fwd) return acc;
        const transformedPoint = im.transform.fwd([annotation.x, annotation.y]);
        if (
          transformedPoint[0] >= 0 &&
          transformedPoint[0] <= im.image.width &&
          transformedPoint[1] >= 0 &&
          transformedPoint[1] <= im.image.height
        ) {
          return true;
        }
        return acc;
      }, false);
      // Create an objectID only if this is the primary observation (first time this object was observed)
      if (!insidePreviousImage) {
        annotation.id = crypto.randomUUID();
        annotation.objectId = annotation.id;
      }
      // Notify the task workspace before starting the mutation. A visible-time
      // revalidation may be querying the same annotations concurrently and
      // must not mistake this local annotation for pre-existing work.
      onAnnotationCreate?.();
      setAnnoCount((old) => old + 1);

      setCurrentAnnoCount((old) => {
        const newCount = { ...old };
        newCount[annotation.categoryId] = (
          newCount[annotation.categoryId] || []
        ).concat([{ x: annotation.x, y: annotation.y }]);
        return newCount;
      });
      return hook.create(annotation);
    },
    [hook.create, hook.data, onAnnotationCreate, setAnnoCount, zoom, taskTag]
  );

  const update = useCallback(
    (annotation: Schema['Annotation']['type']) => {
      const oldAnnotation = hook.data.find((a) => a.id === annotation.id);

      setCurrentAnnoCount((old) => {
        const newCount = { ...old };
        newCount[oldAnnotation!.categoryId] = (
          newCount[oldAnnotation!.categoryId] || []
        ).filter((a) => a.x !== oldAnnotation!.x && a.y !== oldAnnotation!.y);
        newCount[annotation.categoryId] = (
          newCount[annotation.categoryId] || []
        ).concat([
          {
            x: annotation.x || oldAnnotation!.x,
            y: annotation.y || oldAnnotation!.y,
          },
        ]);
        return newCount;
      });
      const {
        shadow,
        proposedObjectId,
        image,
        object,
        project,
        set,
        createdAt,
        updatedAt,
        owner,
        category,
        id,
        ...annoStripped
      } = annotation;
      if (shadow) {
        //Check if this annotation maps to the interior of any of the previous images
        const insidePreviousImage = prevImages.reduce((acc, im) => {
          if (!im?.transform?.fwd) return acc;
          const transformedPoint = im.transform.fwd([
            annotation.x,
            annotation.y,
          ]);
          if (
            transformedPoint[0] >= 0 &&
            transformedPoint[0] <= im.image.width &&
            transformedPoint[1] >= 0 &&
            transformedPoint[1] <= im.image.height
          ) {
            return true;
          }
          return acc;
        }, false);
        if (!insidePreviousImage) {
          return hook.create({ ...annoStripped });
        } else {
          return hook.create({
            ...annoStripped,
            objectId: annoStripped.objectId || proposedObjectId,
          });
        }
      } else {
        return hook.update({
          ...annoStripped,
          id,
          objectId: annoStripped.objectId || proposedObjectId,
        });
      }
    },
    [hook.create, setAnnoCount, zoom, taskTag]
  );

  const _delete = useCallback(
    (annotation: Schema['Annotation']['type']) => {
      setAnnoCount((old) => old - 1);
      setCurrentAnnoCount((old) => {
        const newCount = { ...old };
        newCount[annotation.categoryId] = (
          newCount[annotation.categoryId] || []
        ).filter((a) => a.x !== annotation.x && a.y !== annotation.y);
        return newCount;
      });
      return hook.delete(annotation);
    },
    [hook.delete, setAnnoCount, setCurrentAnnoCount]
  );

  return (
    <ImageContext.Provider
      value={{
        annotationsHook: {
          ...hook,
          create: create as AnnotationsHook['create'],
          update: update as AnnotationsHook['update'],
          delete: _delete as AnnotationsHook['delete'],
        },
        annoCount,
        startLoadingTimestamp,
        visibleTimestamp,
        fullyLoadedTimestamp,
        setVisibleTimestamp,
        setFullyLoadedTimestamp,
        zoom,
        setZoom,
        prevImages,
        nextImages,
        queriesComplete,
      }}
    >
      {children}
    </ImageContext.Provider>
  );
}
