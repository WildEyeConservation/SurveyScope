import * as jdenticon from 'jdenticon';
import maplibregl from 'maplibre-gl';

export const ANNOTATION_MARKER_LAYERS = {
  active: 'annotation-active-ring',
  outlines: 'annotation-outlines',
  circles: 'annotation-circles',
  icons: 'annotation-icons',
  statusIcons: 'annotation-status-icons',
} as const;

/**
 * Register the generated images used by annotation markers. Keeping this
 * separate from the editor lets read-only viewers use the same visual
 * language without taking on editing or task-lifecycle behaviour.
 */
export function registerAnnotationMarkerImages(map: maplibregl.Map) {
  const handleMissingImage = (e: maplibregl.MapStyleImageMissingEvent) => {
    const id = e.id;
    if (id === 'fn-marker') {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 20;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('!', 10, 11);
      map.addImage(id, ctx.getImageData(0, 0, 20, 20) as unknown as ImageData);
      return;
    }

    if (id.startsWith('identicon-')) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 14;
      const ctx = canvas.getContext('2d')!;
      jdenticon.drawIcon(ctx, id.slice('identicon-'.length), 14);
      if (!map.hasImage(id)) {
        map.addImage(id, ctx.getImageData(0, 0, 14, 14));
      }
      return;
    }

    if (id === 'obscured-marker') {
      const canvas = document.createElement('canvas');
      const size = 32;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1f2933';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(5, 5);
      ctx.scale(22 / 24, 22 / 24);
      ctx.strokeStyle = '#1f2933';
      ctx.lineWidth = 2.75;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      [
        'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
        'M14.084 14.158a3 3 0 0 1-4.242-4.242',
        'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
        'm2 2 20 20',
      ].forEach((path) => ctx.stroke(new Path2D(path)));
      ctx.restore();

      if (!map.hasImage(id)) {
        map.addImage(id, ctx.getImageData(0, 0, size, size), {
          pixelRatio: 2,
        });
      }
    }
  };

  map.on('styleimagemissing', handleMissingImage);
  return () => map.off('styleimagemissing', handleMissingImage);
}

/** Add the canonical SurveyScope annotation marker stack to a GeoJSON source. */
export function addAnnotationMarkerLayers(map: maplibregl.Map, source: string) {
  map.addLayer({
    id: ANNOTATION_MARKER_LAYERS.outlines,
    type: 'circle',
    source,
    paint: {
      'circle-radius': ['+', 10, ['get', 'borderWidth']],
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-width': 1,
      'circle-stroke-color': 'rgba(0, 0, 0, 0.45)',
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-opacity': ['get', 'opacity'],
    },
  });
  map.addLayer({
    id: ANNOTATION_MARKER_LAYERS.active,
    type: 'circle',
    source,
    filter: ['==', ['get', 'active'], true],
    paint: {
      'circle-radius': ['+', 10, ['get', 'borderWidth']],
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ff8c1a',
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-opacity': ['get', 'opacity'],
    },
  });
  map.addLayer({
    id: ANNOTATION_MARKER_LAYERS.circles,
    type: 'circle',
    source,
    paint: {
      'circle-radius': 10,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': ['get', 'borderWidth'],
      'circle-stroke-color': ['get', 'borderColor'],
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-opacity': ['get', 'opacity'],
    },
  });
  map.addLayer({
    id: ANNOTATION_MARKER_LAYERS.icons,
    type: 'symbol',
    source,
    filter: ['!=', ['get', 'icon'], ''],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': ['get', 'opacity'],
    },
  });
  map.addLayer({
    id: ANNOTATION_MARKER_LAYERS.statusIcons,
    type: 'symbol',
    source,
    filter: ['!=', ['get', 'statusIcon'], ''],
    layout: {
      'icon-image': ['get', 'statusIcon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-translate': [7, -7],
      'icon-translate-anchor': 'viewport',
      'icon-opacity': ['get', 'opacity'],
    },
  });
}
