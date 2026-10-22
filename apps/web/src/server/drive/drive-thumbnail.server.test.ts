import { describe, expect, it, vi } from "vitest"

import {
  createDriveThumbnailToken,
  createDriveThumbnailUrl,
  fetchDriveThumbnail,
  verifyDriveThumbnailToken,
} from "./drive-thumbnail.server"

const secret = "a-secure-session-secret-with-32-characters"
const thumbnailUrl = "https://lh3.googleusercontent.com/drive-thumbnail"
const now = Date.UTC(2026, 7, 23, 12)

describe("Drive thumbnail tokens", () => {
  it("creates a stable, verifiable URL within the same cache bucket", () => {
    const first = createDriveThumbnailUrl("file id", thumbnailUrl, {
      now,
      secret,
    })
    const second = createDriveThumbnailUrl("file id", thumbnailUrl, {
      now: now + 60_000,
      secret,
    })

    expect(first).toBe(second)

    const token = new URL(first, "https://akasha.test").searchParams.get(
      "preview"
    )
    expect(token).toBeTruthy()
    expect(
      verifyDriveThumbnailToken(token!, { now: now + 60_000, secret })
    ).toMatchObject({ fileId: "file id", thumbnailUrl })
  })

  it("rejects tampered and expired tokens", () => {
    const token = createDriveThumbnailToken("file-id", thumbnailUrl, {
      now,
      secret,
    })

    expect(() =>
      verifyDriveThumbnailToken(`${token}x`, { now, secret })
    ).toThrow("Invalid thumbnail token")
    expect(() =>
      verifyDriveThumbnailToken(token, {
        now: now + 3 * 24 * 60 * 60 * 1000,
        secret,
      })
    ).toThrow("Expired or invalid thumbnail token")
  })
})

describe("Drive thumbnail fetch", () => {
  it("keeps credentials on validated Google redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            Location: "https://lh4.googleusercontent.com/rendered-thumbnail",
          },
          status: 302,
        })
      )
      .mockResolvedValueOnce(
        new Response("image", {
          headers: { "Content-Type": "image/jpeg" },
          status: 200,
        })
      )

    const response = await fetchDriveThumbnail(
      thumbnailUrl,
      "access-token",
      new Headers({ "If-None-Match": '"etag"' }),
      fetcher
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" })
    const headers = new Headers(fetcher.mock.calls[1]?.[1]?.headers)
    expect(headers.get("Authorization")).toBe("Bearer access-token")
    expect(headers.get("If-None-Match")).toBe('"etag"')
  })

  it("stops before forwarding credentials to an untrusted redirect", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { Location: "https://example.com/image.jpg" },
        status: 302,
      })
    )

    await expect(
      fetchDriveThumbnail(thumbnailUrl, "access-token", new Headers(), fetcher)
    ).rejects.toThrow("Invalid thumbnail URL")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("rejects non-Google thumbnail hosts", () => {
    expect(() =>
      createDriveThumbnailToken("file-id", "https://example.com/image.jpg", {
        now,
        secret,
      })
    ).toThrow("Invalid thumbnail URL")
  })
})
