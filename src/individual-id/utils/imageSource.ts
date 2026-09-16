import type { GlobalContextType } from '../../Context';
import type { ImageType } from '../../schemaTypes';
import {
  selectSourceKeyForImage,
  type ImageFileRow,
} from '../../chain-viewer/utils/imageSourceKey';

export function imageSourceQuery(
  client: GlobalContextType['client'],
  image: Pick<ImageType, 'id' | 'originalPath'>
) {
  return {
    queryKey: ['individual-id-image-source', image.id, image.originalPath],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const files: ImageFileRow[] = [];
      let nextToken: string | null | undefined;
      do {
        const result = await client.models.ImageFile.imagesByimageId(
          { imageId: image.id },
          { nextToken }
        );
        if (result.errors?.length) throw new Error(result.errors[0].message);
        files.push(...result.data);
        nextToken = result.nextToken;
      } while (nextToken);
      return selectSourceKeyForImage(files, image.originalPath);
    },
  };
}
