export const SHARED_DEFAULT_ZOOM_EVENT = 'detweb:shared-default-zoom';

export function storedDefaultZoom(surveyId: string | undefined) {
  const stored = surveyId
    ? localStorage.getItem(`defaultZoom-${surveyId}`)
    : null;
  return stored ? Number(stored) : null;
}

export interface SharedDefaultZoomDetail {
  surveyId: string;
  zoom: number;
}

export function publishSharedDefaultZoom(detail: SharedDefaultZoomDetail) {
  window.dispatchEvent(
    new CustomEvent<SharedDefaultZoomDetail>(SHARED_DEFAULT_ZOOM_EVENT, {
      detail,
    }),
  );
}

export function subscribeToSharedDefaultZoom(
  listener: (detail: SharedDefaultZoomDetail) => void,
) {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<SharedDefaultZoomDetail>).detail);
  };

  window.addEventListener(SHARED_DEFAULT_ZOOM_EVENT, handleEvent);
  return () => {
    window.removeEventListener(SHARED_DEFAULT_ZOOM_EVENT, handleEvent);
  };
}
