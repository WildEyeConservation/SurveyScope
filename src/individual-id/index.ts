/**
 * Public surface of the individual-id workflow.
 *
 * Wire `<IndividualIdTaskPage />` into the route, e.g.
 *
 *   path: '/surveys/:projectId/individual-id'
 *   element: <IndividualIdTaskPage />
 *
 * The task page receives the claimed transect/category via navigation state
 * (set by the Jobs page after claimIndividualIdTransect) and passes them as
 * props to the harness.
 */
export { IndividualIdHarness } from './IndividualIdHarness';
export { IndividualIdMapPair } from './IndividualIdMapPair';
export { IndividualIdPairHarness } from './IndividualIdPairHarness';
export { IndividualIdPairTaskPage } from './IndividualIdPairTaskPage';
export { IndividualIdTaskPage } from './IndividualIdTaskPage';
export type {
  MatchCandidate,
  NeighbourPair,
  PairCompletionState,
} from './types';
