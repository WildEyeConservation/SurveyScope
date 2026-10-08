import * as turf from '@turf/turf';

// finds the average transect heading and returns the orthogonal baseline heading
export function getBaselineBearing(
  transectIds: number[],
  segmentedImages: Array<{
    longitude: number;
    latitude: number;
    transectId: number;
  }>
): number {
  // average transect heading
  const headings: number[] = [];
  transectIds.forEach((id) => {
    const imgs = segmentedImages.filter((si) => si.transectId === id);
    if (imgs.length >= 2) {
      const start = imgs[0];
      const end = imgs[imgs.length - 1];
      headings.push(
        turf.bearing(
          [start.longitude, start.latitude],
          [end.longitude, end.latitude]
        )
      );
    }
  });

  // average the doubled angles so lines flown in opposite directions agree
  let avgHeading = 0;
  if (headings.length) {
    let sumX = 0,
      sumY = 0;
    headings.forEach((h) => {
      const rad = (2 * h * Math.PI) / 180;
      sumX += Math.cos(rad);
      sumY += Math.sin(rad);
    });
    const avgRad = Math.atan2(sumY, sumX) / 2;
    avgHeading = (avgRad * 180) / Math.PI;
  }

  // baseline is orthogonal to the average
  const baselineBearing = (avgHeading + 90) % 360;

  return baselineBearing;
}
