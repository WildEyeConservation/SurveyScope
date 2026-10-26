/// <reference types="vite/client" />
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// maplibre-gl v6 no longer inlines its worker, and Vite's dep pre-bundling breaks the default lookup.
setWorkerUrl(workerUrl);
