import { Inject, Injectable } from '@nestjs/common';
import { type Collection, type Db, type Document, ObjectId } from 'mongodb';
import { MONGO_DB } from '../database/database.constants';
import { MongoErrorCode, mongoErrorCode } from '../database/mongo-errors';
import { RESTAURANTS_COLLECTION } from '../database/restaurants.collection';
import type { ListCriteria } from './list-criteria';
import { buildMongoListQuery, buildVocabularyPipelines } from './mongo-list-query';
import type { RestaurantDocument } from './restaurant.document';
import {
  DuplicateSourceError,
  type ListedFields,
  type ListedRestaurant,
  type ListResult,
  type RestaurantStore,
  type StoredRestaurant,
} from './restaurant.store';
import type { VocabularyData } from './vocabulary';

type MongoRestaurant = RestaurantDocument & { _id: ObjectId };

/** A row of a listing as MongoDB returns it: the projected fields, the _id and, after $geoNear, the distance. */
type ListRow = ListedFields & { _id: ObjectId; distanceMeters?: number };

/** A row of a $group on a name. */
type CountRow = { _id: string; count: number };

/**
 * The RestaurantStore on MongoDB. The only file of the restaurant path that
 * knows about the driver: it turns the public id (a string) into an ObjectId
 * and back, turns the unique index's refusal into a DuplicateSourceError, and
 * runs the queries that mongo-list-query.ts builds.
 */
@Injectable()
export class MongoRestaurantStore implements RestaurantStore {
  private readonly restaurants: Collection<MongoRestaurant>;
  /** The same collection, typed loosely for the queries that are built as plain documents. */
  private readonly queries: Collection<Document>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.restaurants = db.collection<MongoRestaurant>(RESTAURANTS_COLLECTION);
    this.queries = db.collection<Document>(RESTAURANTS_COLLECTION);
  }

  async insert(doc: RestaurantDocument): Promise<StoredRestaurant> {
    const _id = new ObjectId();
    try {
      await this.restaurants.insertOne({ _id, ...doc });
    } catch (error) {
      // 11000 can only come from the tenant_source_unique index here: _id is
      // freshly generated, and a restaurant without a source is not in that index.
      if (mongoErrorCode(error) === MongoErrorCode.DuplicateKey && doc.source) {
        throw new DuplicateSourceError(doc.source);
      }
      throw error;
    }
    return { id: _id.toHexString(), doc };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<StoredRestaurant | null> {
    // tenantId is part of the filter, so one tenant can never read another's restaurant.
    const found = await this.restaurants.findOne({
      _id: new ObjectId(id),
      tenantId,
    });
    if (!found) return null;
    const { _id, ...doc } = found;
    return { id: _id.toHexString(), doc: doc as RestaurantDocument };
  }

  async list(tenantId: string, criteria: ListCriteria): Promise<ListResult> {
    const query = buildMongoListQuery(tenantId, criteria);
    const rows =
      query.kind === 'find'
        ? await this.queries
            .find<ListRow>(query.filter, { projection: query.projection })
            .sort(query.sort)
            .skip(query.skip)
            .limit(query.limit)
            .toArray()
        : await this.queries.aggregate<ListRow>(query.pipeline).toArray();

    // The query asked for one row more than the page.
    return {
      items: rows.slice(0, criteria.limit).map(toListed),
      hasMore: rows.length > criteria.limit,
    };
  }

  async vocabulary(tenantId: string): Promise<VocabularyData> {
    const pipelines = buildVocabularyPipelines(tenantId);
    const [cities, cuisines] = await Promise.all([
      this.queries.aggregate<CountRow>(pipelines.cities).toArray(),
      this.queries.aggregate<CountRow>(pipelines.cuisines).toArray(),
    ]);
    const named = ({ _id, count }: CountRow) => ({ name: _id, count });
    return { cities: cities.map(named), cuisines: cuisines.map(named) };
  }
}

/** Distances are kept to 10 metres: the position of a restaurant is not more exact than that. */
function toListed(row: ListRow): ListedRestaurant {
  const { _id, distanceMeters, ...doc } = row;
  return {
    id: _id.toHexString(),
    doc,
    ...(distanceMeters !== undefined
      ? { distanceKm: Math.round(distanceMeters / 10) / 100 }
      : {}),
  };
}
