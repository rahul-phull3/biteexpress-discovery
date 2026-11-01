import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  conflictProblem,
  issuesToFieldErrors,
  notFoundProblem,
  PROBLEM_JSON,
  ProblemException,
  ProblemType,
  toErrorResponse,
  toPointer,
  validationProblem,
} from './problem';

describe('toPointer', () => {
  it.each([
    [[], '#'],
    [['name'], '#/name'],
    [['address', 'city'], '#/address/city'],
    [['cuisines', 2], '#/cuisines/2'],
    [['a/b', 'c~d'], '#/a~1b/c~0d'],
  ])('writes %j as a JSON Pointer fragment', (path, expected) => {
    expect(toPointer(path as PropertyKey[])).toBe(expected);
  });
});

describe('issuesToFieldErrors', () => {
  const issue = (path: PropertyKey[], message: string, extra = {}) => ({
    path,
    message,
    ...extra,
  });

  it('points at body fields with a JSON Pointer', () => {
    expect(
      issuesToFieldErrors([
        issue(['address', 'city'], 'must not be empty'),
        issue([], 'expected an object'),
      ]),
    ).toEqual([
      { pointer: '#/address/city', detail: 'must not be empty' },
      { pointer: '#', detail: 'expected an object' },
    ]);
  });

  it('names query parameters instead of pointing at them', () => {
    expect(
      issuesToFieldErrors([issue(['limit'], 'must be 1 to 50')], 'query'),
    ).toEqual([{ parameter: 'limit', detail: 'must be 1 to 50' }]);
  });

  it('names a single path or header parameter whatever the issue path says', () => {
    expect(
      issuesToFieldErrors([issue([], 'bad')], { parameter: 'id' }),
    ).toEqual([{ parameter: 'id', detail: 'bad' }]);
  });

  it('reports every unknown field of the body separately', () => {
    const errors = issuesToFieldErrors([
      issue(['address'], 'Unrecognized keys', {
        code: 'unrecognized_keys',
        keys: ['zip', 'state'],
      }),
    ]);

    expect(errors).toEqual([
      { pointer: '#/address/zip', detail: 'Unknown field "zip". Remove it.' },
      {
        pointer: '#/address/state',
        detail: 'Unknown field "state". Remove it.',
      },
    ]);
  });

  it('reports an unknown query parameter by its name', () => {
    const errors = issuesToFieldErrors(
      [issue([], 'Unrecognized key', { code: 'unrecognized_keys', keys: ['colour'] })],
      'query',
    );

    expect(errors).toEqual([
      { parameter: 'colour', detail: 'Unknown parameter "colour". Remove it.' },
    ]);
  });
});

describe('problem helpers', () => {
  it('builds a 400 validation problem with its fields', () => {
    const problem = validationProblem([{ pointer: '#/name', detail: 'bad' }]);

    expect(problem).toBeInstanceOf(ProblemException);
    expect(problem.problem).toEqual({
      type: ProblemType.Validation,
      title: 'Validation failed',
      status: 400,
      detail: 'The request is not valid. See errors for each field.',
      errors: [{ pointer: '#/name', detail: 'bad' }],
    });
  });

  it('builds a 404 problem', () => {
    expect(notFoundProblem('No restaurant has the id x.').problem).toEqual({
      type: ProblemType.NotFound,
      title: 'Not Found',
      status: 404,
      detail: 'No restaurant has the id x.',
    });
  });

  it('builds a 409 problem, with or without fields', () => {
    expect(conflictProblem('Already there.').problem).not.toHaveProperty('errors');
    expect(
      conflictProblem('Already there.', [{ pointer: '#/source', detail: 'dup' }])
        .problem.errors,
    ).toEqual([{ pointer: '#/source', detail: 'dup' }]);
  });

  it('uses the detail as the message of the exception', () => {
    expect(notFoundProblem('gone').message).toBe('gone');
  });
});

describe('toErrorResponse', () => {
  const context = { instance: '/v1/restaurants/x', requestId: 'req-1' };

  it('sends our own problems as they are, adding the instance and the request id', () => {
    const result = toErrorResponse(notFoundProblem('gone'), context);

    expect(result).toEqual({
      kind: 'problem',
      problem: {
        type: ProblemType.NotFound,
        title: 'Not Found',
        status: 404,
        detail: 'gone',
        instance: '/v1/restaurants/x',
        requestId: 'req-1',
      },
    });
  });

  it('leaves out the instance and the request id when there are none', () => {
    const result = toErrorResponse(notFoundProblem('gone'));

    expect(result.kind === 'problem' && Object.keys(result.problem).sort()).toEqual([
      'detail',
      'status',
      'title',
      'type',
    ]);
  });

  it('turns the "Cannot GET" 404 of an unknown route into a not-found problem', () => {
    const result = toErrorResponse(new NotFoundException('Cannot GET /v1/nope'), context);

    expect(result).toMatchObject({
      kind: 'problem',
      problem: {
        type: ProblemType.NotFound,
        title: 'Not Found',
        status: 404,
        detail: 'Cannot GET /v1/nope',
      },
    });
  });

  it('turns a malformed-JSON 400 into a generic problem that keeps the parser message', () => {
    const result = toErrorResponse(new BadRequestException('Unexpected end of JSON input'), context);

    expect(result).toMatchObject({
      kind: 'problem',
      problem: {
        type: ProblemType.Generic,
        title: 'Bad Request',
        status: 400,
        detail: 'Unexpected end of JSON input',
      },
    });
  });

  it('joins a list of messages into one detail', () => {
    const result = toErrorResponse(new BadRequestException(['a is bad', 'b is bad']));

    expect(result).toMatchObject({ problem: { detail: 'a is bad; b is bad' } });
  });

  it('turns an HttpException with a plain string body into a problem', () => {
    const result = toErrorResponse(new HttpException('Teapot says no', 418));

    expect(result).toMatchObject({
      kind: 'problem',
      problem: { status: 418, title: "I'm a Teapot", detail: 'Teapot says no' },
    });
  });

  it('respects a body its author shaped on purpose and sends it untouched', () => {
    const report = { status: 'unavailable', mongodb: { status: 'down' } };

    const result = toErrorResponse(new ServiceUnavailableException(report), context);

    expect(result).toEqual({ kind: 'custom', status: 503, body: report });
  });

  it('turns a 4xx error from Express or body-parser into a problem', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      type: 'entity.too.large',
    });

    expect(toErrorResponse(tooLarge, context)).toMatchObject({
      kind: 'problem',
      problem: { status: 413, title: 'Payload Too Large', detail: 'request entity too large' },
    });
  });

  it('does not trust a 5xx status on a foreign error, and says nothing about it', () => {
    const bad = Object.assign(new Error('upstream host db-7.internal refused'), { statusCode: 502 });

    const result = toErrorResponse(bad, context);

    expect(result).toMatchObject({ problem: { status: 500, type: ProblemType.Internal } });
    expect(JSON.stringify(result)).not.toContain('db-7.internal');
  });

  it.each([
    ['an Error', new Error('connection string mongodb://user:secret@host')],
    ['a string', 'something odd'],
    ['undefined', undefined],
  ])('hides what went wrong when %s is thrown', (_label, thrown) => {
    const result = toErrorResponse(thrown, context);

    expect(result).toEqual({
      kind: 'problem',
      problem: {
        type: ProblemType.Internal,
        title: 'Internal Server Error',
        status: 500,
        detail: 'The server hit an unexpected error. Quote the request id when you report it.',
        instance: '/v1/restaurants/x',
        requestId: 'req-1',
      },
    });
  });

  it('names the media type', () => {
    expect(PROBLEM_JSON).toBe('application/problem+json');
  });
});
