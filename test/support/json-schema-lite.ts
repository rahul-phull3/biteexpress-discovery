import type { AnyBulkWriteOperation, Document } from 'mongodb';

/**
 * A small checker for the part of $jsonSchema that database/restaurants.collection.ts
 * uses (bsonType, required, properties, enum, minLength, maxLength, pattern,
 * minimum, maximum, minItems, maxItems, items). It lets a unit test ask "would
 * the database accept this document?" without a database.
 *
 * It does not replace test/importer.int-spec.ts: the real MongoDB stays the
 * judge. It exists so that a mismatch between what the importer produces and
 * what the validator demands shows up in `npm test`, in seconds.
 *
 * A JavaScript number counts as a BSON int when it is a whole number in the
 * 32-bit range, which is how the Node driver sends it, and as a double
 * otherwise.
 */
export function schemaViolations(
  schema: Document,
  value: unknown,
  path = '',
): string[] {
  const here = path === '' ? '(document)' : path;

  if (schema.bsonType !== undefined) {
    const allowed: string[] = Array.isArray(schema.bsonType)
      ? schema.bsonType
      : [schema.bsonType];
    if (!allowed.some((type) => hasBsonType(value, type))) {
      return [
        `${here}: expected ${allowed.join(' or ')}, got ${describeValue(value)}`,
      ];
    }
  }

  const problems: string[] = [];
  if (
    schema.enum !== undefined &&
    !(schema.enum as unknown[]).includes(value)
  ) {
    problems.push(
      `${here}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    );
  }

  if (typeof value === 'string') {
    const length = [...value].length; // code points, which is how MongoDB counts
    if (schema.minLength !== undefined && length < schema.minLength) {
      problems.push(`${here}: shorter than ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      problems.push(`${here}: longer than ${schema.maxLength} characters`);
    }
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern).test(value)
    ) {
      problems.push(`${here}: "${value}" does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(`${here}: ${value} is below ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(`${here}: ${value} is above ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${here}: fewer than ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${here}: more than ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        // An array of schemas checks position by position; extra items are allowed.
        const itemSchema = Array.isArray(schema.items)
          ? schema.items[index]
          : schema.items;
        if (itemSchema) {
          problems.push(
            ...schemaViolations(itemSchema, item, `${path}[${index}]`),
          );
        }
      });
    }
  }

  if (isObject(value)) {
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in value)) problems.push(`${join(path, key)}: is required`);
    }
    for (const [key, subschema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        problems.push(
          ...schemaViolations(
            subschema as Document,
            value[key],
            join(path, key),
          ),
        );
      }
    }
  }
  return problems;
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

function hasBsonType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'null':
      return value === null;
    case 'bool':
      return typeof value === 'boolean';
    case 'date':
      return value instanceof Date;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'number':
      return typeof value === 'number';
    case 'int':
      return isInt32(value);
    case 'double':
      return typeof value === 'number' && !isInt32(value);
    default:
      return false; // "long" and the rest need driver types a plain JS value does not have
  }
}

function isInt32(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INT32_MIN &&
    value <= INT32_MAX
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value === 'number' && !isInt32(value)
    ? `double ${value}`
    : `${typeof value} ${JSON.stringify(value)}`;
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/**
 * The document MongoDB would insert for an upsert that finds nothing: the
 * equality fields of the filter, then the update operators applied to them.
 * The importer's upserts use only dotted equality filters, $set, $setOnInsert
 * and $unset, so that is all this models.
 */
export function documentFromUpsert(
  operation: AnyBulkWriteOperation<Document>,
): Document {
  if (!('updateOne' in operation)) {
    throw new Error('expected an updateOne operation');
  }
  const { filter, update } = operation.updateOne;
  const operators = update as Document;
  const document: Document = {};
  for (const [path, value] of Object.entries(filter)) {
    setPath(document, path, value);
  }
  for (const [path, value] of Object.entries(operators.$set ?? {})) {
    setPath(document, path, value);
  }
  for (const [path, value] of Object.entries(operators.$setOnInsert ?? {})) {
    setPath(document, path, value);
  }
  for (const path of Object.keys(operators.$unset ?? {})) {
    delete document[path];
  }
  return document;
}

function setPath(document: Document, path: string, value: unknown): void {
  const keys = path.split('.');
  let target = document;
  for (const key of keys.slice(0, -1)) {
    target[key] ??= {};
    target = target[key] as Document;
  }
  target[keys[keys.length - 1]] = value;
}

/** True when the value, or anything inside it, is undefined (the driver would store that as null). */
export function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (isObject(value)) return Object.values(value).some(containsUndefined);
  return false;
}
