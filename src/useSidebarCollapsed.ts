import { useState } from 'react';

const STORAGE_KEY = 'reviewSidebarCollapsed';

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true',
  );
  const toggle = () =>
    setCollapsed((was) => {
      localStorage.setItem(STORAGE_KEY, String(!was));
      return !was;
    });
  return [collapsed, toggle] as const;
}
