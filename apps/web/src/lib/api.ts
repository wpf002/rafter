import { z } from 'zod';
import {
  ApiError,
  DashboardResponse,
  IngestDraftResponse,
  JobDetail,
  JobSummary,
  PhotoSummary,
  PriceModel,
  PriceModelVersion,
  QuoteComputation,
  Quote,
  TenantSummary,
  type AttachMeasurementRequest,
  type CreateJobRequest,
  type CreateModelVersionRequest,
  type IssueQuoteRequest,
  type JobState,
  type QuotePreviewRequest,
  type SubmitCloseoutRequest,
  type UploadPhotoRequest,
} from '@rafter/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TENANT_KEY = 'rafter.tenant';

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function tenantHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const t = window.localStorage.getItem(TENANT_KEY);
  return t !== null && t !== '' ? { 'x-tenant-id': t } : {};
}

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

async function request<T>(method: string, path: string, schema: Schema<T>, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...tenantHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(`API unreachable at ${API_URL} — is apps/api running?`, 0);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = ApiError.safeParse(await res.json());
      if (parsed.success) message = parsed.data.detail ?? parsed.data.error;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new ApiRequestError(message, res.status);
  }
  const json: unknown = await res.json();
  const out = schema.safeParse(json);
  if (!out.success) {
    throw new ApiRequestError(`Unexpected response shape from ${path}`, res.status);
  }
  return out.data;
}

const get = <T>(path: string, schema: Schema<T>) => request('GET', path, schema);
const post = <T>(path: string, body: unknown, schema: Schema<T>) => request('POST', path, schema, body);

const CreatedId = z.object({ id: z.string() }).passthrough();

export const api = {
  tenants: () => get('/api/tenants', z.array(TenantSummary)),
  dashboard: () => get('/api/dashboard', DashboardResponse),
  jobs: () => get('/api/jobs', z.array(JobSummary)),
  createJob: (body: CreateJobRequest) => post('/api/jobs', body, CreatedId),
  job: (id: string) => get(`/api/jobs/${id}`, JobDetail),
  attachMeasurement: (jobId: string, body: AttachMeasurementRequest) =>
    post(`/api/jobs/${jobId}/measurement`, body, z.unknown()),
  quotePreview: (body: QuotePreviewRequest) => post('/api/quote-preview', body, QuoteComputation),
  issueQuote: (jobId: string, body: IssueQuoteRequest) => post(`/api/jobs/${jobId}/quote`, body, Quote),
  transition: (jobId: string, to: JobState) => post(`/api/jobs/${jobId}/transition`, { to }, z.unknown()),
  uploadPhoto: (jobId: string, body: UploadPhotoRequest) => post(`/api/jobs/${jobId}/photos`, body, PhotoSummary),
  submitCloseout: (jobId: string, body: SubmitCloseoutRequest) =>
    post(`/api/jobs/${jobId}/closeout`, body, z.unknown()),
  priceModels: () => get('/api/price-models', z.array(PriceModel)),
  createModelVersion: (modelId: string, body: CreateModelVersionRequest) =>
    post(`/api/price-models/${modelId}/versions`, body, PriceModelVersion),
  ingestInvoice: (text: string) => post('/api/ingest/invoice', { text }, IngestDraftResponse),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
