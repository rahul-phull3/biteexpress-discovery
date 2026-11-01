import type { Document } from 'mongodb';
import type { ListCriteria } from './list-criteria';
import {
  buildFilter,
  buildMongoListQuery,
  buildSort,
  buildVocabularyPipelines,
  DISTANCE_FIELD,
  LIST_PROJECTION,
} from './mongo-list-query';

const criteria = (overrides: Partial<ListCriteria> = {}): ListCriteria => ({
  cuisineMatch: 'any',
  sort: 'rating',
  order: 'desc',
  limit: 20,
  offset: 0,
  ...overrides,
});

const filterOf = (overrides: Partial<ListCriteria> = {}) => buildFilter('t1', criteria(overrides));

describe('buildFilter', () => {
  it('always asks for one tenant\'s active restaurants, and nothing else without criteria', () => {
    expect(filterOf()).toEqual({ tenantId: 't1', status: 'active' });
  });

  it('matches a city and a country exactly', () => {
    expect(filterOf({ city: 'Gurgaon', countryCode: 'IN' })).toMatchObject({
      'address.city': 'Gurgaon',
      'address.country.code': 'IN',
    });
  });

  it('matches any of the cuisines with $in, or all of them with $all', () => {
    expect(filterOf({ cuisines: ['Thai', 'Chinese'] }).cuisines).toEqual({ $in: ['Thai', 'Chinese'] });
    expect(filterOf({ cuisines: ['Thai', 'Chinese'], cuisineMatch: 'all' }).cuisines).toEqual({
      $all: ['Thai', 'Chinese'],
    });
  });

  it('turns a part of a name into a case-insensitive regular expression that matches it literally', () => {
    expect(filterOf({ nameContains: 'dosa' }).name).toEqual({ $regex: 'dosa', $options: 'i' });
    expect(filterOf({ nameContains: 'Cafe (Bar) [Main] +1.5?' }).name).toEqual({
      $regex: 'Cafe \\(Bar\\) \\[Main\\] \\+1\\.5\\?',
      $options: 'i',
    });
  });

  it('never builds a regular expression from an operator-looking name', () => {
    const { name } = filterOf({ nameContains: '.*' });

    expect(name).toEqual({ $regex: '\\.\\*', $options: 'i' });
  });

  it('asks for at least the minimum average rating', () => {
    expect(filterOf({ minRating: 4 })['rating.average']).toEqual({ $gte: 4 });
  });

  it('bounds the cost for two with $gte and $lte on the same field', () => {
    expect(filterOf({ minCost: 100 })['cost.forTwo']).toEqual({ $gte: 100 });
    expect(filterOf({ maxCost: 900 })['cost.forTwo']).toEqual({ $lte: 900 });
    expect(filterOf({ minCost: 100, maxCost: 900 })['cost.forTwo']).toEqual({ $gte: 100, $lte: 900 });
  });

  it('filters by currency, price range, delivery and booking, including a false', () => {
    expect(filterOf({ currency: 'INR', priceRange: 2, delivery: false, booking: true })).toMatchObject({
      'cost.currency': 'INR',
      'cost.priceRange': 2,
      'services.onlineDelivery': false,
      'services.tableBooking': true,
    });
  });

  it('has no key for a criterion that was not given', () => {
    expect(Object.keys(filterOf({ city: 'Gurgaon' })).sort()).toEqual(['address.city', 'status', 'tenantId']);
  });

  describe('an ascending sort', () => {
    it.each([
      ['rating', 'rating.score'],
      ['averageRating', 'rating.average'],
      ['votes', 'rating.votes'],
      ['cost', 'cost.forTwo'],
    ] as const)('by %s leaves out restaurants without %s', (sort, field) => {
      expect(filterOf({ sort, order: 'asc' })[field]).toEqual({ $ne: null });
    });

    it('keeps a cost bound and adds the exclusion to the same field', () => {
      const filter = filterOf({ sort: 'cost', order: 'asc', minCost: 100, maxCost: 900 });

      expect(filter['cost.forTwo']).toEqual({ $gte: 100, $lte: 900, $ne: null });
    });

    it('leaves a descending sort alone, where MongoDB puts the missing values last', () => {
      for (const sort of ['rating', 'averageRating', 'votes', 'cost'] as const) {
        expect(filterOf({ sort, order: 'desc' })).toEqual({ tenantId: 't1', status: 'active' });
      }
    });

    it('does not touch the filter for sorts by name, city or distance', () => {
      for (const sort of ['name', 'city'] as const) {
        expect(filterOf({ sort, order: 'asc' })).toEqual({ tenantId: 't1', status: 'active' });
      }
    });
  });
});

describe('buildSort', () => {
  const sortOf = (sort: ListCriteria['sort'], order: ListCriteria['order']) =>
    buildSort(criteria({ sort, order }));

  it.each([
    ['rating', 'desc', { 'rating.score': -1, _id: 1 }],
    ['rating', 'asc', { 'rating.score': 1, _id: -1 }],
    ['averageRating', 'desc', { 'rating.average': -1, 'rating.votes': -1, _id: 1 }],
    ['averageRating', 'asc', { 'rating.average': 1, 'rating.votes': 1, _id: -1 }],
    ['votes', 'desc', { 'rating.votes': -1, _id: 1 }],
    ['votes', 'asc', { 'rating.votes': 1, _id: -1 }],
    ['cost', 'asc', { 'cost.forTwo': 1, _id: 1 }],
    ['cost', 'desc', { 'cost.forTwo': -1, _id: -1 }],
    ['name', 'asc', { name: 1, _id: 1 }],
    ['name', 'desc', { name: -1, _id: -1 }],
    ['city', 'asc', { 'address.city': 1, 'rating.score': -1, _id: 1 }],
    ['city', 'desc', { 'address.city': -1, 'rating.score': -1, _id: 1 }],
  ] as const)('%s %s', (sort, order, expected) => {
    expect(sortOf(sort, order)).toEqual(expected);
  });

  it('keeps the keys in the order given, because the order of the keys is the order of the sort', () => {
    expect(Object.keys(sortOf('averageRating', 'desc'))).toEqual(['rating.average', 'rating.votes', '_id']);
  });

  it('ends every sort in _id so that pages never split a tie', () => {
    for (const sort of ['rating', 'averageRating', 'votes', 'cost', 'name', 'city'] as const) {
      for (const order of ['asc', 'desc'] as const) {
        expect(Object.keys(sortOf(sort, order)).at(-1)).toBe('_id');
      }
    }
  });

  it('leaves distance to $geoNear', () => {
    expect(() => sortOf('distance', 'asc')).toThrow('$geoNear');
  });
});

describe('buildMongoListQuery without a point', () => {
  it('is a find that skips, and asks for one row more than the page', () => {
    const query = buildMongoListQuery('t1', criteria({ limit: 20, offset: 40, city: 'Gurgaon' }));

    expect(query).toEqual({
      kind: 'find',
      filter: { tenantId: 't1', status: 'active', 'address.city': 'Gurgaon' },
      sort: { 'rating.score': -1, _id: 1 },
      skip: 40,
      limit: 21,
      projection: LIST_PROJECTION,
    });
  });

  it('reads only the fields a listing shows', () => {
    expect(Object.keys(LIST_PROJECTION).sort()).toEqual(['address', 'cost', 'cuisines', 'name', 'rating']);
  });

  it('hands out its own copy of the projection', () => {
    const query = buildMongoListQuery('t1', criteria());

    expect(query.kind === 'find' && query.projection).not.toBe(LIST_PROJECTION);
  });

  it('refuses to sort by distance', () => {
    expect(() => buildMongoListQuery('t1', criteria({ sort: 'distance', order: 'asc' }))).toThrow(
      'without a point',
    );
  });
});

describe('buildMongoListQuery with a point', () => {
  const near = { latitude: 28.495, longitude: 77.089 };
  const pipelineOf = (overrides: Partial<ListCriteria> = {}): Document[] => {
    const query = buildMongoListQuery('t1', criteria({ near, sort: 'distance', order: 'asc', ...overrides }));
    if (query.kind !== 'aggregate') throw new Error('expected an aggregation');
    return query.pipeline;
  };

  it('is an aggregation that starts with $geoNear, the only stage that may', () => {
    expect(Object.keys(pipelineOf()[0] ?? {})).toEqual(['$geoNear']);
  });

  it('gives $geoNear the point as GeoJSON, longitude first', () => {
    const geoNear = pipelineOf()[0]?.$geoNear as Document;

    expect(geoNear.near).toEqual({ type: 'Point', coordinates: [77.089, 28.495] });
    expect(geoNear.distanceField).toBe(DISTANCE_FIELD);
    expect(geoNear.spherical).toBe(true);
  });

  it('puts the tenant into the query of $geoNear, which is how the index narrows to one tenant', () => {
    const geoNear = pipelineOf({ city: 'Gurgaon' })[0]?.$geoNear as Document;

    expect(geoNear.query).toEqual({ tenantId: 't1', status: 'active', 'address.city': 'Gurgaon' });
  });

  it('has no maximum distance unless there is a radius, and then in metres', () => {
    expect(pipelineOf()[0]?.$geoNear).not.toHaveProperty('maxDistance');
    expect(pipelineOf({ near: { ...near, radiusKm: 3 } })[0]?.$geoNear).toMatchObject({ maxDistance: 3000 });
    expect(pipelineOf({ near: { ...near, radiusKm: 0.25 } })[0]?.$geoNear).toMatchObject({ maxDistance: 250 });
  });

  it('sorting by distance needs no $sort stage, so $geoNear can stop as soon as the page is full', () => {
    const stages = pipelineOf({ limit: 20, offset: 0 }).map((stage) => Object.keys(stage)[0]);

    expect(stages).toEqual(['$geoNear', '$limit', '$project']);
  });

  it('skips only when there is something to skip, and asks for one row more than the page', () => {
    const pipeline = pipelineOf({ limit: 10, offset: 30 });

    expect(pipeline.slice(1, 3)).toEqual([{ $skip: 30 }, { $limit: 11 }]);
  });

  it('sorts after $geoNear when the order is something other than distance', () => {
    const pipeline = pipelineOf({ sort: 'rating', order: 'desc' });

    expect(pipeline.map((stage) => Object.keys(stage)[0])).toEqual(['$geoNear', '$sort', '$limit', '$project']);
    expect(pipeline[1]).toEqual({ $sort: { 'rating.score': -1, _id: 1 } });
  });

  it('projects the listed fields and the distance', () => {
    const project = pipelineOf().at(-1);

    expect(project).toEqual({ $project: { ...LIST_PROJECTION, [DISTANCE_FIELD]: 1 } });
  });

  it('applies an ascending sort\'s exclusion inside $geoNear too', () => {
    const geoNear = pipelineOf({ sort: 'cost', order: 'asc' })[0]?.$geoNear as Document;

    expect(geoNear.query['cost.forTwo']).toEqual({ $ne: null });
  });
});

describe('buildVocabularyPipelines', () => {
  const { cities, cuisines } = buildVocabularyPipelines('t1');

  it('reads only the active restaurants of the tenant', () => {
    expect(cities[0]).toEqual({ $match: { tenantId: 't1', status: 'active' } });
    expect(cuisines[0]).toEqual({ $match: { tenantId: 't1', status: 'active' } });
  });

  it('counts restaurants per city', () => {
    expect(cities[1]).toEqual({ $group: { _id: '$address.city', count: { $sum: 1 } } });
  });

  it('counts restaurants per cuisine after unwinding the list', () => {
    expect(cuisines.slice(1, 3)).toEqual([
      { $unwind: '$cuisines' },
      { $group: { _id: '$cuisines', count: { $sum: 1 } } },
    ]);
  });

  it('returns each list in name order', () => {
    expect(cities.at(-1)).toEqual({ $sort: { _id: 1 } });
    expect(cuisines.at(-1)).toEqual({ $sort: { _id: 1 } });
  });
});
