import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { API_PREFIX } from '../http/api-prefix';
import { TenantId } from '../http/tenant';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  createRestaurantSchema,
  type CreateRestaurantInput,
} from './create-restaurant.schema';
import {
  listQuerySchema,
  searchQuerySchema,
  type ListQuery,
  type SearchQuery,
} from './list-query.schema';
import { RestaurantIdPipe } from './restaurant-id';
import type { RestaurantListResponse } from './restaurant.list-item';
import type { RestaurantSearchResponse } from './restaurant.search-response';
import type { RestaurantResource } from './restaurant.resource';
import { RestaurantsService } from './restaurants.service';

/** The only member of the response these handlers use. */
interface HeaderWriter {
  setHeader(name: string, value: string): unknown;
}

/**
 * How long an app may reuse a fetched restaurant without asking again. Express
 * adds an ETag to every body, so a repeat request after this window sends
 * If-None-Match and gets a body-less 304 while nothing changed. `private`
 * because the answer depends on the tenant; switch to `public` once the
 * tenant comes from the host name and a CDN may share the answer.
 */
const DETAIL_CACHE_CONTROL = 'private, max-age=30';

/**
 * Listings change whenever a restaurant is added, so an app may reuse one for
 * only 15 seconds. During a rush that still absorbs the repeated "restaurants
 * near me" taps of one app. (No ETag revalidation to speak of: the body carries
 * `tookMs`, which differs every time.) Set it to 'no-cache' to switch caching off.
 */
const LIST_CACHE_CONTROL = 'private, max-age=15';

/**
 * ROUTE ORDER: paths with a fixed word (search, bulk, by-source) are declared
 * above `:id`. Express matches in declaration order, and `:id` would
 * otherwise swallow the word "search" as an id.
 */
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(createRestaurantSchema))
    input: CreateRestaurantInput,
    @Res({ passthrough: true }) res: HeaderWriter,
  ): Promise<RestaurantResource> {
    const restaurant = await this.restaurants.create(tenantId, input);
    res.setHeader('Location', `/${API_PREFIX}/restaurants/${restaurant.id}`);
    return restaurant;
  }

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listQuerySchema, 'query')) query: ListQuery,
    @Res({ passthrough: true }) res: HeaderWriter,
  ): Promise<RestaurantListResponse> {
    const page = await this.restaurants.list(tenantId, query);
    // Set after the query, so an error response is never cached.
    res.setHeader('Cache-Control', LIST_CACHE_CONTROL);
    res.setHeader('Vary', 'X-Tenant-Id');
    return page;
  }

  /** The list, with a sentence in `q`. Above `:id`, which would take "search" for an id. */
  @Get('search')
  async search(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(searchQuerySchema, 'query')) query: SearchQuery,
    @Res({ passthrough: true }) res: HeaderWriter,
  ): Promise<RestaurantSearchResponse> {
    const response = await this.restaurants.search(tenantId, query);
    // Set after the search, so an error response is never cached.
    res.setHeader('Cache-Control', LIST_CACHE_CONTROL);
    res.setHeader('Vary', 'X-Tenant-Id');
    return response;
  }

  @Get(':id')
  async get(
    @TenantId() tenantId: string,
    @Param('id', RestaurantIdPipe) id: string,
    @Res({ passthrough: true }) res: HeaderWriter,
  ): Promise<RestaurantResource> {
    const restaurant = await this.restaurants.get(tenantId, id);
    // Set after the lookup, so an error response is never cached.
    res.setHeader('Cache-Control', DETAIL_CACHE_CONTROL);
    res.setHeader('Vary', 'X-Tenant-Id');
    return restaurant;
  }
}
