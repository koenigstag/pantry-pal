/*
 * JSON Schema in the subset both structured outputs and MCP tool inputs take:
 * every object closed and every property required, with `null` standing for
 * "none". Ranges and lengths are left to the DTOs that read the values.
 */

export type JsonSchema = Record<string, unknown>;

export const string: JsonSchema = { type: 'string' };
export const integer: JsonSchema = { type: 'integer' };
export const number: JsonSchema = { type: 'number' };
export const boolean: JsonSchema = { type: 'boolean' };
export const date: JsonSchema = { type: 'string', format: 'date' };
export const uuid: JsonSchema = { type: 'string', format: 'uuid' };

export const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: 'null' }],
});

/** A closed object whose every property is required. */
export function object(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** A string that is exactly `value`: the tag of one member of a union. */
export const literal = (value: string): JsonSchema => ({ type: 'string', enum: [value] });
