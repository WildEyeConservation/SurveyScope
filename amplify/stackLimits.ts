import { Aspects, Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

export const STACK_LIMITS = {
  resources: 500,
  outputs: 200,
  parameters: 200,
  bytes: 1_048_576,
};
export const STACK_LIMIT_THRESHOLD = 0.9;

type Usage = Record<keyof typeof STACK_LIMITS, number>;

export function measureStack(stack: Stack): Usage {
  const template = (
    stack as unknown as {
      _toCloudFormation(): Record<string, object | undefined>;
    }
  )._toCloudFormation();
  return {
    resources: Object.keys(template.Resources ?? {}).length,
    outputs: Object.keys(template.Outputs ?? {}).length,
    parameters: Object.keys(template.Parameters ?? {}).length,
    // CDK writes templates with one-space indentation.
    bytes: Buffer.byteLength(JSON.stringify(template, undefined, 1)),
  };
}

export function stackLimitErrors(usage: Usage): string[] {
  return (Object.keys(STACK_LIMITS) as (keyof Usage)[])
    .filter((key) => usage[key] > STACK_LIMITS[key] * STACK_LIMIT_THRESHOLD)
    .map(
      (key) =>
        `${key} ${usage[key]} of ${STACK_LIMITS[key]} is over ${STACK_LIMIT_THRESHOLD * 100}% of the CloudFormation limit. ` +
        'Move resources out of this stack (a new resourceGroupName or backend.createStack) before it stops deploying.',
    );
}

export function guardStackLimits(root: IConstruct) {
  Aspects.of(root).add({
    visit(node) {
      if (Stack.isStack(node)) {
        node.node.addValidation({
          validate: () => stackLimitErrors(measureStack(node)),
        });
      }
    },
  });
}
