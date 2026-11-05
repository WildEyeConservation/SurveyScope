import { Amplify } from 'aws-amplify';

type Introspection = Record<string, { fields: Record<string, unknown> }>;

// Frontend changes can precede the master-only backend deployment.
export function hasModelField(model: string, field: string): boolean {
  const models = Amplify.getConfig().API?.GraphQL?.modelIntrospection
    ?.models as Introspection | undefined;
  return !!models?.[model]?.fields?.[field];
}
