import type { CaptureDraft } from "@akasha/contracts"
import { captureDraftSchema, getXVideoMediaIdentity } from "@akasha/contracts"
import { resolveXStatusUrl } from "./video-source"

// Only retain media records, never account data, request headers or credentials.
export function collectXVideos(payload: unknown): CaptureDraft[] {
  const records = new Map<string, CaptureDraft>()
  let visited = 0
  function walk(value: unknown) {
    if (!value || typeof value !== "object" || ++visited > 50_000) return
    const node = value as Record<string, unknown>
    const media = node as {
      type?: string
      media_url_https?: string
      expanded_url?: string
      video_info?: {
        duration_millis?: number
        variants?: { url: string; bitrate?: number; content_type?: string }[]
      }
      original_info?: { width: number; height: number }
    }
    if (
      media.type === "video" &&
      typeof media.media_url_https === "string" &&
      typeof media.expanded_url === "string"
    ) {
      const pageUrl = resolveXStatusUrl(
        [media.expanded_url.replace(/\/video\/\d+$/, "")],
        "https://x.com"
      )
      const mediaIdentity = getXVideoMediaIdentity(media.media_url_https, "poster")
      const variants = (media.video_info?.variants ?? [])
        .filter((v) => {
          if (v.content_type !== "video/mp4" || typeof v.url !== "string") return false
          return Boolean(mediaIdentity) && getXVideoMediaIdentity(v.url, "video") === mediaIdentity
        })
        .map((v) => ({ url: v.url, bitrate: v.bitrate ?? 0 }))
        .sort((a, b) => b.bitrate - a.bitrate)
        .slice(0, 12)
      const parsed = captureDraftSchema.safeParse({
        kind: "video",
        storageMode: "binary",
        pageUrl,
        sourceUrl: variants[0]?.url,
        videoVariants: variants,
        thumbnailUrl: media.media_url_https,
        title: "Video from X",
        durationSeconds:
          media.video_info?.duration_millis === undefined
            ? undefined
            : Math.round(media.video_info.duration_millis / 1000),
        width: media.original_info?.width,
        height: media.original_info?.height,
      })
      if (parsed.success) records.set(`${pageUrl}|${media.media_url_https}`, parsed.data)
    }
    for (const child of Object.values(node)) walk(child)
  }
  walk(payload)
  return [...records.values()]
}

export function normalizeVideoPoster(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return undefined
    return url.origin + url.pathname
  } catch {
    return undefined
  }
}

export function matchesSelectedXVideo(draft: CaptureDraft, postUrl: string, poster: string) {
  const identity = getXVideoMediaIdentity(poster, "poster")
  return Boolean(
    identity &&
      resolveXStatusUrl([draft.pageUrl], postUrl) === postUrl &&
      draft.pageUrl === postUrl &&
      normalizeVideoPoster(draft.thumbnailUrl ?? "") === normalizeVideoPoster(poster) &&
      draft.videoVariants?.length &&
      draft.videoVariants.some((variant) => variant.url === draft.sourceUrl) &&
      draft.videoVariants.every(
        (variant) => getXVideoMediaIdentity(variant.url, "video") === identity
      )
  )
}
