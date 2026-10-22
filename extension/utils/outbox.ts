import type { CaptureDraft } from "@akasha/contracts"
import type { CaptureSelection } from "./capture"

export const MAX_DELIVERY_ATTEMPTS = 4

export type CaptureOutboxJob = {
  attempt: number
  captureId: string
  createdAt: number
  draft: CaptureDraft
  errorMessage?: string
  folderId: string
  nextAttemptAt: number
  status: "pending" | "failed" | "saved" | "already_saved"
  batchId?: string
  origin?: CaptureSelection["origin"]
  reported?: boolean
}

export function createCaptureOutboxJob(
  draft: CaptureDraft,
  folderId: string,
  options: { captureId?: string; now?: number } = {}
): CaptureOutboxJob {
  const now = options.now ?? Date.now()

  return {
    attempt: 0,
    captureId: options.captureId ?? crypto.randomUUID(),
    createdAt: now,
    draft,
    folderId,
    nextAttemptAt: now,
    status: "pending",
  }
}

export function prepareDeliveryAttempt(job: CaptureOutboxJob, now = Date.now()) {
  const attempt = job.attempt + 1

  return {
    ...job,
    attempt,
    errorMessage: undefined,
    nextAttemptAt: now + getRetryDelayMs(attempt),
    status: "pending" as const,
  }
}

export function scheduleDeliveryRetry(
  job: CaptureOutboxJob,
  errorMessage: string,
  now = Date.now()
) {
  if (job.attempt >= MAX_DELIVERY_ATTEMPTS) {
    return {
      ...job,
      errorMessage,
      status: "failed" as const,
    }
  }

  return {
    ...job,
    errorMessage,
    nextAttemptAt: now + getRetryDelayMs(job.attempt),
    status: "pending" as const,
  }
}

export function getRetryDelayMs(attempt: number) {
  return Math.min(2 ** Math.max(attempt - 1, 0) * 60_000, 10 * 60_000)
}
