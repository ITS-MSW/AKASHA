import { describe, expect, it } from "vitest"

import {
  createDriveMediaRequestHeaders,
  createMediaProxyResponse,
  createThumbnailProxyResponse,
} from "./media-proxy.server"

describe("Drive media proxy", () => {
  it("forwards range and conditional request headers", () => {
    const headers = createDriveMediaRequestHeaders(
      new Headers({
        "If-None-Match": '"etag"',
        "If-Range": '"etag"',
        Range: "bytes=0-1023",
      }),
      "access-token"
    )

    expect(headers.get("Authorization")).toBe("Bearer access-token")
    expect(headers.get("Range")).toBe("bytes=0-1023")
    expect(headers.get("If-Range")).toBe('"etag"')
  })

  it("preserves partial response status and headers", async () => {
    const response = createMediaProxyResponse(
      new Response(new Uint8Array(1024), {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "1024",
          "Content-Range": "bytes 0-1023/4096",
          "Content-Type": "video/mp4",
        },
        status: 206,
      })
    )

    expect(response.status).toBe(206)
    expect(response.headers.get("Content-Range")).toBe("bytes 0-1023/4096")
    expect(response.headers.get("Accept-Ranges")).toBe("bytes")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect((await response.arrayBuffer()).byteLength).toBe(1024)
  })

  it("preserves not-modified responses without a body", () => {
    const response = createMediaProxyResponse(
      new Response(null, { status: 304 })
    )
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  it("caches stable thumbnail previews in the private browser cache", () => {
    const response = createThumbnailProxyResponse(
      new Response("image", {
        headers: {
          ETag: '"thumbnail-etag"',
          "Content-Type": "image/webp",
        },
      })
    )

    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=86400, immutable"
    )
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization, Range")
    expect(response.headers.get("Content-Type")).toBe("image/webp")
    expect(response.headers.get("ETag")).toBe('"thumbnail-etag"')
  })
})
