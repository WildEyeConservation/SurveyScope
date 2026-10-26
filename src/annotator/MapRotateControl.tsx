import * as maplibregl from 'maplibre-gl';
import { RotateCw } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';

/** MapLibre control that rotates an image map clockwise in 90-degree steps. */
export default class MapRotateControl implements maplibregl.IControl {
  private container?: HTMLDivElement;

  onAdd(map: maplibregl.Map) {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'maplibregl-ctrl-icon';
    button.title = 'Rotate 90 degrees clockwise';
    button.setAttribute('aria-label', 'Rotate 90 degrees clockwise');
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = renderToStaticMarkup(
      <RotateCw size={16} color='#333' strokeWidth={2.5} />
    );
    button.addEventListener('click', () => {
      const nextBearing = Math.round(map.getBearing() / 90) * 90 - 90;
      map.easeTo({ bearing: nextBearing, duration: 300 });
    });

    container.appendChild(button);
    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.remove();
    this.container = undefined;
  }
}
