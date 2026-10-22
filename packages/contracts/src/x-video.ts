// X uses the same media identity in the poster and downloadable MP4 paths.
export function getXVideoMediaIdentity(value: string, kind: "poster" | "video") {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== (kind === "poster" ? "pbs.twimg.com" : "video.twimg.com")
    )
      return undefined
    const modern = url.pathname.match(
      kind === "poster"
        ? /^\/(amplify_video|ext_tw_video)_thumb\/(\d+)\//
        : /^\/(amplify_video|ext_tw_video)\/(\d+)\/.*\.mp4$/
    )
    if (modern) return `${modern[1]}:${modern[2]}`
    const legacy = url.pathname.match(
      kind === "poster"
        ? /^\/tweet_video_thumb\/([A-Za-z0-9_-]+)\.(?:jpg|jpeg|png|webp)$/
        : /^\/tweet_video\/([A-Za-z0-9_-]+)\.mp4$/
    )
    return legacy ? `tweet_video:${legacy[1]}` : undefined
  } catch {
    return undefined
  }
}
