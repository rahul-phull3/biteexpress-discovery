import type { Document } from 'mongodb';
import { escapeRegex } from './escape-regex';
import type { ListCriteria } from './list-criteria';
import { defaultOrder, type ListSort } from './list-sort';

/**
 * Turns ListCriteria into MongoDB queries. Pure functions, no driver calls, so
 * every rule about filters, sort order and the $geoNear pipeline is unit tested
 * (mongo-list-query.spec.ts) and then proven against a real database by the
 * store contract (test/restaurants.int-spec.ts).
 */

/** The fields a listing reads. The rest (location, services, timestamps, ...) stays in the database. */
export const LIST_PROJECTION: Readonly<Record<string, 1>> = {
  name: 1,
  address: 1,
  cuisines: 1,
  cost: 1,
  rating: 1,
};

/** Where $geoNear writes the distance, in metres. */
export const DISTANCE_FIELD = 'distanceMeters';

export type MongoSort = Record<string, 1 | -1>;

export type MongoListQuery =
  /** No point: a plain find on the collection. */
  | {
      kind: 'find';
      filter: Document;
      sort: MongoSort;
      skip: number;
      limit: number;
      projection: Document;
    }
  /** A point: an aggregation that starts with $geoNear, the only stage that can sort by distance. */
  | { kind: 'aggregate'; pipeline: Document[] };

/**
 * The stored field that an ascending sort orders by. MongoDB puts null and
 * missing values before every number, so an ascending sort would list the
 * restaurants with an unknown cost or rating first ("cheapest" would be the
 * ones nobody priced). They are left out of ascending sorts instead; in a
 * descending sort they come last on their own.
 */
const NULLABLE_SORT_FIELD: Partial<Record<ListSort, string>> = {
  rating: 'rating.score',
  averageRating: 'rating.average',
  votes: 'rating.votes',
  cost: 'cost.forTwo',
};

/** Every query is for one tenant's active restaurants, plus whatever the criteria add. */
export function buildFilter(tenantId: string, criteria: ListCriteria): Document {
  const filter: Document = { tenantId, status: 'active' };

  if (criteria.city !== undefined) filter['address.city'] = criteria.city;
  if (criteria.countryCode !== undefined) filter['address.country.code'] = criteria.countryCode;
  if (criteria.cuisines !== undefined) {
    filter.cuisines =
      criteria.cuisineMatch === 'all' ? { $all: criteria.cuisines } : { $in: criteria.cuisines };
  }
  if (criteria.nameContains !== undefined) {
    // The text is escaped, so it is matched literally: "(bar)" or "." cannot become a pattern.
    filter.name = { $regex: escapeRegex(criteria.nameContains), $options: 'i' };
  }
  if (criteria.textWords !== undefined && criteria.textWords.length > 0) {
    // One clause per word, all of them required; a clause is met by the name or by the area.
    filter.$and = criteria.textWords.map((word) => {
      const contains = { $regex: escapeRegex(word), $options: 'i' };
      return { $or: [{ name: contains }, { 'address.locality': contains }] };
    });
  }
  if (criteria.minRating !== undefined) filter['rating.average'] = { $gte: criteria.minRating };

  // $gte and $lte only match numbers, so an unknown cost never matches a bound.
  const cost: Document = {};
  if (criteria.minCost !== undefined) cost.$gte = criteria.minCost;
  if (criteria.maxCost !== undefined) cost.$lte = criteria.maxCost;
  if (Object.keys(cost).length > 0) filter['cost.forTwo'] = cost;

  if (criteria.currency !== undefined) filter['cost.currency'] = criteria.currency;
  if (criteria.priceRange !== undefined) filter['cost.priceRange'] = criteria.priceRange;
  if (criteria.delivery !== undefined) filter['services.onlineDelivery'] = criteria.delivery;
  if (criteria.booking !== undefined) filter['services.tableBooking'] = criteria.booking;

  const nullable = NULLABLE_SORT_FIELD[criteria.sort];
  if (criteria.order === 'asc' && nullable !== undefined) {
    filter[nullable] = { ...(filter[nullable] as Document | undefined), $ne: null };
  }
  return filter;
}

/**
 * The sort document. Every sort ends in _id, so the order is total and a page
 * boundary never splits a tie. Reversing `order` reverses the whole list, ties
 * included, which also lets MongoDB walk the same index backwards.
 *
 * `city` is the exception: cities run in the requested direction, but inside a
 * city the best restaurant is always first (the order of tenant_city_score).
 */
export function buildSort(criteria: ListCriteria): MongoSort {
  const direction = criteria.order === 'asc' ? 1 : -1;
  const tieBreak = criteria.order === defaultOrder(criteria.sort) ? 1 : -1;

  switch (criteria.sort) {
    case 'rating':
      return { 'rating.score': direction, _id: tieBreak };
    case 'averageRating':
      return { 'rating.average': direction, 'rating.votes': direction, _id: tieBreak };
    case 'votes':
      return { 'rating.votes': direction, _id: tieBreak };
    case 'cost':
      return { 'cost.forTwo': direction, _id: tieBreak };
    case 'name':
      return { name: direction, _id: tieBreak };
    case 'city':
      return { 'address.city': direction, 'rating.score': -1, _id: 1 };
    case 'distance':
      throw new Error('distance is ordered by $geoNear, not by a sort document');
  }
}

export function buildMongoListQuery(tenantId: string, criteria: ListCriteria): MongoListQuery {
  const { near } = criteria;
  if (criteria.sort === 'distance' && !near) {
    throw new Error('cannot sort by distance without a point to measure from');
  }

  const filter = buildFilter(tenantId, criteria);
  // One row more than the page, to learn whether another page exists.
  const limit = criteria.limit + 1;

  if (!near) {
    return {
      kind: 'find',
      filter,
      sort: buildSort(criteria),
      skip: criteria.offset,
      limit,
      projection: { ...LIST_PROJECTION },
    };
  }

  const pipeline: Document[] = [
    {
      // Must be the first stage. Its `query` must carry the tenant, or the
      // tenant_location_2dsphere index could not narrow the search to one tenant.
      $geoNear: {
        near: { type: 'Point', coordinates: [near.longitude, near.latitude] },
        distanceField: DISTANCE_FIELD,
        spherical: true,
        ...(near.radiusKm !== undefined ? { maxDistance: Math.round(near.radiusKm * 1000) } : {}),
        query: filter,
      },
    },
  ];
  // $geoNear already returns nearest first, and streams, so a limit stops it early.
  // Restaurants at exactly the same distance (the same coordinates) come back in
  // whatever order the geo index yields. Adding `_id` as a tie-break would need a
  // $sort, which makes MongoDB read every match instead of stopping at the page.
  if (criteria.sort !== 'distance') pipeline.push({ $sort: buildSort(criteria) });
  if (criteria.offset > 0) pipeline.push({ $skip: criteria.offset });
  pipeline.push({ $limit: limit }, { $project: { ...LIST_PROJECTION, [DISTANCE_FIELD]: 1 } });
  return { kind: 'aggregate', pipeline };
}

/**
 * The two aggregations behind the vocabulary: every city and every cuisine of
 * the tenant's active restaurants, with a count. They read the whole tenant
 * once a minute at most (see VocabularyCache).
 */
export function buildVocabularyPipelines(tenantId: string): {
  cities: Document[];
  cuisines: Document[];
} {
  const match = { $match: { tenantId, status: 'active' } };
  return {
    cities: [match, { $group: { _id: '$address.city', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
    cuisines: [
      match,
      { $unwind: '$cuisines' },
      { $group: { _id: '$cuisines', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ],
  };
}
