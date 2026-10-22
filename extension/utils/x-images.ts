import type { CaptureDraft } from "@akasha/contracts"
import { resolveXStatusUrl } from "./video-source"

export function normalizeXImageUrl(value: string) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.hostname !== "pbs.twimg.com" ||
      !url.pathname.startsWith("/media/")
    )
      return null
    const format =
      url.searchParams.get("format") ?? url.pathname.match(/\.(jpg|jpeg|png|webp)$/i)?.[1]
    if (!format || !/^(jpg|jpeg|png|webp)$/i.test(format)) return null
    url.pathname = url.pathname.replace(/\.(jpg|jpeg|png|webp)$/i, "")
    url.search = ""
    url.hash = ""
    url.searchParams.set("format", format.toLowerCase())
    url.searchParams.set("name", "orig")
    return url.toString()
  } catch {
    return null
  }
}

function photoPostUrl(image: HTMLImageElement, pageUrl: string) {
  const href = image.closest<HTMLAnchorElement>("a[href]")?.href
  if (!href) return undefined
  return resolveXStatusUrl([href.replace(/\/photo\/\d+(?:[?#].*)?$/, "")], pageUrl)
}

// A photo link and the article's own timestamp must agree. Ambiguous or quoted
// media falls back to single-image capture rather than collecting another post.
export function discoverXImages(
  image: HTMLImageElement,
  pageUrl: string,
  title: string
): CaptureDraft[] {
  const page = new URL(pageUrl)
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(page.hostname)) return []
  const article = image.closest("article")
  const postUrl = photoPostUrl(image, pageUrl)
  const ownTime = article?.querySelector("time")?.closest<HTMLAnchorElement>("a[href]")
  if (!article || !postUrl || !ownTime || resolveXStatusUrl([ownTime.href], pageUrl) !== postUrl)
    return []
  const images = Array.from(article.querySelectorAll<HTMLImageElement>("img")).filter(
    (candidate) =>
      candidate.closest("article") === article && photoPostUrl(candidate, pageUrl) === postUrl
  )
  const seen = new Set<string>()
  return images
    .flatMap((candidate) => {
      const sourceUrl = normalizeXImageUrl(candidate.currentSrc || candidate.src)
      if (!sourceUrl || seen.has(sourceUrl)) return []
      seen.add(sourceUrl)
      return [
        {
          kind: "image" as const,
          storageMode: "binary" as const,
          pageUrl: postUrl,
          sourceUrl,
          thumbnailUrl: candidate.currentSrc || candidate.src,
          title,
        },
      ]
    })
    .slice(0, 4)
}

export function isPostVisible(postUrl: string, pageUrl: string) {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("article a[href]")).some(
    (link) => {
      if (resolveXStatusUrl([link.href], pageUrl) !== postUrl || !link.querySelector("time"))
        return false
      const article = link.closest("article")
      if (!article) return false
      const bounds = article.getBoundingClientRect()
      return (
        bounds.top < window.innerHeight &&
        bounds.bottom > 0 &&
        bounds.left < window.innerWidth &&
        bounds.right > 0
      )
    }
  )
}
