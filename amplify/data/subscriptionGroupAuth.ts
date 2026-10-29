import { Stack } from 'aws-cdk-lib';
import {
  BaseDataSource,
  CfnFunctionConfiguration,
  CfnResolver,
} from 'aws-cdk-lib/aws-appsync';

// AppSync subscription `in` filters allow only five values, so larger group lists need narrowing.

const detect = `#set( $groups = $util.defaultIfNull($ctx.identity.claims.get("cognito:groups"), []) )
#if( $util.isString($groups) )
  #if( $util.isList($util.parseJson($groups)) )
    #set( $groups = $util.parseJson($groups) )
  #else
    #set( $groups = [$groups] )
  #end
#end
#set( $filter = $util.defaultIfNull($ctx.args.filter, {}) )
#set( $authOr = [] )
#set( $client = {} )
#set( $wrapped = false )
#if( $filter.size() == 1 && $util.isList($filter.get("and")) && $filter.get("and").size() == 2 && $util.isMap($filter.get("and").get(0)) && $filter.get("and").get(0).size() == 1 && $util.isList($filter.get("and").get(0).get("or")) )
  #set( $authOr = $filter.get("and").get(0).get("or") )
  #set( $client = $filter.get("and").get(1) )
  #set( $wrapped = true )
#elseif( $filter.size() == 1 && $util.isList($filter.get("or")) )
  #set( $authOr = $filter.get("or") )
#end
#set( $groupIndex = -1 )
#set( $index = 0 )
#foreach( $condition in $authOr )
  #if( $util.isMap($condition) && $condition.size() == 1 && $util.isMap($condition.get("group")) && $condition.get("group").get("in") == $groups )
    #set( $groupIndex = $index )
  #end
  #set( $index = $index + 1 )
#end
#set( $projectId = "" )
#set( $organizationId = "" )
#set( $ownUserId = "" )
#set( $clauses = [] )
#if( $util.isMap($client) )
  $util.qr($clauses.add($client))
  #if( $util.isList($client.get("and")) )
    $util.qr($clauses.addAll($client.get("and")))
  #end
#end
#foreach( $clause in $clauses )
  #if( $util.isMap($clause) )
    #if( $projectId == "" && $util.isMap($clause.get("projectId")) && $util.isString($clause.get("projectId").get("eq")) )
      #set( $projectId = $clause.get("projectId").get("eq") )
    #end
    #if( $projectId == "" && $util.isMap($clause.get("surveyId")) && $util.isString($clause.get("surveyId").get("eq")) )
      #set( $projectId = $clause.get("surveyId").get("eq") )
    #end
    #if( $organizationId == "" && $util.isMap($clause.get("organizationId")) && $util.isString($clause.get("organizationId").get("eq")) )
      #set( $organizationId = $clause.get("organizationId").get("eq") )
    #end
    #if( $ctx.info.fieldName.endsWith("OrganizationMembership") && $util.isMap($clause.get("userId")) )
      #set( $userId = $util.defaultIfNull($clause.get("userId").get("eq"), "") )
      #if( $userId != "" && ($userId == $ctx.identity.sub || $userId == $ctx.identity.username) )
        #set( $ownUserId = $userId )
      #end
    #end
  #end
#end`;

const rewrite = `#set( $narrowed = [] )
#set( $index = 0 )
#foreach( $condition in $authOr )
  #if( $index == $groupIndex )
    #if( $org != "" && $groups.contains($org) )
      $util.qr($narrowed.add({ "group": { "eq": $org } }))
    #elseif( $ownUserId != "" )
      $util.qr($narrowed.add({ "userId": { "eq": $ownUserId } }))
    #end
  #else
    $util.qr($narrowed.add($condition))
  #end
  #set( $index = $index + 1 )
#end
#if( $narrowed.isEmpty() )
  $util.unauthorized()
#end
#if( $wrapped )
  $util.qr($ctx.args.put("filter", { "and": [ { "or": $narrowed }, $client ] }))
#else
  $util.qr($ctx.args.put("filter", { "or": $narrowed }))
#end`;

const skip = `#if( $groups.size() <= 5 || $groupIndex < 0 )
  #return($ctx.prev.result)
#end`;

export const requestTemplate = `${detect}
${skip}
#if( $organizationId == "" && $projectId != "" )
  {"version":"2018-05-29","operation":"GetItem","key":{"id":$util.dynamodb.toDynamoDBJson($projectId)}}
#else
  #set( $org = $organizationId )
${rewrite}
  #return($ctx.prev.result)
#end`;

export const responseTemplate = `#if( $ctx.error )
  $util.error($ctx.error.message, $ctx.error.type)
#end
${detect}
#set( $org = "" )
#if( $util.isMap($ctx.result) )
  #set( $org = $util.defaultIfNull($ctx.result.organizationId, "") )
#end
${rewrite}
$util.toJson($ctx.prev.result)`;

export function installSubscriptionGroupAuth(
  resolvers: Record<string, CfnResolver>,
  apiId: string,
  projectSource: BaseDataSource,
) {
  const functions = new Map<Stack, CfnFunctionConfiguration>();
  for (const resolver of Object.values(resolvers)) {
    if (resolver.typeName !== 'Subscription' || resolver.kind !== 'PIPELINE')
      continue;
    const pipeline =
      resolver.pipelineConfig as CfnResolver.PipelineConfigProperty;
    if (!Array.isArray(pipeline?.functions) || pipeline.functions.length === 0)
      throw new Error(`Invalid generated pipeline: ${resolver.fieldName}`);
    const stack = Stack.of(resolver);
    let fn = functions.get(stack);
    if (!fn) {
      fn = new CfnFunctionConfiguration(stack, 'SubscriptionGroupAuth', {
        apiId,
        dataSourceName: projectSource.name,
        name: `SubscriptionGroupAuth${functions.size}`,
        functionVersion: '2018-05-29',
        requestMappingTemplate: requestTemplate,
        responseMappingTemplate: responseTemplate,
      });
      fn.node.addDependency(projectSource);
      functions.set(stack, fn);
    }
    const steps = [...pipeline.functions];
    steps.splice(steps.length - 1, 0, fn.attrFunctionId);
    resolver.pipelineConfig = { functions: steps };
  }
}
