import { z } from 'zod';
import { ProblemException } from './problem';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.strictObject({
  name: z.string().trim().min(1, 'must not be empty'),
  limit: z.number().int().default(10),
});

function problemOf(action: () => unknown): ProblemException['problem'] {
  try {
    action();
  } catch (error) {
    if (error instanceof ProblemException) return error.problem;
    throw error;
  }
  throw new Error('expected a ProblemException');
}

describe('ZodValidationPipe', () => {
  it('returns the parsed value with defaults applied and text tidied', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ name: '  Bukhara ' })).toEqual({ name: 'Bukhara', limit: 10 });
  });

  it('throws one 400 problem that lists every faulty field of a body', () => {
    const pipe = new ZodValidationPipe(schema);

    const problem = problemOf(() => pipe.transform({ name: '', limit: 1.5, extra: true }));

    expect(problem.status).toBe(400);
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        { pointer: '#/name', detail: 'must not be empty' },
        { pointer: '#/limit', detail: expect.any(String) },
        { pointer: '#/extra', detail: 'Unknown field "extra". Remove it.' },
      ]),
    );
    expect(problem.errors).toHaveLength(3);
  });

  it('names query parameters when it validates a query', () => {
    const pipe = new ZodValidationPipe(schema, 'query');

    const problem = problemOf(() => pipe.transform({ name: '' }));

    expect(problem.errors).toEqual([{ parameter: 'name', detail: 'must not be empty' }]);
  });

  it('rejects a missing body with a pointer to the root', () => {
    const pipe = new ZodValidationPipe(schema);

    const problem = problemOf(() => pipe.transform(undefined));

    expect(problem.errors).toEqual([{ pointer: '#', detail: expect.any(String) }]);
  });
});
