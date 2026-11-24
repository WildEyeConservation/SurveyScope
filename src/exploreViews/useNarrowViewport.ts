import { useEffect, useState } from 'react';

const NARROW_QUERY = '(max-width: 767.98px)';

export function useNarrowViewport() {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
