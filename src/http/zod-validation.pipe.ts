import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import {
  issuesToFieldErrors,
  validationProblem,
  type ValidationTarget,
} from './problem';

/**
 * Validates a request value against a Zod schema and hands the controller the
 * parsed result (defaults filled in, text tidied). On failure it throws a 400
 * problem that names every faulty field, which the exception filter sends.
 *
 *   @Body(new ZodValidationPipe(createRestaurantSchema)) input: CreateRestaurantInput
 *   @Query(new ZodValidationPipe(listQuerySchema, 'query')) query: ListQuery
 */
export class ZodValidationPipe<S extends z.ZodType>
  implements PipeTransform<unknown, z.output<S>>
{
  constructor(
    private readonly schema: S,
    private readonly target: ValidationTarget = 'body',
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw validationProblem(issuesToFieldErrors(result.error.issues, this.target));
  }
}
