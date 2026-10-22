import type { CaptureDraft } from "@akasha/contracts"
import { storage } from "#imports"
import type { FolderOption } from "./akasha-api"
import type { CaptureSelection } from "./capture"
import type { CaptureOutboxJob } from "./outbox"

export const captureDraftStorage = storage.defineItem<CaptureDraft | CaptureSelection | null>(
  "local:capture-draft",
  {
    fallback: null,
  }
)

export const selectedFolderStorage = storage.defineItem<string | null>("local:selected-folder", {
  fallback: null,
})

export const captureOutboxStorage = storage.defineItem<CaptureOutboxJob[]>("local:capture-outbox", {
  fallback: [],
})

export const folderOptionsCacheStorage = storage.defineItem<{
  cachedAt: number
  folders: FolderOption[]
} | null>("local:folder-options-cache-v4", { fallback: null })

export const duplicateBackfillStorage = storage.defineItem<{
  complete: boolean
  pageToken?: string
  version: 1
}>("local:duplicate-backfill", {
  fallback: { complete: false, version: 1 },
})
