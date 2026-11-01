import type { ListCriteria } from '../../src/restaurants/list-criteria';
import type { RestaurantDocument } from '../../src/restaurants/restaurant.document';
import type {
  ListedFields,
  ListedRestaurant,
  ListResult,
  StoredRestaurant,
} from '../../src/restaurants/restaurant.store';
import type { VocabularyData } from '../../src/restaurants/vocabulary';

/**
 * The listing rules, written a second time on plain arrays. The MongoDB store
 * gets them from a query; this stand-in gets them from filter and sort. They
 * share no code on purpose: restaurant-store.contract.ts runs the same checks
 * against both, so a rule that one of them gets wrong shows up as a failure.
 */

const EARTH_RADIUS_KM = 6378.1;

/** Great-circle distance (haversine), with the radius MongoDB uses for 2dsphere. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

type Value = number | string | null;

/** A restaurant that passed the filters, with its distance when the listing has a point. */
interface Candidate {
  row: StoredRestaurant;
  meters?: number;
}

/** MongoDB's order for the values used here: null (and missing) before numbers and strings. */
function compareValues(a: Value, b: Value): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** The value a sort looks at, null when the restaurant has none. */
const SORT_VALUE = {
  rating: (doc: RestaurantDocument): Value => doc.rating?.score ?? null,
  averageRating: (doc: RestaurantDocument): Value => doc.rating?.average ?? null,
  votes: (doc: RestaurantDocument): Value => doc.rating?.votes ?? null,
  cost: (doc: RestaurantDocument): Value => doc.cost?.forTwo ?? null,
  name: (doc: RestaurantDocument): Value => doc.name,
} as const;

function matches(doc: RestaurantDocument, tenantId: string, c: ListCriteria): boolean {
  if (doc.tenantId !== tenantId || doc.status !== 'active') return false;
  if (c.city !== undefined && doc.address.city !== c.city) return false;
  if (c.countryCode !== undefined && doc.address.country.code !== c.countryCode) return false;
  if (c.nameContains !== undefined && !doc.name.toLowerCase().includes(c.nameContains.toLowerCase())) {
    return false;
  }
  if (c.textWords !== undefined) {
    const places = [doc.name, doc.address.locality ?? ''].map((place) => place.toLowerCase());
    const found = (word: string) => places.some((place) => place.includes(word.toLowerCase()));
    if (!c.textWords.every(found)) return false;
  }
  if (c.cuisines !== undefined) {
    const wanted = c.cuisines;
    const serves = (cuisine: string) => doc.cuisines.includes(cuisine);
    if (!(c.cuisineMatch === 'all' ? wanted.every(serves) : wanted.some(serves))) return false;
  }
  if (c.minRating !== undefined) {
    const average = doc.rating?.average ?? null;
    if (average === null || average < c.minRating) return false;
  }
  if (c.minCost !== undefined || c.maxCost !== undefined) {
    const forTwo = doc.cost?.forTwo ?? null;
    if (forTwo === null) return false;
    if (c.minCost !== undefined && forTwo < c.minCost) return false;
    if (c.maxCost !== undefined && forTwo > c.maxCost) return false;
  }
  if (c.currency !== undefined && doc.cost?.currency !== c.currency) return false;
  if (c.priceRange !== undefined && doc.cost?.priceRange !== c.priceRange) return false;
  if (c.delivery !== undefined && doc.services.onlineDelivery !== c.delivery) return false;
  if (c.booking !== undefined && doc.services.tableBooking !== c.booking) return false;

  // An ascending sort leaves out restaurants that lack the value it sorts by.
  if (c.order === 'asc' && c.sort in SORT_VALUE) {
    const value = SORT_VALUE[c.sort as keyof typeof SORT_VALUE](doc);
    if (value === null) return false;
  }
  return true;
}

/**
 * Sorts in the direction people mean by default (best first, cheapest first,
 * A to Z), ties by id; when the request asks for the other direction, the
 * whole list is reversed. That is the rule "reversing the order reverses the
 * list, ties included". City is the exception: cities run in the requested
 * direction and the best restaurant is first inside each.
 */
function ordered(candidates: Candidate[], c: ListCriteria): Candidate[] {
  const byId = (a: Candidate, b: Candidate) => compareValues(a.row.id, b.row.id);

  if (c.sort === 'distance') {
    // Nearest first; restaurants at the same distance stay in storage order (the sort is stable).
    return [...candidates].sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  }

  if (c.sort === 'city') {
    const direction = c.order === 'asc' ? 1 : -1;
    return [...candidates].sort(
      (a, b) =>
        direction * compareValues(a.row.doc.address.city, b.row.doc.address.city) ||
        -compareValues(SORT_VALUE.rating(a.row.doc), SORT_VALUE.rating(b.row.doc)) ||
        byId(a, b),
    );
  }

  const value = SORT_VALUE[c.sort];
  const bestFirst = c.sort === 'rating' || c.sort === 'averageRating' || c.sort === 'votes';
  const sign = bestFirst ? -1 : 1;
  const canonical = [...candidates].sort((a, b) => {
    let result = sign * compareValues(value(a.row.doc), value(b.row.doc));
    if (result === 0 && c.sort === 'averageRating') {
      result = -compareValues(SORT_VALUE.votes(a.row.doc), SORT_VALUE.votes(b.row.doc));
    }
    return result || byId(a, b);
  });
  const defaultOrder = bestFirst ? 'desc' : 'asc';
  return c.order === defaultOrder ? canonical : canonical.reverse();
}

function toListed({ row, meters }: Candidate): ListedRestaurant {
  const { name, address, cuisines, cost, rating } = row.doc;
  // Only the fields the restaurant has, as MongoDB's projection would return them.
  const fields: ListedFields = {
    name,
    address,
    cuisines,
    ...(cost ? { cost } : {}),
    ...(rating ? { rating } : {}),
  };
  return {
    id: row.id,
    doc: structuredClone(fields),
    ...(meters !== undefined ? { distanceKm: Math.round(meters / 10) / 100 } : {}),
  };
}

export function listFrom(rows: StoredRestaurant[], tenantId: string, c: ListCriteria): ListResult {
  if (c.sort === 'distance' && !c.near) {
    throw new Error('cannot sort by distance without a point to measure from');
  }

  let candidates: Candidate[] = rows
    .filter((row) => matches(row.doc, tenantId, c))
    .map((row) => ({ row }));

  if (c.near) {
    const { latitude, longitude, radiusKm } = c.near;
    candidates = candidates.flatMap(({ row }) => {
      const coordinates = row.doc.location?.coordinates;
      // A restaurant with unknown coordinates is never near anything.
      if (!coordinates) return [];
      const meters = haversineKm(latitude, longitude, coordinates[1], coordinates[0]) * 1000;
      return radiusKm !== undefined && meters > radiusKm * 1000 ? [] : [{ row, meters }];
    });
  }

  const sorted = ordered(candidates, c);
  const end = c.offset + c.limit;
  return { items: sorted.slice(c.offset, end).map(toListed), hasMore: sorted.length > end };
}

export function vocabularyFrom(rows: StoredRestaurant[], tenantId: string): VocabularyData {
  const active = rows.filter((row) => row.doc.tenantId === tenantId && row.doc.status === 'active');
  const count = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts]
      .map(([name, total]) => ({ name, count: total }))
      .sort((a, b) => compareValues(a.name, b.name));
  };
  return {
    cities: count(active.map((row) => row.doc.address.city)),
    cuisines: count(active.flatMap((row) => row.doc.cuisines)),
  };
}
