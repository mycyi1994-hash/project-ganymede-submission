/**
 * Checks a value against the subset of JSON Schema the OpenAPI document uses (type, const, enum,
 * required, properties, items, pattern), so a response can be tested against what the document
 * promises without a schema library. Returns the mismatches, as JSON paths with what was expected.
 */
const typeOf = (value) => value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;

export function schemaErrors(value, schema, path = "$") {
  const errors = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.includes(actual) && !(actual === "integer" && types.includes("number"))) return [`${path}: ${actual}, expected ${types.join(" or ")}`];
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: ${JSON.stringify(value)}, expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)}, expected one of ${schema.enum.join(", ")}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: missing`);
    for (const [key, property] of Object.entries(schema.properties ?? {})) if (key in value) errors.push(...schemaErrors(value[key], property, `${path}.${key}`));
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`)));
  return errors;
}
