import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MongoRestaurantStore } from './mongo-restaurant.store';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { RESTAURANT_STORE } from './restaurant.store';

@Module({
  imports: [DatabaseModule],
  controllers: [RestaurantsController],
  providers: [
    RestaurantsService,
    { provide: RESTAURANT_STORE, useClass: MongoRestaurantStore },
  ],
})
export class RestaurantsModule {}
