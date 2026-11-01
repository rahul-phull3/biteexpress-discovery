import { createRestaurantSchema } from '../restaurants/create-restaurant.schema';
import {
  LIST_PARAMETER_NAMES,
  SEARCH_PARAMETER_NAMES,
} from '../restaurants/list-query.schema';
import { buildOpenApiDocument } from './openapi.document';

// The OpenAPI document is written by hand (see openapi.document.ts), so these
// tests are what keeps it equal to the code: the query parameters and the body
// fields it lists are exactly the ones the Zod schemas accept, what it marks as
// required is what the schema requires, and its own examples pass the schema.
// test/docs.e2e-spec.ts then checks the other direction: that the answers of
// the running API fit what the document promises.

type Obj = Record<string, any>;

const doc = buildOpenApiDocument();

/** Follows a reference such as "#/components/schemas/Problem" inside the document. */
function follow(reference: string): Obj | undefined {
  return reference
    .slice(2)
    .split('/')
    .reduce<any>((node, key) => node?.[key], doc);
}

/** A parameter, with a reference to a shared parameter replaced by what it points at. The probes have none. */
const parametersOf = (operation: Obj): Obj[] =>
  ((operation.parameters ?? []) as Obj[]).map((parameter) =>
    typeof parameter.$ref === 'string' ? (follow(parameter.$ref) as Obj) : parameter,
  );

const queryParameterNames = (operation: Obj): string[] =>
  parametersOf(operation)
    .filter((parameter) => parameter.in === 'query')
    .map((parameter) => parameter.name as string)
    .sort();

/** Every reference to a shared part of the document, wherever it sits. */
function referencesIn(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => referencesIn(item, found));
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else referencesIn(value, found);
    }
  }
  return found;
}

const operations = Object.entries(doc.paths as Obj).flatMap(([path, item]) =>
  Object.entries(item as Obj).map(([method, operation]) => ({
    path,
    method,
    operation: operation as Obj,
  })),
);
const operationAt = (path: string, method: string): Obj => doc.paths[path][method];

describe('the OpenAPI document', () => {
  it('is OpenAPI 3.1 and describes every route of the API, and no other', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(operations.map(({ method, path }) => `${method.toUpperCase()} ${path}`).sort()).toEqual([
      'GET /health',
      'GET /ready',
      'GET /v1/restaurants',
      'GET /v1/restaurants/search',
      'GET /v1/restaurants/{id}',
      'POST /v1/restaurants',
    ]);
  });

  it('resolves every reference it makes to a shared part', () => {
    const found = referencesIn(doc);
    expect(found.length).toBeGreaterThan(20);
    for (const reference of found) {
      expect({ reference, exists: follow(reference) !== undefined }).toEqual({
        reference,
        exists: true,
      });
    }
  });

  it('gives every operation a unique id, a summary and a success answer', () => {
    const ids = operations.map(({ operation }) => operation.operationId as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { path, method, operation } of operations) {
      expect({ path, method, summary: typeof operation.summary }).toEqual({
        path,
        method,
        summary: 'string',
      });
      const answers = Object.keys(operation.responses as Obj);
      expect({ path, method, success: answers.some((status) => /^(2|304)/.test(status)) }).toEqual({
        path,
        method,
        success: true,
      });
    }
  });

  it('takes the tenant header on every /v1 operation, and on nothing else', () => {
    for (const { path, method, operation } of operations) {
      const takesTenant = parametersOf(operation).some((parameter) => parameter.name === 'X-Tenant-Id');
      expect({ path, method, takesTenant }).toEqual({
        path,
        method,
        takesTenant: path.startsWith('/v1/'),
      });
    }
  });

  describe('the query parameters', () => {
    it.each([
      { path: '/v1/restaurants', names: LIST_PARAMETER_NAMES },
      { path: '/v1/restaurants/search', names: SEARCH_PARAMETER_NAMES },
    ])('of GET $path are exactly the ones the code accepts', ({ path, names }) => {
      expect(queryParameterNames(operationAt(path, 'get'))).toEqual([...names].sort());
    });

    it('are all optional, as in the code', () => {
      for (const path of ['/v1/restaurants', '/v1/restaurants/search']) {
        for (const parameter of parametersOf(operationAt(path, 'get')).filter((p) => p.in === 'query')) {
          expect({ path, name: parameter.name, required: parameter.required }).toEqual({
            path,
            name: parameter.name,
            required: false,
          });
        }
      }
    });
  });

  describe('the request body of POST /v1/restaurants', () => {
    const request = doc.components.schemas.CreateRestaurantRequest as Obj;
    const shape = createRestaurantSchema.shape;
    const fieldsInCode: Record<string, string[]> = {
      body: Object.keys(shape),
      address: Object.keys(shape.address.shape),
      location: Object.keys(shape.location.unwrap().shape),
      cost: Object.keys(shape.cost.unwrap().shape),
      rating: Object.keys(shape.rating.unwrap().shape),
      services: Object.keys(shape.services.unwrap().shape),
      source: Object.keys(shape.source.unwrap().shape),
    };
    const objectAt = (name: string): Obj => (name === 'body' ? request : request.properties[name]);
    const examples = operationAt('/v1/restaurants', 'post').requestBody.content['application/json']
      .examples as Obj;
    /** A body that fills in every object, so that each required field of each one can be taken out. */
    const everything = {
      ...(examples.complete.value as Obj),
      source: { system: 'zomato', id: '18200' },
    };

    it.each(Object.keys(fieldsInCode))('names exactly the fields of %s that the schema accepts', (name) => {
      expect(Object.keys(objectAt(name).properties).sort()).toEqual([...(fieldsInCode[name] ?? [])].sort());
    });

    it.each(Object.keys(fieldsInCode))('refuses unknown fields in %s, as the strict schema does', (name) => {
      expect(objectAt(name).additionalProperties).toBe(false);
    });

    it('accepts a body that fills in every object', () => {
      const result = createRestaurantSchema.safeParse(everything);
      expect(result.error?.issues ?? []).toEqual([]);
    });

    it.each(['body', 'address', 'location', 'source'])(
      'requires every field that %s lists as required',
      (name) => {
        const required = objectAt(name).required as string[];
        expect(required.length).toBeGreaterThan(0);
        for (const key of required) {
          const copy = structuredClone(everything) as Obj;
          const holder = name === 'body' ? copy : (copy[name] as Obj);
          delete holder[key];
          expect({ name, key, accepted: createRestaurantSchema.safeParse(copy).success }).toEqual({
            name,
            key,
            accepted: false,
          });
        }
      },
    );

    it('requires nothing beyond what it lists: the smallest example is accepted', () => {
      expect(request.required).toEqual(['name', 'address']);
      expect(objectAt('address').required).toEqual(['city', 'countryCode']);
      const result = createRestaurantSchema.safeParse(examples.minimal.value);
      expect(result.error?.issues ?? []).toEqual([]);
    });

    it.each(Object.keys(examples))('has an example, "%s", that the schema accepts', (name) => {
      const result = createRestaurantSchema.safeParse(examples[name].value);
      expect(result.error?.issues ?? []).toEqual([]);
    });
  });
});
