import { createContext, useState } from 'react';

export interface ProgressType {
  [key: string]: { value?: number; detail: JSX.Element };
}

export interface ProgressContextType {
  progress: ProgressType;
  setProgress: React.Dispatch<React.SetStateAction<ProgressType>>;
}

export const ProgressContext = createContext<ProgressContextType | null>(null);

export function Progress({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<ProgressType>({});
  return (
    <ProgressContext.Provider
      value={{
        progress,
        setProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
}
