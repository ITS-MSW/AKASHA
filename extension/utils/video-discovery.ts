import { captureDraftSchema } from "@akasha/contracts"
import { createCaptureDraft } from "./capture"
import { resolveDownloadableVideoUrl, resolveXStatusUrl } from "./video-source"
import { matchesSelectedXVideo, normalizeVideoPoster } from "./x-video"

export async function discoverVideo(video: HTMLVideoElement, srcUrl?: string) {
  if (!video.isConnected || (srcUrl && video.currentSrc !== srcUrl && video.src !== srcUrl))
    return null
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(location.hostname)) {
    return createCaptureDraft(
      {
        mediaType: "video",
        pageUrl: location.href,
        srcUrl:
          resolveDownloadableVideoUrl({
            currentSrc: video.currentSrc || video.src,
            sourceUrls: Array.from(video.querySelectorAll("source")).map((source) => source.src),
          }) ?? "",
      },
      document.title
    )
  }
  const postUrl = selectedVideoPost(video) ?? ""
  const poster = normalizeVideoPoster(video.poster) ?? ""
  if (!poster || !postUrl) return null
  const pageUrl = location.href
  const nonce = crypto.randomUUID()
  return new Promise<ReturnType<typeof createCaptureDraft>>((resolve) => {
    const timeout = setTimeout(() => finish(null), 1_500)
    function finish(draft: ReturnType<typeof createCaptureDraft>) {
      clearTimeout(timeout)
      window.removeEventListener("message", receive)
      resolve(draft)
    }
    function receive(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== "akasha:video-source-response" ||
        event.data.nonce !== nonce
      )
        return
      const result = captureDraftSchema.safeParse(event.data.draft)
      if (
        !result.success ||
        result.data.kind !== "video" ||
        !matchesSelectedXVideo(result.data, postUrl, poster) ||
        selectedVideoPost(video) !== postUrl ||
        !video.isConnected ||
        location.href !== pageUrl ||
        normalizeVideoPoster(video.poster) !== poster ||
        normalizeVideoPoster(result.data.thumbnailUrl ?? "") !== poster
      )
        return finish(null)
      const draft = result.data
      finish({
        ...draft,
        title: (
          video
            .closest("article")
            ?.querySelector('[data-testid="tweetText"]')
            ?.textContent?.trim() || "Video from X"
        ).slice(0, 240),
      })
    }
    window.addEventListener("message", receive)
    window.postMessage(
      { type: "akasha:video-source-request", poster, postUrl, nonce },
      location.origin
    )
  })
}

function selectedVideoPost(video: HTMLVideoElement) {
  for (let container = video.parentElement; container; container = container.parentElement) {
    const time = container.querySelector("time")?.closest<HTMLAnchorElement>("a[href]")
    if (time) return resolveXStatusUrl([time.href], location.href)
    if (container.tagName === "ARTICLE") break
  }
  return resolveXStatusUrl([location.href.replace(/\/video\/\d+$/, "")], location.href)
}
