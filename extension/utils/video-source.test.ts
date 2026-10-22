import { describe, expect, it } from "vitest"
import { resolveDownloadableVideoUrl, resolveXStatusUrl } from "./video-source"
import { collectXVideos, matchesSelectedXVideo } from "./x-video"

describe("resolveDownloadableVideoUrl", () => {
  it("accepts only direct sources of the selected video", () => {
    expect(resolveDownloadableVideoUrl({ currentSrc: "https://cdn.example.com/clip.webm" })).toBe(
      "https://cdn.example.com/clip.webm"
    )
    expect(resolveDownloadableVideoUrl({ currentSrc: "blob:https://x.com/player" })).toBeUndefined()
    expect(
      resolveDownloadableVideoUrl({ currentSrc: "https://video.twimg.com/master.m3u8" })
    ).toBeUndefined()
  })
  it("keeps quoted and neighbouring post media separate", () => {
    const post = (id: string) => ({
      type: "video",
      media_url_https: `https://pbs.twimg.com/amplify_video_thumb/${id}/img/poster.jpg`,
      expanded_url: `https://x.com/author/status/${id}/video/1`,
      video_info: {
        variants: [
          {
            content_type: "application/x-mpegURL",
            url: `https://video.twimg.com/${id}/master.m3u8`,
          },
          {
            content_type: "video/mp4",
            bitrate: 832000,
            url: `https://video.twimg.com/amplify_video/${id}/vid/avc1/640x360/clip.mp4`,
          },
        ],
      },
    })
    const records = collectXVideos({
      tweet: post("123"),
      quoted: post("456"),
      neighbour: post("789"),
      legacy: {
        ...post("987"),
        media_url_https: "https://pbs.twimg.com/tweet_video_thumb/Legacy_123.jpg",
        video_info: {
          variants: [
            {
              content_type: "video/mp4",
              url: "https://video.twimg.com/tweet_video/Legacy_123.mp4",
            },
          ],
        },
      },
    })
    expect(records).toHaveLength(4)
    for (const draft of records)
      expect(matchesSelectedXVideo(draft, draft.pageUrl, draft.thumbnailUrl ?? "")).toBe(true)
    expect(records[1]).toMatchObject({
      pageUrl: "https://x.com/author/status/456",
      videoVariants: [
        {
          url: "https://video.twimg.com/amplify_video/456/vid/avc1/640x360/clip.mp4",
          bitrate: 832000,
        },
      ],
    })
  })
})

describe("resolveXStatusUrl", () => {
  it("selects the tweet URL and ignores analytics or media-detail links", () => {
    expect(
      resolveXStatusUrl(
        [
          "/designer/status/1234567890/analytics",
          "/designer/status/1234567890/photo/1",
          "/designer/status/1234567890",
        ],
        "https://x.com/home"
      )
    ).toBe("https://x.com/designer/status/1234567890")
  })

  it("does not accept status-shaped links from another site", () => {
    expect(
      resolveXStatusUrl(["https://example.com/designer/status/1234567890"], "https://x.com/home")
    ).toBeUndefined()
    const draft = collectXVideos({
      type: "video",
      media_url_https: "https://pbs.twimg.com/tweet_video_thumb/Legacy_123.jpg",
      expanded_url: "https://x.com/author/status/123/video/1",
      video_info: {
        variants: [
          { content_type: "video/mp4", url: "https://video.twimg.com/tweet_video/Legacy_123.mp4" },
        ],
      },
    })[0]
    if (!draft) throw new Error("Expected legacy video draft")
    for (const pageUrl of [
      "https://evil.example/author/status/123",
      "https://x.com/other/status/123",
      "https://x.com/author/not-status/123",
      "http://x.com/author/status/123",
    ]) {
      expect(
        matchesSelectedXVideo({ ...draft, pageUrl }, draft.pageUrl, draft.thumbnailUrl ?? "")
      ).toBe(false)
    }
    expect(
      matchesSelectedXVideo(
        { ...draft, sourceUrl: "https://video.twimg.com/tweet_video/Other.mp4" },
        draft.pageUrl,
        draft.thumbnailUrl ?? ""
      )
    ).toBe(false)
  })
})
