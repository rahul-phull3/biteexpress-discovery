import { Injectable, type PipeTransform } from '@nestjs/common';
import { validationProblem } from '../http/problem';

/**
 * A public restaurant id is a MongoDB ObjectId: exactly 24 hexadecimal
 * characters. The check is spelled out because `new ObjectId(text)` also
 * accepts any 12-character string, which would turn "restaurantXYZ" into an id.
 */
const RESTAURANT_ID = /^[0-9a-fA-F]{24}$/;

/** The id in its canonical lower-case form, or a 400 problem for a malformed one. */
export function parseRestaurantId(value: string): string {
  if (!RESTAURANT_ID.test(value)) {
    throw validationProblem(
      [
        {
          parameter: 'id',
          detail: 'must be a 24-character hexadecimal restaurant id',
        },
      ],
      'The restaurant id is not valid.',
    );
  }
  return value.toLowerCase();
}

/** Use as @Param('id', RestaurantIdPipe) id: string */
@Injectable()
export class RestaurantIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return parseRestaurantId(value);
  }
}
