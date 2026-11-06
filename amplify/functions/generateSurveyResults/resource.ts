import { defineFunction } from '@aws-amplify/backend';

export const generateSurveyResults = defineFunction({
  name: 'generateSurveyResults',
  resourceGroupName: 'launchers',
  timeoutSeconds: 30,
  runtime: 24,
});
