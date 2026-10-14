import shp from 'shpjs';
import { polygonsFromGeoJson, type ImportedPolygon } from './surveyArea';

export const AREA_FILE_TYPES = '.zip,.geojson,.json,.kml';

function kmlRing(boundary: Element | undefined): number[][] | null {
  const text = boundary?.getElementsByTagNameNS('*', 'coordinates')[0]
    ?.textContent;
  if (!text) return null;
  const ring = text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').slice(0, 2).map(Number));
  return ring.length >= 3 ? ring : null;
}

function kmlToGeoJson(text: string, source: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${source} is not a valid KML file.`);
  }
  const features: unknown[] = [];
  for (const placemark of doc.getElementsByTagNameNS('*', 'Placemark')) {
    const name = Array.from(placemark.children)
      .find((child) => child.localName === 'name')
      ?.textContent?.trim();
    for (const polygon of placemark.getElementsByTagNameNS('*', 'Polygon')) {
      const outer = kmlRing(
        polygon.getElementsByTagNameNS('*', 'outerBoundaryIs')[0]
      );
      if (!outer) continue;
      const holes = Array.from(
        polygon.getElementsByTagNameNS('*', 'innerBoundaryIs')
      )
        .map(kmlRing)
        .filter((ring): ring is number[][] => ring !== null);
      features.push({
        type: 'Feature',
        properties: name ? { name } : {},
        geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

async function readAreaFile(
  file: File
): Promise<Omit<ImportedPolygon, 'role'>[]> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'zip') {
    return polygonsFromGeoJson(await shp(await file.arrayBuffer()), file.name);
  }
  if (extension === 'kml') {
    return polygonsFromGeoJson(
      kmlToGeoJson(await file.text(), file.name),
      file.name
    );
  }
  if (extension === 'geojson' || extension === 'json') {
    return polygonsFromGeoJson(JSON.parse(await file.text()), file.name);
  }
  throw new Error(
    `${file.name} is not a zipped shapefile, GeoJSON or KML file.`
  );
}

export async function readAreaFiles(files: File[]): Promise<{
  polygons: Omit<ImportedPolygon, 'role'>[];
  errors: string[];
}> {
  const polygons: Omit<ImportedPolygon, 'role'>[] = [];
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const found = await readAreaFile(file);
      if (found.length === 0) {
        errors.push(`${file.name} contains no polygons.`);
      }
      // Two files may share a name, so ids carry the file's position.
      polygons.push(
        ...found.map((polygon) => ({
          ...polygon,
          id: `${index}:${polygon.id}`,
        }))
      );
    } catch (err) {
      console.error('Failed to read survey area file', file.name, err);
      const message = err instanceof Error ? err.message : '';
      errors.push(
        message.startsWith(file.name)
          ? message
          : `${file.name} could not be read.`
      );
    }
  }
  return { polygons, errors };
}
