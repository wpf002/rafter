import { z } from 'zod';
import {
  ActualLine,
  Closeout,
  CloseoutInput,
  JobEvent,
  JobState,
  Measurement,
  MeasurementInput,
  MeasurementSource,
  PriceModel,
  PriceModelRates,
  PriceModelVersion,
  Quote,
  VarianceAttribution,
  VarianceReport,
} from './domain';
import { MoneyString } from './money';

/**
 * REST contract shared by apps/api (validation) and apps/web (client types).
 * Tenancy: every request carries `x-tenant-id`. v1 has no auth.
 */

export const TenantSummary = z.object({
  id: z.string(),
  name: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;

export const JobSummary = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  customerName: z.string(),
  state: JobState,
  quotedTotalCents: MoneyString.nullable(),
  actualMarginBps: z.number().int().nullable(),
  createdAt: z.string(),
});
export type JobSummary = z.infer<typeof JobSummary>;

export const CreateJobRequest = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  customerName: z.string().min(1),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

export const AttachMeasurementRequest = z.discriminatedUnion('source', [
  z.object({ source: z.literal('MANUAL'), input: MeasurementInput }),
  z.object({ source: z.literal('AERIAL_STUB'), address: z.string().min(1) }),
]);
export type AttachMeasurementRequest = z.infer<typeof AttachMeasurementRequest>;

export const IssueQuoteRequest = z.object({
  priceModelVersionId: z.string(),
});
export type IssueQuoteRequest = z.infer<typeof IssueQuoteRequest>;

export const QuotePreviewRequest = z.object({
  measurement: MeasurementInput,
  priceModelVersionId: z.string(),
});
export type QuotePreviewRequest = z.infer<typeof QuotePreviewRequest>;

export const TransitionRequest = z.object({
  to: JobState,
});
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const SubmitCloseoutRequest = CloseoutInput;
export type SubmitCloseoutRequest = z.infer<typeof SubmitCloseoutRequest>;

export const UploadPhotoRequest = z.object({
  filename: z.string().min(1),
  /** base64-encoded image bytes */
  dataBase64: z.string().min(1),
});
export type UploadPhotoRequest = z.infer<typeof UploadPhotoRequest>;

export const PhotoSummary = z.object({
  id: z.string(),
  jobId: z.string(),
  filename: z.string(),
  /** EXIF DateTimeOriginal when present, else null. Stored at upload. */
  exifTakenAt: z.string().nullable(),
  uploadedAt: z.string(),
});
export type PhotoSummary = z.infer<typeof PhotoSummary>;

export const CreateModelVersionRequest = z.object({
  rates: PriceModelRates,
});
export type CreateModelVersionRequest = z.infer<typeof CreateModelVersionRequest>;

export const JobDetail = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  customerName: z.string(),
  state: JobState,
  createdAt: z.string(),
  measurement: Measurement.nullable(),
  quote: Quote.nullable(),
  closeout: Closeout.nullable(),
  variance: VarianceReport.nullable(),
  photos: z.array(PhotoSummary),
  events: z.array(JobEvent),
});
export type JobDetail = z.infer<typeof JobDetail>;

export const DashboardResponse = z.object({
  jobsByState: z.record(JobState, z.number().int()),
  quotedThisMonthCents: MoneyString,
  closedJobs: z.number().int(),
  avgActualMarginBps: z.number().int().nullable(),
  /** Closeout completion on jobs ≥30 days old — the Phase 6 gate metric (D8). */
  closeoutCompletionBps: z.number().int(),
  benchmarkUnlocked: z.boolean(),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

export const IngestDraftRequest = z.object({
  /** Raw invoice text (v1). PDF parsing sits behind the same seam. */
  text: z.string().min(1),
});
export type IngestDraftRequest = z.infer<typeof IngestDraftRequest>;

export const IngestDraftResponse = z.object({
  /** Draft only — nothing enters the record unconfirmed (D5). */
  draftLines: z.array(ActualLine),
  provider: z.string(),
});
export type IngestDraftResponse = z.infer<typeof IngestDraftResponse>;

export const ApiError = z.object({
  error: z.string(),
  detail: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Route table (documentation + client helper). */
export const ROUTES = {
  health: 'GET /health',
  tenants: 'GET /api/tenants',
  dashboard: 'GET /api/dashboard',
  listJobs: 'GET /api/jobs',
  createJob: 'POST /api/jobs',
  jobDetail: 'GET /api/jobs/:id',
  attachMeasurement: 'POST /api/jobs/:id/measurement',
  quotePreview: 'POST /api/quote-preview',
  issueQuote: 'POST /api/jobs/:id/quote',
  transition: 'POST /api/jobs/:id/transition',
  uploadPhoto: 'POST /api/jobs/:id/photos',
  submitCloseout: 'POST /api/jobs/:id/closeout',
  listModels: 'GET /api/price-models',
  createModelVersion: 'POST /api/price-models/:id/versions',
  ingestInvoice: 'POST /api/ingest/invoice',
} as const;

export type {
  Measurement as ApiMeasurement,
  MeasurementInput as ApiMeasurementInput,
  PriceModel as ApiPriceModel,
  PriceModelVersion as ApiPriceModelVersion,
  Quote as ApiQuote,
  VarianceAttribution as ApiVarianceAttribution,
};
export { MeasurementSource };
