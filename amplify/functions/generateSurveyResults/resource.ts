import { defineFunction } from '@aws-amplify/backend';

export const generateSurveyResults = defineFunction({
  name: 'generateSurveyResults',
  timeoutSeconds: 30,
  runtime: 24,
});
