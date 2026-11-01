import { MAX_COST, MAX_LIMIT, MAX_RADIUS_KM } from './list-query.schema';
import type { ListSort, SortOrder } from './list-sort';
import { countryPhrases } from './supported-countries';
import type { Vocabulary, VocabularyPhrase } from './vocabulary';

/**
 * Reads a sentence such as "best South Indian food in Gurgaon under Rs. 1000
 * for two" and says which parameters of GET /v1/restaurants it means.
 *
 * It is a set of rules, not a model. Every rule is a pattern for one kind of
 * phrase (a price, a rating, a distance, a count, a word for the order, a
 * service), cut out of the sentence when it matches. What is left is looked up
 * in the data's own cities, countries and cuisines. Whatever still remains,
 * apart from filler words, becomes `words`, which must appear in a restaurant's
 * name or locality. The data has cuisines but no dishes, so "vada pav" can only
 * be found where it is part of a name.
 *
 * Pure: no database, no clock. The vocabulary is passed in.
 */

/** The parameters of GET /v1/restaurants that a sentence can set: same names, same types. */
export interface SearchFilters {
  city?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  cuisine?: string[];
  minRating?: number;
  minCost?: number;
  maxCost?: number;
  currency?: string;
  delivery?: boolean;
  booking?: boolean;
  radiusKm?: number;
  sort?: ListSort;
  order?: SortOrder;
  limit?: number;
}

export interface ParsedSearch {
  filters: SearchFilters;
  /** Lower-case words that are none of the above. Each must appear in the name or the locality. */
  words: string[];
  /** The sentence asks for something near the person ("nearest", "near me", "within 2 km"), so a location is needed. */
  locationWanted: boolean;
  /** What was assumed, ignored or cannot be answered, in plain words. */
  notes: string[];
  /** The notes that are about the price phrase, so that a caller that replaces the price can leave them out. */
  priceNotes: string[];
  /** Likewise for the notes about a distance or "near me", for a caller that replaces or drops the radius. */
  radiusNotes: string[];
}

/** More words than this would make a slow query for no gain; the rest are dropped with a note. */
export const MAX_TEXT_WORDS = 6;

/** What "near me" and "nearby" mean: a short walk or ride in a city. */
export const NEAR_ME_KM = 5;

interface Context {
  filters: SearchFilters;
  notes: string[];
  priceNotes: string[];
  radiusNotes: string[];
  locationWanted: boolean;
  price: { min?: number; max?: number; currency?: string };
}

type Match = RegExpMatchArray & { groups?: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Working on the sentence. Every phrase that a rule recognises is replaced by
// spaces of the same length, so the positions of the rest do not move.
// ---------------------------------------------------------------------------

/** Not inside a longer word or number. */
const START = String.raw`(?<![a-z0-9])`;
const END = String.raw`(?![a-z0-9])`;

function prepare(text: string): string {
  const plain = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/₹/g, ' rs ')
    // 1,000 and 1,00,000 are one number.
    .replace(/(\d),(?=\d{2,3}(?!\d))/g, '$1');
  return ` ${plain} `;
}

const blank = (text: string): string => ' '.repeat(text.length);

/**
 * Calls `onMatch` for each match of `pattern`. When it returns text, that text
 * (padded to the length of the match) replaces the match; when it returns
 * undefined the match is left in the sentence.
 */
function consume(work: string, pattern: RegExp, onMatch: (match: Match) => string | undefined): string {
  let result = '';
  let last = 0;
  for (const match of work.matchAll(pattern)) {
    const replacement = onMatch(match);
    if (replacement === undefined) continue;
    const start = match.index ?? 0;
    result += work.slice(last, start) + replacement.padEnd(match[0].length, ' ');
    last = start + match[0].length;
  }
  return result + work.slice(last);
}

const quote = (text: string): string => `"${text.trim().replace(/\s+/g, ' ')}"`;

// ---------------------------------------------------------------------------
// Opening hours: not in the data, so say so instead of searching for the words.
// ---------------------------------------------------------------------------

const OPENING_HOURS = new RegExp(
  `${START}(?:open\\s+(?:now|late|today|tonight|tomorrow|24\\s*(?:hours|hrs|x\\s*7)|on\\s+(?:sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|weekends?))|currently\\s+open|24\\s*(?:hours|hrs|x\\s*7)|24/7|late\\s+night)${END}`,
  'g',
);

function takeOpeningHours(work: string, context: Context): string {
  return consume(work, OPENING_HOURS, (match) => {
    context.notes.push(`Opening hours are not in the data, so ${quote(match[0])} was ignored.`);
    return blank(match[0]);
  });
}

// ---------------------------------------------------------------------------
// A distance: "within 5 km", "2 miles", "500 m away".
// ---------------------------------------------------------------------------

const DISTANCE = new RegExp(
  `${START}(?:(?:within|inside|under|up\\s+to|upto|less\\s+than|at\\s+most|in|around)\\s+)?(?:a\\s+)?(?:radius\\s+of\\s+)?(?<n>\\d+(?:\\.\\d+)?)\\s*(?<unit>km|kms|kilometers?|kilometres?|miles?|mi|meters?|metres?|m)${END}(?:\\s+(?:away|radius|range|from\\s+(?:me|here)))?`,
  'g',
);

const KM_PER_UNIT: Record<string, number> = {
  km: 1, kms: 1, kilometer: 1, kilometers: 1, kilometre: 1, kilometres: 1,
  mile: 1.609344, miles: 1.609344, mi: 1.609344,
  meter: 0.001, meters: 0.001, metre: 0.001, metres: 0.001, m: 0.001,
};

function addRadiusNote(context: Context, note: string): void {
  context.notes.push(note);
  context.radiusNotes.push(note);
}

function takeDistance(work: string, context: Context): string {
  return consume(work, DISTANCE, (match) => {
    const km = Math.round(Number(match.groups?.n) * (KM_PER_UNIT[match.groups?.unit ?? ''] ?? 1) * 1000) / 1000;
    context.locationWanted = true;
    if (context.filters.radiusKm !== undefined || km <= 0) return blank(match[0]);
    if (km > MAX_RADIUS_KM) {
      addRadiusNote(context, `The search radius is limited to ${MAX_RADIUS_KM} km; ${quote(match[0])} was cut to that.`);
    }
    context.filters.radiusKm = Math.min(km, MAX_RADIUS_KM);
    return blank(match[0]);
  });
}

// ---------------------------------------------------------------------------
// A rating: "rated above 4", "4.5 stars and above", "rating of 4+".
// ---------------------------------------------------------------------------

const AT_LEAST = String.raw`(?:at\s+least|atleast|above|over|more\s+than|greater\s+than|minimum|min|not\s+below|no\s+less\s+than|>=|≥|>)`;
const AND_UP = String.raw`(?:\s+(?:and|or)\s+(?:above|up|more|higher|better|over))?`;
const NUMBER_FROM_0_TO_9 = String.raw`(?<n>\d(?:\.\d+)?)`;

const RATING_PATTERNS: RegExp[] = [
  // "rated above 4", "rating of at least 4.5 stars", "rated 4+"
  new RegExp(
    `${START}(?:rated|ratings?|rate|score)\\s*(?:of\\s+|is\\s+|at\\s+)?(?:${AT_LEAST}\\s*)?${NUMBER_FROM_0_TO_9}(?:\\s*\\+|\\s*stars?)?${AND_UP}${END}`,
    'g',
  ),
  // "above 4 stars", "4 stars", "4+ stars", "4 star and above"
  new RegExp(`${START}(?:${AT_LEAST}\\s*)?${NUMBER_FROM_0_TO_9}\\s*(?:\\+\\s*)?stars?${AND_UP}${END}`, 'g'),
  // "4+ rated", "4.5+ rating"
  new RegExp(`${START}${NUMBER_FROM_0_TO_9}\\s*\\+\\s*(?:rated|ratings?)${END}`, 'g'),
];

function takeRating(work: string, context: Context): string {
  let result = work;
  for (const pattern of RATING_PATTERNS) {
    result = consume(result, pattern, (match) => {
      const rating = Number(match.groups?.n);
      if (rating > 5) {
        context.notes.push(`Ratings run from 0 to 5, so ${quote(match[0])} was ignored.`);
      } else if (context.filters.minRating === undefined) {
        context.filters.minRating = rating;
      }
      return blank(match[0]);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// A price: "under Rs. 1000 for two", "between 500 and 1500", "at least $60".
// ---------------------------------------------------------------------------

const CURRENCY = String.raw`(?:rs\.?|rupees?|inr|\$|usd|dollars?|£|gbp|pounds?|dirhams?|aed|aud|brl|cad|idr|nzd|php|qar|sgd|zar|lkr)`;

const CURRENCY_OF: Record<string, string> = {
  rs: 'INR', rupee: 'INR', rupees: 'INR', inr: 'INR',
  $: 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD',
  '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP',
  aed: 'AED', dirham: 'AED', dirhams: 'AED',
  aud: 'AUD', brl: 'BRL', cad: 'CAD', idr: 'IDR', nzd: 'NZD',
  php: 'PHP', qar: 'QAR', sgd: 'SGD', zar: 'ZAR', lkr: 'LKR',
};

/** One amount of money, with an optional currency before or after it. `n` keeps the group names apart. */
const money = (n: string): string =>
  String.raw`(?:(?<c${n}a>${CURRENCY})\s*)?(?<n${n}>\d+(?:\.\d+)?)(?:\s*(?<k${n}>k|thousand)(?![a-z]))?(?:\s*(?<c${n}b>${CURRENCY})${END})?`;

/** The cost in the data is for two people, so "per person" doubles the amount. */
const PER_PERSON = String.raw`(?<pp>\s*(?:/|per\s+|a\s+|each\s+)(?:person|head|pax|plate|guest|diner)(?![a-z]))?`;
const FOR_TWO = String.raw`(?<two>\s+for\s+(?:two|2)(?:\s+(?:people|persons|pax|diners))?${END})?`;
/** A number followed by one of these is not a price ("under 30 minutes"). */
const NOT_A_PRICE = String.raw`(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|stars?|percent|%|km|kms|kilometers?|kilometres?|miles?|years?|yrs?))`;

const RANGE = new RegExp(
  `(?<![a-z0-9$£])(?:(?<kw>between|from)\\s+)?${money('1')}\\s*(?:-|to|and)\\s*${money('2')}${NOT_A_PRICE}${PER_PERSON}${FOR_TWO}${END}`,
  'g',
);

type BoundKind = 'maxExclusive' | 'maxInclusive' | 'minExclusive' | 'minInclusive';

const BOUND_WORDS: Array<[BoundKind, string]> = [
  ['maxInclusive', String.raw`up\s+to|upto|within|at\s+most|at\s+max|max(?:imum)?|not\s+more\s+than|no\s+more\s+than|budget\s+of|budget|<=|≤`],
  ['maxExclusive', String.raw`under|below|less\s+than|lesser\s+than|cheaper\s+than|fewer\s+than|<`],
  ['minExclusive', String.raw`over|above|more\s+than|greater\s+than|exceeding|costlier\s+than|pricier\s+than|>`],
  ['minInclusive', String.raw`at\s+least|atleast|min(?:imum)?|not\s+less\s+than|no\s+less\s+than|starting\s+(?:at|from)|from|>=|≥`],
];

const BOUND = new RegExp(
  `(?<![a-z0-9$£])(?<kw>${BOUND_WORDS.map(([, words]) => words).join('|')})\\s*${money('1')}${NOT_A_PRICE}${PER_PERSON}${FOR_TWO}${END}`,
  'g',
);

/** "Rs. 1000 for two" with no word such as "under" in front. */
const BARE = new RegExp(
  `(?<![a-z0-9$£])${money('1')}${NOT_A_PRICE}${PER_PERSON}${FOR_TWO}${END}`,
  'g',
);

function boundKindOf(keyword: string): BoundKind {
  const word = keyword.replace(/\s+/g, ' ');
  const found = BOUND_WORDS.find(([, words]) => new RegExp(`^(?:${words})$`).test(word));
  return found ? found[0] : 'maxInclusive';
}

function currencyOf(token: string | undefined): string | undefined {
  return token === undefined ? undefined : CURRENCY_OF[token.replace(/\.$/, '')];
}

function amountOf(groups: Record<string, string | undefined>, n: string, factor: number): number {
  return Number(groups[`n${n}`]) * (groups[`k${n}`] ? 1000 : 1) * factor;
}

function currencyIn(groups: Record<string, string | undefined>, ...ns: string[]): string | undefined {
  for (const n of ns) {
    const found = currencyOf(groups[`c${n}a`]) ?? currencyOf(groups[`c${n}b`]);
    if (found) return found;
  }
  return undefined;
}

/** Costs are whole numbers, so "under 1000" is "at most 999". */
function setPrice(context: Context, bounds: { min?: number; max?: number }, currency: string | undefined): void {
  const { price } = context;
  const fits = (value: number) => value <= MAX_COST;
  if (bounds.min !== undefined && price.min === undefined) {
    if (fits(bounds.min)) price.min = Math.max(0, bounds.min);
    else addPriceNote(context, `An amount above ${MAX_COST} was ignored.`);
  }
  if (bounds.max !== undefined && price.max === undefined) {
    if (fits(bounds.max)) price.max = Math.max(0, bounds.max);
    else addPriceNote(context, `An amount above ${MAX_COST} was ignored.`);
  }
  if (currency !== undefined && price.currency === undefined) price.currency = currency;
}

function addPriceNote(context: Context, note: string): void {
  if (context.notes.includes(note)) return;
  context.notes.push(note);
  context.priceNotes.push(note);
}

/** "Rs. 500 per person" is "Rs. 1000 for two", which is how the data states a cost. */
function notePerPerson(context: Context): void {
  addPriceNote(context, 'Costs in the data are for two people, so an amount per person was doubled.');
}

function takePrice(work: string, context: Context): string {
  let result = consume(work, RANGE, (match) => {
    const groups = match.groups ?? {};
    const currency = currencyIn(groups, '1', '2');
    // "3 to 4" or "10 and 20" mean nothing without a word or a unit that makes them money.
    if (!groups.kw && !currency && !groups.two && !groups.pp) return undefined;
    const factor = groups.pp ? 2 : 1;
    if (groups.pp) notePerPerson(context);
    const [low, high] = [amountOf(groups, '1', factor), amountOf(groups, '2', factor)].sort((a, b) => a - b);
    setPrice(context, { min: Math.ceil(low ?? 0), max: Math.floor(high ?? 0) }, currency);
    return blank(match[0]);
  });

  result = consume(result, BOUND, (match) => {
    const groups = match.groups ?? {};
    const currency = currencyIn(groups, '1');
    const factor = groups.pp ? 2 : 1;
    if (groups.pp) notePerPerson(context);
    const value = amountOf(groups, '1', factor);
    // A bare small number after "over" or "under" is more likely a rating or a count than a price.
    if (!currency && !groups.two && !groups.pp && value < 10) return undefined;
    switch (boundKindOf(groups.kw ?? '')) {
      case 'maxExclusive':
        setPrice(context, { max: Math.ceil(value) - 1 }, currency);
        break;
      case 'maxInclusive':
        setPrice(context, { max: Math.floor(value) }, currency);
        break;
      case 'minExclusive':
        setPrice(context, { min: Math.floor(value) + 1 }, currency);
        break;
      case 'minInclusive':
        setPrice(context, { min: Math.ceil(value) }, currency);
        break;
    }
    return blank(match[0]);
  });

  return consume(result, BARE, (match) => {
    const groups = match.groups ?? {};
    const currency = currencyIn(groups, '1');
    if (!currency) return undefined;
    if (groups.pp) notePerPerson(context);
    setPrice(context, { max: Math.floor(amountOf(groups, '1', groups.pp ? 2 : 1)) }, currency);
    addPriceNote(context, `${quote(match[0])} has no "under" or "over", so it was read as a maximum.`);
    return blank(match[0]);
  });
}

/** Called once the whole sentence has been read: the price becomes filters, or a note says why not. */
function finishPrice(context: Context): void {
  const { min, max, currency } = context.price;
  if (min !== undefined && max !== undefined && min > max) {
    addPriceNote(context, `The price bounds contradict each other (at least ${min}, at most ${max}), so both were ignored.`);
    return;
  }
  if (min === undefined && max === undefined) return;
  if (min !== undefined) context.filters.minCost = min;
  if (max !== undefined) context.filters.maxCost = max;
  if (currency !== undefined) {
    context.filters.currency = currency;
  } else {
    addPriceNote(context, "The text names no currency, so the amount is compared in each restaurant's own currency.");
  }
}

// ---------------------------------------------------------------------------
// A count: "top 5", "5 best", "show 10", "3 restaurants".
// ---------------------------------------------------------------------------

const SORT_KEYWORDS = String.raw`top|best|nearest|closest|cheapest|most\s+popular`;

const COUNT_AFTER = new RegExp(`${START}(?<kw>${SORT_KEYWORDS}|first)\\s+(?<n>\\d{1,3})${END}`, 'g');
const COUNT_BEFORE = new RegExp(`${START}(?<n>\\d{1,3})\\s+(?<kw>${SORT_KEYWORDS})${END}`, 'g');
const COUNT_PLAIN = new RegExp(
  `${START}(?:(?:show|give|list|find|get)(?:\\s+me)?\\s+)?(?<n>\\d{1,3})\\s+(?:restaurants?|places?|spots?|options?|eateries|joints?)${END}`,
  'g',
);

function takeCount(work: string, context: Context): string {
  const setLimit = (match: Match): void => {
    const count = Number(match.groups?.n);
    if (count < 1 || context.filters.limit !== undefined) return;
    if (count > MAX_LIMIT) {
      context.notes.push(`At most ${MAX_LIMIT} restaurants come back at a time; ${quote(match[0])} was cut to that. Use offset for the next ones.`);
    }
    context.filters.limit = Math.min(count, MAX_LIMIT);
  };
  // "top 5" keeps its "top", which still has to say that the order is by rating.
  const keepKeyword = (match: Match): string => {
    setLimit(match);
    return match.groups?.kw ?? '';
  };

  let result = consume(work, COUNT_AFTER, keepKeyword);
  result = consume(result, COUNT_BEFORE, keepKeyword);
  return consume(result, COUNT_PLAIN, (match) => {
    setLimit(match);
    return blank(match[0]);
  });
}

// ---------------------------------------------------------------------------
// Words for the order of the results: "best", "nearest", "cheapest", "popular".
// ---------------------------------------------------------------------------

interface SortRule {
  pattern: RegExp;
  sort: ListSort;
  order?: SortOrder;
}

const wholeWord = (alternatives: string): RegExp => new RegExp(`${START}(?:${alternatives})${END}`, 'g');

const SORT_RULES: SortRule[] = [
  { pattern: wholeWord('nearest|closest'), sort: 'distance' },
  { pattern: wholeWord('cheapest|cheap|inexpensive|affordable|economical|low[\\s-]cost|budget[\\s-]friendly|pocket[\\s-]friendly'), sort: 'cost' },
  { pattern: wholeWord('most\\s+expensive|priciest|costliest|expensive|pricey'), sort: 'cost', order: 'desc' },
  { pattern: wholeWord('most\\s+popular|popular|most\\s+reviewed|most\\s+voted'), sort: 'votes' },
  {
    pattern: wholeWord('(?:best|top|highest|highly|well)[\\s-]rated|best|top|finest|greatest'),
    sort: 'rating',
  },
];

function takeSortWords(work: string, context: Context): string {
  const hits = SORT_RULES.flatMap((rule) =>
    [...work.matchAll(rule.pattern)].map((match) => ({
      rule,
      text: match[0],
      start: match.index ?? 0,
    })),
  )
    // Left to right. A phrase that starts inside one already chosen is skipped below:
    // "most expensive" is taken whole, so its "expensive" is not read again.
    .sort((a, b) => a.start - b.start);

  let result = work;
  let covered = -1;
  const chosen: typeof hits = [];
  for (const hit of hits) {
    if (hit.start < covered) continue;
    covered = hit.start + hit.text.length;
    chosen.push(hit);
    result = result.slice(0, hit.start) + blank(hit.text) + result.slice(covered);
  }

  const first = chosen[0];
  if (first === undefined) return result;
  context.filters.sort = first.rule.sort;
  if (first.rule.order !== undefined) context.filters.order = first.rule.order;
  if (first.rule.sort === 'distance') context.locationWanted = true;
  for (const other of chosen.slice(1)) {
    if (other.rule.sort !== first.rule.sort || other.rule.order !== first.rule.order) {
      context.notes.push(`Only one order can apply, so ${quote(other.text)} was ignored in favour of ${quote(first.text)}.`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Services: "with online delivery", "table booking", "without delivery".
// ---------------------------------------------------------------------------

const DELIVERY = new RegExp(
  `${START}(?:(?<no>no|without|non)[\\s-]+)?(?:online\\s+|home\\s+)?deliver(?:y|ies|s|ing)?${END}`,
  'g',
);
const BOOKING = new RegExp(
  `${START}(?:(?<no>no|without|non)[\\s-]+)?(?:table\\s+(?:booking|bookings|reservations?)|book(?:ing)?\\s+(?:a\\s+)?table|reservations?|bookings?|bookable)${END}`,
  'g',
);

function takeServices(work: string, context: Context): string {
  const result = consume(work, DELIVERY, (match) => {
    context.filters.delivery ??= match.groups?.no === undefined;
    return blank(match[0]);
  });
  return consume(result, BOOKING, (match) => {
    context.filters.booking ??= match.groups?.no === undefined;
    return blank(match[0]);
  });
}

// ---------------------------------------------------------------------------
// "near me" and the like: they need a location, and mean a short distance from it.
// ---------------------------------------------------------------------------

const NEAR_ME = wholeWord(
  'nearby|near\\s*by|near\\s+(?:me|here|my\\s+location)|close\\s*by|close\\s+to\\s+(?:me|here)|around\\s+(?:me|here)|next\\s+to\\s+me',
);

function takeNearMe(work: string, context: Context): string {
  return consume(work, NEAR_ME, (match) => {
    context.locationWanted = true;
    // "Near me" is a distance too, unless the sentence gave another one or asks for the nearest, which has no limit.
    if (context.filters.radiusKm === undefined && context.filters.sort !== 'distance') {
      context.filters.radiusKm = NEAR_ME_KM;
      addRadiusNote(context, `${quote(match[0])} was read as within ${NEAR_ME_KM} km.`);
    }
    return blank(match[0]);
  });
}

/** "for two" is how the cost is measured, not something to look for. */
const FOR_TWO_ALONE = new RegExp(`${START}for\\s+(?:two|2)(?:\\s+(?:people|persons|pax|diners))?${END}`, 'g');

// ---------------------------------------------------------------------------
// Places and cuisines: looked up in the words of the data.
// ---------------------------------------------------------------------------

interface Token {
  /** As written, lower case. */
  raw: string;
  /** For comparing: without accents, apostrophes and a plural s. */
  key: string;
  used: boolean;
}

const TOKEN = /[\p{L}\p{N}]+(?:['][\p{L}\p{N}]+)*/gu;

/** "restaurants" and "restaurant", "cafes" and "cafe", "bakeries" and "bakery" are the same word. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function compareKey(raw: string): string {
  return stem(raw.normalize('NFD').replace(/\p{M}/gu, '').replace(/'/g, ''));
}

function tokenize(text: string): Token[] {
  return [...text.toLowerCase().matchAll(TOKEN)].map(([raw]) => ({ raw, key: compareKey(raw), used: false }));
}

interface PhraseIndex {
  /** The keys of a phrase's words joined by a space, to the name the data uses. */
  names: Map<string, string>;
  /** The most words in any phrase. */
  longest: number;
}

function buildIndex(phrases: readonly VocabularyPhrase[]): PhraseIndex {
  const names = new Map<string, string>();
  let longest = 1;
  for (const { phrase, name } of phrases) {
    const keys = tokenize(phrase).map((token) => token.key);
    if (keys.length === 0) continue;
    const joined = keys.join(' ');
    if (!names.has(joined)) names.set(joined, name);
    longest = Math.max(longest, keys.length);
  }
  return { names, longest };
}

/** Takes the names out of the tokens, left to right, the longest phrase first at each position. */
function takeNames(tokens: Token[], index: PhraseIndex): string[] {
  const found: string[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start]?.used) continue;
    for (let length = Math.min(index.longest, tokens.length - start); length >= 1; length -= 1) {
      const slice = tokens.slice(start, start + length);
      if (slice.some((token) => token.used)) continue;
      const name = index.names.get(slice.map((token) => token.key).join(' '));
      if (name === undefined) continue;
      for (const token of slice) token.used = true;
      found.push(name);
      start += length - 1;
      break;
    }
  }
  return found;
}

const COUNTRIES = buildIndex(countryPhrases().map(({ phrase, code }) => ({ phrase, name: code })));

/** The vocabulary is cached for a minute by the service, so its index is built once per load, not per request. */
const INDEXES = new WeakMap<Vocabulary, { cities: PhraseIndex; cuisines: PhraseIndex }>();

function indexesOf(vocabulary: Vocabulary): { cities: PhraseIndex; cuisines: PhraseIndex } {
  let indexes = INDEXES.get(vocabulary);
  if (!indexes) {
    indexes = { cities: buildIndex(vocabulary.cityPhrases()), cuisines: buildIndex(vocabulary.cuisinePhrases()) };
    INDEXES.set(vocabulary, indexes);
  }
  return indexes;
}

function takePlaces(tokens: Token[], vocabulary: Vocabulary, context: Context): void {
  const indexes = indexesOf(vocabulary);

  const [city, ...otherCities] = takeNames(tokens, indexes.cities);
  if (city !== undefined) context.filters.city = city;
  if (otherCities.length > 0) {
    context.notes.push(`More than one city was named; ${city} was used and ${otherCities.join(', ')} was ignored.`);
  }

  const [country, ...otherCountries] = takeNames(tokens, COUNTRIES);
  if (country !== undefined) context.filters.country = country;
  if (otherCountries.length > 0) {
    context.notes.push(`More than one country was named; ${country} was used and ${otherCountries.join(', ')} was ignored.`);
  }

  const cuisines = [...new Set(takeNames(tokens, indexes.cuisines))];
  if (cuisines.length > 0) context.filters.cuisine = cuisines.slice(0, 20);
}

// ---------------------------------------------------------------------------
// What is left.
// ---------------------------------------------------------------------------

/** Words that carry no search: articles, prepositions, "restaurants", "food", "please". */
const STOP_WORDS: ReadonlySet<string> = new Set(
  `a an the and or but of in on at by to from with without within for into
   is are was were be been am do does did has have had having
   i me my we us our you your it its this that these those which who whom whose what where when how there here
   please can could would should will may might also just only some any all more most very really quite
   find show list give get got display search looking look want need like love
   restaurant restaurants place places spot spots joint joints eatery eateries outlet outlets
   food foods dish dishes eat eating dine dining meal meals lunch dinner brunch supper
   serve serves served serving offer offers offering provide provides providing sell sells selling
   good great nice decent tasty delicious yummy authentic famous
   near around about over under than less first top best rated rating ratings star stars
   cost costs costing priced price prices pricing average avg per person people persons pax head
   table tables ncr not no far away take takes taking accept accepts accepting both either plus etc few many much lot lots`
    .split(/\s+/)
    .filter(Boolean),
);

function leftoverWords(tokens: Token[], context: Context): string[] {
  const words = [
    ...new Set(
      tokens
        .filter((token) => !token.used)
        .map((token) => token.raw)
        .filter((raw) => !STOP_WORDS.has(raw) && (raw.length > 1 || /\d/.test(raw))),
    ),
  ];
  if (words.length > MAX_TEXT_WORDS) {
    context.notes.push(
      `Only the first ${MAX_TEXT_WORDS} unrecognised words are used; ${words.slice(MAX_TEXT_WORDS).map(quote).join(', ')} was left out.`,
    );
  }
  return words.slice(0, MAX_TEXT_WORDS);
}

/** Turns a sentence into search parameters. See the top of this file for the rules. */
export function parseSearchText(text: string, vocabulary: Vocabulary): ParsedSearch {
  const context: Context = { filters: {}, notes: [], priceNotes: [], radiusNotes: [], locationWanted: false, price: {} };

  let work = prepare(text);
  // Order matters: a phrase with a unit ("5 km", "4 stars") must go before a bare number could be a price.
  work = takeOpeningHours(work, context);
  work = takeDistance(work, context);
  work = takeRating(work, context);
  work = takePrice(work, context);
  work = takeCount(work, context);
  work = takeSortWords(work, context);
  work = takeServices(work, context);
  work = takeNearMe(work, context);
  work = work.replace(FOR_TWO_ALONE, (match) => blank(match));

  const tokens = tokenize(work);
  takePlaces(tokens, vocabulary, context);
  const words = leftoverWords(tokens, context);
  finishPrice(context);

  if (words.length > 0) {
    context.notes.push(
      `${words.map(quote).join(', ')} ${words.length === 1 ? 'is' : 'are'} not a city, country, cuisine or filter, so ${words.length === 1 ? 'it' : 'each word'} must appear in a restaurant's name or area. The data has no menu items to search.`,
    );
  }
  if (words.length === 0 && Object.keys(context.filters).length === 0 && context.notes.length === 0) {
    context.notes.push('Nothing in the text was recognised as a place, cuisine or filter, so no filter was applied.');
  }
  return {
    filters: context.filters,
    words,
    locationWanted: context.locationWanted,
    notes: context.notes,
    priceNotes: context.priceNotes,
    radiusNotes: context.radiusNotes,
  };
}
