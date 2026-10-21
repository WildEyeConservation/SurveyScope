import type { IConstruct } from 'constructs';
import { CfnResolver } from 'aws-cdk-lib/aws-appsync';

/** Fail synthesis if a new resolver cannot be guarded, rather than silently allowing access. */
export function attachMaintenanceGuard(
  scope: IConstruct,
  functionIds: string[]
) {
  for (const resolver of scope.node.findAll()) {
    if (!(resolver instanceof CfnResolver)) continue;
    if (!['Query', 'Mutation', 'Subscription'].includes(resolver.typeName))
      continue;
    if (
      [
        'getUserAnnouncement',
        'setUserAnnouncement',
        'onUserAnnouncementChange',
        'getSystemMaintenance',
        'setSystemMaintenance',
        'onSystemMaintenanceChange',
      ].includes(resolver.fieldName)
    )
      continue;
    const config = resolver.pipelineConfig as
      | CfnResolver.PipelineConfigProperty
      | undefined;
    if (resolver.kind !== 'PIPELINE' || !Array.isArray(config?.functions)) {
      throw new Error(
        `Maintenance guard requires a pipeline: ${resolver.typeName}.${resolver.fieldName}`
      );
    }
    if (config.functions.length + functionIds.length > 10)
      throw new Error(
        `Maintenance guard exceeds pipeline limit: ${resolver.fieldName}`
      );
    resolver.pipelineConfig = {
      functions: [...functionIds, ...config.functions],
    };
  }
}
