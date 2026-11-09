type Located = { id: string; latitude: number; longitude: number };

// Spread images sharing a coordinate around a small circle (~5m radius).
export function spreadOverlapping(
  images: Located[],
): Record<string, { latitude: number; longitude: number }> {
  const byCoordKey: Record<string, Located[]> = {};
  const adjusted: Record<string, { latitude: number; longitude: number }> = {};
  for (const img of images) {
    const key = `${img.latitude},${img.longitude}`;
    (byCoordKey[key] = byCoordKey[key] || []).push(img);
  }
  for (const group of Object.values(byCoordKey)) {
    if (group.length === 1) {
      const img = group[0];
      adjusted[img.id] = { latitude: img.latitude, longitude: img.longitude };
      continue;
    }
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    group.forEach((img, index) => {
      const latRad = (img.latitude * Math.PI) / 180;
      const radiusDeg = 0.00005;
      const angle = (2 * Math.PI * index) / group.length;
      adjusted[img.id] = {
        latitude: img.latitude + radiusDeg * Math.sin(angle),
        longitude:
          img.longitude +
          (radiusDeg * Math.cos(angle)) / Math.max(Math.cos(latRad), 1e-6),
      };
    });
  }
  return adjusted;
}
