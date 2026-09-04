import { useContext, useMemo } from 'react';
import { getUrl } from 'aws-amplify/storage';
import { ImageContext } from './imageContext';
import { useSession } from './session';
import type { AnnotationImage, AnnotationLocation } from './annotationTypes';
import { useProjectMemberships } from './data/projectSets';
import { useCurrentProject, useProjectId } from './data/projectScope';

/** A single entry in the image-level context menu, rendered as a React
 * overlay by the MapLibre viewers. */
export interface ImageMenuItem {
  text: string;
  disabled?: boolean;
  index?: number;
  callback?: () => void;
}

interface UseImageMenuItemsProps {
  image: AnnotationImage;
  location?: AnnotationLocation;
  sourceKey?: string;
  isTest?: boolean;
  stats?: Record<string, number>;
}

/*
Builds the context-menu items shown when right-clicking the image itself
(as opposed to an annotation): copy/download the source file, navigate or
register against neighbouring images, permalinks, stats and GPS data.
*/
export default function useImageMenuItems({
  image,
  location,
  sourceKey,
  isTest,
  stats,
}: UseImageMenuItemsProps): ImageMenuItem[] {
  const { prevImages, nextImages } = useContext(ImageContext)!;
  const project = useCurrentProject();
  const projectId = useProjectId();
  const { data: projectMemberships } = useProjectMemberships(projectId);
  const { user } = useSession();

  const belongsToCurrentProject = projectMemberships?.find(
    (pm) => pm.userId == user.userId && pm.projectId == project.id
  );

  // Legacy projects stored the full key; newer ones prefix org/project ids,
  // which we hide from the user.
  const displaySource = useMemo(() => {
    if (!sourceKey) return undefined;
    const tags = project?.tags;
    if (Array.isArray(tags) && tags.includes('legacy')) return sourceKey;
    const prefixParts = [project?.organizationId, project?.id].filter(Boolean);
    if (!prefixParts.length) return sourceKey;
    const prefix = `${prefixParts.join('/')}/`;
    return sourceKey.startsWith(prefix)
      ? sourceKey.slice(prefix.length)
      : sourceKey;
  }, [sourceKey, project?.tags, project?.organizationId, project?.id]);

  return useMemo(() => {
    const items: ImageMenuItem[] = [];
    const hasPrevNeighbour = Boolean(prevImages?.length);
    const hasNextNeighbour = Boolean(nextImages?.length);

    if (sourceKey) {
      items.push(
        {
          text: displaySource ?? sourceKey,
          index: 0,
          callback: () => {
            navigator.clipboard
              .writeText(displaySource ?? sourceKey ?? '')
              .catch((err) =>
                console.error('Failed to copy to clipboard:', err)
              );
          },
        },
        {
          text: 'Download this image',
          callback: () => {
            getUrl({
              path: 'images/' + sourceKey,
              options: {
                bucket: 'inputs',
                validateObjectExistence: true,
                expiresIn: 300,
              },
            }).then(async (url) => {
              navigator.clipboard.writeText(url.url.toString());

              // Fetch the image first
              const response = await fetch(url.url);
              const blob = await response.blob();

              // Create object URL from blob
              const objectUrl = window.URL.createObjectURL(blob);

              // Setup download link
              const a = document.createElement('a');
              a.href = objectUrl;
              const filenameSource = displaySource ?? sourceKey;
              a.download = filenameSource.split('/').pop() || 'image.jpg';

              // Trigger download
              document.body.appendChild(a);
              a.click();

              // Cleanup
              document.body.removeChild(a);
              window.URL.revokeObjectURL(objectUrl);
            });
          },
        }
      );

      if (!isTest) {
        items.push(
          {
            text: `Open previous image`,
            disabled: !hasPrevNeighbour,
            callback: async () => {
              if (!hasPrevNeighbour) return;
              const newUrl = window.location.href.replace(
                /^(.*?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).*$/,
                `$1/image/${prevImages?.[0]?.image?.id}/${location?.annotationSetId}`
              );
              window.open(newUrl, '_blank');
            },
          },
          {
            text: `Open next image`,
            disabled: !hasNextNeighbour,
            callback: async () => {
              if (!hasNextNeighbour) return;
              const newUrl = window.location.href.replace(
                /^(.*?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).*$/,
                `$1/image/${nextImages?.[0]?.image?.id}/${location?.annotationSetId}`
              );
              window.open(newUrl, '_blank');
            },
          },
          {
            text: 'Display Image Statistics',
            callback: () => {
              alert(JSON.stringify(stats));
            },
          },
          {
            text: 'Copy permalink to this location',
            disabled: !location?.id,
            callback: () => {
              const url = window.location.href;
              // now replace the last part of the url with the location id
              const newUrl = url.replace(
                /\/[^/]+\/?$/,
                `/location/${location?.id}/${location?.annotationSetId}`
              );
              navigator.clipboard
                .writeText(newUrl)
                .catch((err) =>
                  console.error('Failed to copy to clipboard:', err)
                );
            },
          },
          {
            text: 'Copy permalink to this image',
            callback: () => {
              const url = window.location.href;
              // now replace the last part of the url with the location id
              const newUrl = url.replace(
                /\/[^/]+\/?$/,
                `/image/${image.id}/${location?.annotationSetId}`
              );
              navigator.clipboard
                .writeText(newUrl)
                .catch((err) =>
                  console.error('Failed to copy to clipboard:', err)
                );
            },
          },
          {
            text: 'Copy GPS data',
            disabled:
              !belongsToCurrentProject?.isAdmin ||
              (!image.latitude && !image.longitude),
            callback: () => {
              const gpsData: string[] = [];

              if (image.latitude != null && image.longitude != null) {
                gpsData.push(`Latitude: ${image.latitude}`);
                gpsData.push(`Longitude: ${image.longitude}`);
              }

              if (image.altitude_wgs84 != null) {
                gpsData.push(`Altitude (WGS84): ${image.altitude_wgs84}`);
              }

              if (image.altitude_egm96 != null) {
                gpsData.push(`Altitude (EGM96): ${image.altitude_egm96}`);
              }

              if (image.altitude_agl != null) {
                gpsData.push(`Altitude (AGL): ${image.altitude_agl}`);
              }

              const gpsText =
                gpsData.length > 0
                  ? gpsData.join('\n')
                  : 'No GPS data available';

              navigator.clipboard
                .writeText(gpsText)
                .catch((err) =>
                  console.error('Failed to copy to clipboard:', err)
                );
            },
          }
        );
      }
    }

    return items;
  }, [
    isTest,
    belongsToCurrentProject,
    sourceKey,
    displaySource,
    location?.id,
    image.id,
    image.latitude,
    image.longitude,
    image.altitude_wgs84,
    image.altitude_egm96,
    image.altitude_agl,
    stats,
    location?.annotationSetId,
    prevImages,
    nextImages,
  ]);
}
