import { type ReactNode, useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { createSurveyImagesStore, SurveyImagesContext } from './surveyImages';

export default function SurveyImagesProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { client } = useContext(GlobalContext)!;
  const [store] = useState(() => createSurveyImagesStore(client, projectId));
  useEffect(() => store.open(), [store]);
  return (
    <SurveyImagesContext.Provider value={store}>
      {children}
    </SurveyImagesContext.Provider>
  );
}
