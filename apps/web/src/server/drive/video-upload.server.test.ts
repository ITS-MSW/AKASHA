import type * as DriveModule from "./drive.server"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { startVideoUpload, continueVideoUpload } from "./video-upload.server"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  destination: vi.fn(),
}))
vi.mock("./library-upload.server", () => ({
  assertLibraryUploadDestination: mocks.destination,
}))
vi.mock("./drive.server", async (importOriginal) => ({
  ...(await importOriginal<typeof DriveModule>()),
  createDriveClient: () => ({
    files: {
      generateIds: async () => ({ data: { ids: ["video-id"] } }),
      get: mocks.get,
      update: mocks.update,
      list: mocks.list,
    },
  }),
}))
const credentials = { accessToken: "test-access", refreshToken: "test-owner" }
const bytes = Buffer.from([
  0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
])
const input = {
  fileName: "clip.mp4",
  folderId: "root",
  mimeType: "video/mp4" as const,
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}
const stored = () => ({
  id: "video-id",
  name: "clip.mp4",
  size: String(bytes.length),
  mimeType: "video/mp4",
  sha256Checksum: input.sha256,
  parents: ["root"],
  appProperties: { stillroomType: "upload_pending", stillroomKind: "video" },
})
beforeEach(() => {
  vi.stubEnv(
    "SESSION_SECRET",
    "a-test-session-secret-with-at-least-32-characters"
  )
  mocks.get.mockResolvedValue({ data: stored() })
  mocks.update.mockImplementation(async ({ requestBody }) => ({
    data: { ...stored(), ...requestBody },
  }))
  mocks.list.mockResolvedValue({ data: { files: [] } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("resumable video upload", () => {
  it("recovers provider progress and finalizes validated bytes only once", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { Location: "https://www.googleapis.com/upload/session" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(Response.json({ id: "video-id" }))
      .mockResolvedValueOnce(new Response(bytes, { status: 206 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetcher)
    const session = await startVideoUpload(credentials, input)
    expect(session.token).not.toContain("googleapis")
    expect(await continueVideoUpload(credentials, session.token)).toEqual({
      offset: 0,
    })
    expect(
      await continueVideoUpload(credentials, session.token, {
        offset: 0,
        bytes,
      })
    ).toEqual({ offset: bytes.length, outcome: "saved" })
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestBody: {
          appProperties: expect.objectContaining({ stillroomType: "item" }),
        },
      })
    )
    mocks.get.mockResolvedValue({
      data: { ...stored(), appProperties: { stillroomType: "item" } },
    })
    expect(await continueVideoUpload(credentials, session.token)).toMatchObject(
      { outcome: "saved" }
    )
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" })
    mocks.get.mockResolvedValue({
      data: {
        ...stored(),
        trashed: true,
        appProperties: {
          ...stored().appProperties,
          akashaDuplicateOf: "original",
        },
      },
    })
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await continueVideoUpload(credentials, session.token)).toMatchObject(
      { outcome: "already_saved" }
    )
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      }),
    })
  })

  it("rejects cross-account, tampered, oversized and mismatched uploads without publishing an item", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { Location: "https://www.googleapis.com/upload/session" },
        })
      )
      .mockResolvedValue(Response.json({ id: "video-id" }))
    vi.stubGlobal("fetch", fetcher)
    const session = await startVideoUpload(credentials, input)
    await expect(
      continueVideoUpload(
        { ...credentials, refreshToken: "another-owner" },
        session.token
      )
    ).rejects.toThrow("expired")
    await expect(
      continueVideoUpload(credentials, `${session.token}x`)
    ).rejects.toThrow("expired")
    await expect(
      continueVideoUpload(credentials, session.token, {
        offset: 0,
        bytes: new Uint8Array(1024 * 1024 + 1),
      })
    ).rejects.toThrow("Invalid")
    expect(fetcher).toHaveBeenCalledTimes(1)
    mocks.get.mockResolvedValue({
      data: { ...stored(), sha256Checksum: "different" },
    })
    await expect(
      continueVideoUpload(credentials, session.token)
    ).rejects.toThrow("does not match")
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      fileId: "video-id",
      requestBody: { trashed: true },
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
