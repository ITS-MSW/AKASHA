import type { CaptureDraft } from "@akasha/contracts"
import { captureDraftSchema } from "@akasha/contracts"
import { resolveDownloadableVideoUrl } from "./video-source"

type CaptureContext = {
  height?: number
  mediaType?: string
  pageUrl?: string
  srcUrl?: string
  width?: number
}

export function createCaptureDraft(
  context: CaptureContext,
  tabTitle?: string
): CaptureDraft | null {
  if (!context.pageUrl || !context.srcUrl) {
    return null
  }

  const video = context.mediaType === "video"
  if (video && !resolveDownloadableVideoUrl({ currentSrc: context.srcUrl })) return null
  const sourceHost = new URL(context.pageUrl).hostname.replace(/^www\./, "")

  return captureDraftSchema.parse({
    height: context.height,
    kind: video ? "video" : "image",
    pageUrl: context.pageUrl,
    sourceUrl: context.srcUrl,
    storageMode: "binary",
    thumbnailUrl: video ? undefined : context.srcUrl,
    title: tabTitle?.trim() || `Saved from ${sourceHost}`,
    width: context.width,
  })
}

export type CaptureSelection = {
  id: string
  items: { draft: CaptureDraft; captureId?: string }[]
  folderId?: string
  errorMessage?: string
  origin?: { tabId: number; pageUrl: string; postUrl: string }
}

export function toCaptureSelection(
  value: CaptureSelection | CaptureDraft | null
): CaptureSelection | null {
  if (!value) return null
  if ("items" in value) return value
  return { id: value.sourceUrl, items: [{ draft: value }] }
}
