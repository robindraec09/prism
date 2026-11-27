/**
 * `@prismtest/api`: Prism's HTTP engine. One request pipeline (defaults,
 * middleware, transport, metrics hooks) serves API tests and load tests.
 *
 * @example
 * ```ts
 * import { createHttpClient } from '@prismtest/api';
 *
 * const api = createHttpClient({ baseURL: 'http://localhost:3000' });
 * const order = await api.post('/orders', { json: { sku: 'TSHIRT-M', qty: 2 } }).json();
 * await api.close();
 * ```
 *
 * @packageDocumentation
 */

export {
  createHttpClient,
  type BodylessRequestOptions,
  type HttpClient,
  type ResponsePromise,
} from './client.js';
export {
  HttpRequestError,
  HttpTimeoutError,
  type HttpErrorCode,
  type TimeoutPhase,
} from './errors.js';
export { MASK, maskHeaders, maskUrl, serializeRequest } from './mask.js';
export { HttpResponse } from './response.js';
export type {
  HeaderInput,
  HttpClientOptions,
  HttpMethod,
  HttpTimings,
  MetricsHook,
  Middleware,
  PreparedRequest,
  QueryParams,
  QueryValue,
  RedirectPolicy,
  RequestHandler,
  RequestMetrics,
  RequestOptions,
  SerializedRequest,
} from './types.js';
