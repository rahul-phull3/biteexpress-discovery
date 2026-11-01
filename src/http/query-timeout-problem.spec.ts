import { type ArgumentsHost, Logger } from '@nestjs/common';
import { QueryTimeoutError } from '../database/query-timeout.error';
import { toErrorResponse } from './problem';
import { ProblemDetailsFilter } from './problem-details.filter';

// A database read that ran past its time limit (READ_TIMEOUT_MS) is not a bug
// and not the client's fault: the answer is a 503 that says when to try again,
// and nothing about the database.

/** Records what the filter does to the response. */
function fakeHttp() {
  const headers = new Map<string, string>();
  const sent: Array<{ status: number; body: unknown }> = [];
  let status = 200;
  const res = {
    headersSent: false,
    locals: { requestId: 'req-3' },
    status(code: number) {
      status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    json(body: unknown) {
      sent.push({ status, body });
    },
  };
  const req = { method: 'GET', originalUrl: '/v1/restaurants?city=Gurgaon' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, headers, sent };
}

describe('a read that ran past its time limit', () => {
  it('becomes a 503 problem that says when to try again', () => {
    const response = toErrorResponse(new QueryTimeoutError(2000), {
      instance: '/v1/restaurants',
      requestId: 'req-1',
    });

    expect(response).toEqual({
      kind: 'problem',
      problem: {
        type: '/problems/service-unavailable',
        title: 'Service Unavailable',
        status: 503,
        detail: 'The database did not answer in time. Try again in a moment.',
        instance: '/v1/restaurants',
        requestId: 'req-1',
      },
      headers: { 'Retry-After': '1' },
    });
  });

  it('tells the client nothing about the limit or the database', () => {
    const response = toErrorResponse(
      new QueryTimeoutError(2000, { cause: new Error('mongodb://user:secret@db.internal:27017') }),
    );

    expect(JSON.stringify(response)).not.toMatch(/2000|secret|mongodb|internal/);
  });

  it('is sent with its Retry-After header and logged, because this server could not answer', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { host, headers, sent } = fakeHttp();

      new ProblemDetailsFilter().catch(new QueryTimeoutError(2000), host);

      expect(sent[0]?.status).toBe(503);
      expect(headers.get('Retry-After')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/problem+json');
      expect(headers.get('Cache-Control')).toBe('no-store');
      expect(log).toHaveBeenCalledTimes(1);
      expect((log.mock.calls[0] as [string])[0]).toContain('failed with 503 requestId=req-3');
    } finally {
      log.mockRestore();
    }
  });

  it('adds no headers to any other problem', () => {
    expect(toErrorResponse(new Error('a bug'))).not.toHaveProperty('headers');
  });
});
