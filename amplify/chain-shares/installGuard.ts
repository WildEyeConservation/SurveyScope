import { Stack } from 'aws-cdk-lib';
import {
  BaseDataSource,
  CfnFunctionConfiguration,
  CfnResolver,
} from 'aws-cdk-lib/aws-appsync';

export const GUARDED_MUTATIONS = [
  'createChainReviewFeedback',
  'updateChainReviewFeedback',
  'deleteChainReviewFeedback',
  'addUserToGroup',
] as const;

/** Add share validation only; leave original annotation mutations untouched. */
export function installMutationGuard(
  resolvers: Record<string, CfnResolver>,
  apiId: string,
  dataSource: BaseDataSource
) {
  for (const fieldName of GUARDED_MUTATIONS) {
    const resolver = Object.values(resolvers).find(
      (r) => r.typeName === 'Mutation' && r.fieldName === fieldName
    );
    if (!resolver || resolver.kind !== 'PIPELINE')
      throw new Error(`Missing generated pipeline: ${fieldName}`);
    const pipeline =
      resolver.pipelineConfig as CfnResolver.PipelineConfigProperty;
    if (!Array.isArray(pipeline?.functions))
      throw new Error(`Invalid generated pipeline: ${fieldName}`);
    const guard = new CfnFunctionConfiguration(
      Stack.of(resolver),
      `${fieldName}Guard`,
      {
        apiId,
        dataSourceName: dataSource.name,
        name: `${fieldName}Guard`,
        functionVersion: '2018-05-29',
        requestMappingTemplate: `#if($util.authType() == "IAM Authorization")
  #return($ctx.prev.result)
#end
#if($ctx.info.fieldName == "addUserToGroup" && !$ctx.args.groupName.startsWith("chainshare-"))
  #return($ctx.prev.result)
#end
#set($input = $util.defaultIfNull($ctx.args.input, $ctx.args))
{"version":"2018-05-29","operation":"Invoke","payload":{"identity":$util.toJson($ctx.identity),"fieldName":$util.toJson($ctx.info.fieldName),"input":$util.toJson($input)}}`,
        responseMappingTemplate: `#if($ctx.error)
  $util.error($ctx.error.message, $ctx.error.type)
#end
#if($ctx.result != true)
  $util.unauthorized()
#end
$util.toJson($ctx.prev.result)`,
      }
    );
    guard.node.addDependency(dataSource);
    resolver.pipelineConfig = {
      functions: [guard.attrFunctionId, ...pipeline.functions],
    };
  }
}
