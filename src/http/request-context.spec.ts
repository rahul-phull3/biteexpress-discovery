import { chooseRequestId, REQUEST_ID_HEADER, requestContext } from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('chooseRequestId', () => {
  it('keeps a safe id sent by the caller', () => {
    expect(chooseRequestId('mobile-app_7.3-abc')).toBe('mobile-app_7.3-abc');
  });

  it.each([
    ['nothing', undefined],
    ['an empty id', ''],
    ['an id with a space', 'two words'],
    ['an id with a line break', 'a\nb'],
    ['an id that is too long', 'x'.repeat(65)],
    ['an id repeated as a list', ['a', 'b']],
  ])('makes a new id when the caller sent %s', (_label, incoming) => {
    expect(chooseRequestId(incoming as string | string[] | undefined)).toMatch(UUID);
  });

  it('accepts an id of exactly 64 characters', () => {
    expect(chooseRequestId('x'.repeat(64))).toBe('x'.repeat(64));
  });
});

describe('requestContext middleware', () => {
  function run(url: string, incomingId?: string, status = 200, method = 'GET') {
    const lines: string[] = [];
    const headers = new Map<string, string>();
    let onFinish: () => void = () => undefined;
    let nextCalls = 0;
    const res = {
      statusCode: status,
      locals: {} as Record<string, unknown>,
      setHeader: (name: string, value: string) => void headers.set(name, value),
      on: (_event: 'finish', listener: () => void) => void (onFinish = listener),
    };
    const req = {
      method,
      originalUrl: url,
      headers: incomingId ? { 'x-request-id': incomingId } : {},
    };

    requestContext((line) => lines.push(line))(req, res, () => void (nextCalls += 1));
    return { lines, headers, res, finish: () => onFinish(), nextCalls: () => nextCalls };
  }

  it('returns the id in the response header, keeps it for the error filter and continues', () => {
    const { headers, res, nextCalls } = run('/v1/restaurants', 'abc-123');

    expect(headers.get(REQUEST_ID_HEADER)).toBe('abc-123');
    expect(res.locals.requestId).toBe('abc-123');
    expect(nextCalls()).toBe(1);
  });

  it('writes one access-log line when the response is done', () => {
    const { lines, finish } = run('/v1/restaurants', 'abc-123', 201, 'POST');
    expect(lines).toEqual([]);

    finish();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^POST \/v1\/restaurants 201 \d+\.\d+ms requestId=abc-123$/);
  });

  it('leaves the query string out of the log, because it can carry values that do not belong there', () => {
    const { lines, finish } = run('/v1/restaurants?city=Gurgaon&lat=28.4', 'r1');

    finish();

    expect(lines[0]).toContain(' /v1/restaurants 200 ');
    expect(lines[0]).not.toContain('Gurgaon');
  });

  it.each(['/health', '/ready', '/ready?verbose=1'])('does not log probe calls to %s', (url) => {
    const { lines, finish } = run(url);

    finish();

    expect(lines).toEqual([]);
  });

  it('gives a request without an id a generated one', () => {
    const { headers } = run('/v1/restaurants');

    expect(headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
  });
});
