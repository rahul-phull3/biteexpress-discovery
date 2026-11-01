import {
  type ArgumentsHost,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProblemDetailsFilter } from './problem-details.filter';
import { notFoundProblem } from './problem';

/** Records what the filter does to the response. */
function fakeHttp(options: { url?: string; requestId?: string; headersSent?: boolean } = {}) {
  const headers = new Map<string, string>();
  const sent: Array<{ status: number; body: unknown }> = [];
  let status = 200;
  const res = {
    headersSent: options.headersSent ?? false,
    locals: options.requestId ? { requestId: options.requestId } : {},
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
  const req = { method: 'GET', originalUrl: options.url ?? '/v1/restaurants/abc' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, headers, sent };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('answers a problem as application/problem+json that must not be cached', () => {
    const { host, headers, sent } = fakeHttp({ requestId: 'req-9' });

    filter.catch(notFoundProblem('No restaurant has the id abc.'), host);

    expect(headers.get('Content-Type')).toBe('application/problem+json');
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(sent).toEqual([
      {
        status: 404,
        body: {
          type: '/problems/not-found',
          title: 'Not Found',
          status: 404,
          detail: 'No restaurant has the id abc.',
          instance: '/v1/restaurants/abc',
          requestId: 'req-9',
        },
      },
    ]);
  });

  it('leaves the query string out of the instance', () => {
    const { host, sent } = fakeHttp({ url: '/v1/restaurants?city=Gurgaon' });

    filter.catch(new NotFoundException('Cannot GET /v1/restaurants'), host);

    expect((sent[0]?.body as { instance: string }).instance).toBe('/v1/restaurants');
  });

  it('sends a body that its author shaped untouched, as plain JSON', () => {
    const report = { status: 'unavailable', mongodb: { status: 'down' } };
    const { host, headers, sent } = fakeHttp();

    filter.catch(new ServiceUnavailableException(report), host);

    expect(sent).toEqual([{ status: 503, body: report }]);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('answers a bug with a generic 500 and logs the real error with the request id', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { host, sent } = fakeHttp({ requestId: 'req-5' });

      filter.catch(new Error('mongodb://user:secret@host exploded'), host);

      expect(sent[0]?.status).toBe(500);
      expect(JSON.stringify(sent[0]?.body)).not.toContain('secret');
      expect(sent[0]?.body).toMatchObject({
        type: '/problems/internal-error',
        requestId: 'req-5',
      });
      expect(log).toHaveBeenCalledTimes(1);
      const [message, stack] = log.mock.calls[0] as [string, string];
      expect(message).toContain('failed with 500 requestId=req-5');
      expect(stack).toContain('exploded');
    } finally {
      log.mockRestore();
    }
  });

  it('does not log a problem the client caused', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      filter.catch(notFoundProblem('gone'), fakeHttp().host);

      expect(log).toHaveBeenCalledTimes(0);
    } finally {
      log.mockRestore();
    }
  });

  it('does nothing when the response has already started', () => {
    const { host, sent, headers } = fakeHttp({ headersSent: true });

    filter.catch(notFoundProblem('late'), host);

    expect(sent).toEqual([]);
    expect(headers.size).toBe(0);
  });
});
