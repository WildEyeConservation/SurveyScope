import type { StyleSpecification } from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { BASE_STYLE, escapeHtml } from './survey/surveyMapStyle';
import type { SurveyLocation } from './useSurveyLocations';

export type SurveyPin = SurveyLocation & {
  id: string;
  name: string;
  organizationName: string;
};

const STYLE: StyleSpecification = {
  ...BASE_STYLE,
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -0.6, 'raster-brightness-max': 0.85 },
    },
  ],
};

export default function SurveyLocationsMap({
  pins,
  highlightedId,
}: {
  pins: SurveyPin[];
  highlightedId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, HTMLDivElement>());
  const fittedRef = useRef(false);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: STYLE,
      center: [25, -25],
      zoom: 2,
      dragRotate: false,
      cooperativeGestures: true,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(containerRef.current!);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const dots = markersRef.current;
    const markers = pins.map((pin) => {
      // MapLibre positions the marker with a transform, so scale an inner dot.
      const el = document.createElement('div');
      el.title = `${pin.name} (${pin.organizationName})`;
      const dot = document.createElement('div');
      dot.className =
        'size-3 rounded-full border-2 border-white bg-primary shadow transition-transform';
      el.appendChild(dot);
      dots.set(pin.id, dot);
      el.style.cursor = 'pointer';
      const popup = new maplibregl.Popup({
        offset: 10,
        closeButton: false,
      }).setHTML(
        `<div style="color:#212529"><strong>${escapeHtml(pin.name)}</strong><br>${escapeHtml(pin.organizationName)}</div>`,
      );
      return new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .setPopup(popup)
        .addTo(map);
    });

    // Fit once so later refreshes keep the user's view.
    if (pins.length && !fittedRef.current) {
      fittedRef.current = true;
      const bounds = new maplibregl.LngLatBounds();
      pins.forEach((pin) => bounds.extend([pin.lng, pin.lat]));
      map.fitBounds(bounds, { padding: 40, maxZoom: 6, animate: false });
    }

    return () => {
      markers.forEach((marker) => marker.remove());
      dots.clear();
    };
  }, [pins]);

  useEffect(() => {
    markersRef.current.forEach((el, id) => {
      const on = id === highlightedId;
      el.style.transform = on ? 'scale(1.8)' : '';
      el.parentElement!.style.zIndex = on ? '1' : '';
    });
  }, [highlightedId, pins]);

  return (
    <div className='absolute inset-0'>
      <div ref={containerRef} className='h-full w-full' />
    </div>
  );
}
