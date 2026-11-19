export type FieldCall = {
  alias: string;
  field: string;
  args: Record<string, { type: string; value: unknown }>;
  selection: string;
};

export function buildAliasedQuery(name: string, calls: FieldCall[]) {
  const declared: string[] = [];
  const variables: Record<string, unknown> = {};
  const body = calls.map((call) => {
    const passed = Object.entries(call.args)
      .filter(([, arg]) => arg.value !== undefined && arg.value !== null)
      .map(([argName, arg]) => {
        const variable = `${call.alias}_${argName}`;
        declared.push(`$${variable}: ${arg.type}`);
        variables[variable] = arg.value;
        return `${argName}: $${variable}`;
      });
    const args = passed.length ? `(${passed.join(', ')})` : '';
    return `${call.alias}: ${call.field}${args} { ${call.selection} }`;
  });
  const params = declared.length ? `(${declared.join(', ')})` : '';
  return {
    query: `query ${name}${params} {\n  ${body.join('\n  ')}\n}`,
    variables,
  };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
