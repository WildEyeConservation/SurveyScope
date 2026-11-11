const SEPARATOR = '---';

export function parseImageEntry(entry: string) {
  const at = entry.indexOf(SEPARATOR);
  return {
    imageId: at < 0 ? entry : entry.slice(0, at),
    key: `images/${at < 0 ? '' : entry.slice(at + SEPARATOR.length)}`,
  };
}

export function continuationEvent<E extends { arguments: object }>(
  event: E,
  images: string[],
): E {
  return { ...event, arguments: { ...event.arguments, images } };
}
