import { Inject, Injectable } from '@nestjs/common';
import { type Collection, type Db, ObjectId } from 'mongodb';
import { MONGO_DB } from '../database/database.constants';
import { MongoErrorCode, mongoErrorCode } from '../database/mongo-errors';
import { RESTAURANTS_COLLECTION } from '../database/restaurants.collection';
import type { RestaurantDocument } from './restaurant.document';
import {
  DuplicateSourceError,
  type RestaurantStore,
  type StoredRestaurant,
} from './restaurant.store';

type MongoRestaurant = RestaurantDocument & { _id: ObjectId };

/**
 * The RestaurantStore on MongoDB. The only file of the create and fetch path
 * that knows about the driver: it turns the public id (a string) into an
 * ObjectId and back, and turns the unique index's refusal into a
 * DuplicateSourceError.
 */
@Injectable()
export class MongoRestaurantStore implements RestaurantStore {
  private readonly restaurants: Collection<MongoRestaurant>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.restaurants = db.collection<MongoRestaurant>(RESTAURANTS_COLLECTION);
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
}
