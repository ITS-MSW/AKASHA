import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { Readable, Transform } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import {
  getXVideoMediaIdentity,
  libraryUploadMimeTypes,
  maximumLibraryUploadBytes,
  maximumVideoUploadBytes,
} from "@akasha/contracts"
import type {
  CaptureDraft,
  CaptureOutcome,
  LibraryUploadMimeType,
} from "@akasha/contracts"
import { drive as googleDrive } from "googleapis/build/src/apis/drive/index.js"
import type { drive_v3 } from "googleapis"

import type { GoogleTokenCredentials } from "../auth/google-oauth.server"
import { createGoogleOAuthClient } from "../auth/google-oauth.server"
import {
  buildCapturePropertyQuery,
  CONTENT_HASH_PROPERTY,
  createBackfillProperties,
  createContentHashTransform,
  createSourceFingerprint,
  SOURCE_HASH_PROPERTY,
} from "./capture-dedupe.server"

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const ROOT_PROPERTY_KEY = "stillroomRole"
const ROOT_PROPERTY_VALUE = "root"
const FILE_FIELDS =
  "nextPageToken,files(id,name,mimeType,size,parents,description,thumbnailLink,webContentLink,webViewLink,appProperties,imageMediaMetadata,videoMediaMetadata,createdTime)"
const IMAGE_MIME_TYPES = new Set<string>(libraryUploadMimeTypes)
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"])
const MAXIMUM_IMAGE_BYTES = maximumLibraryUploadBytes
const MAXIMUM_POSTER_BYTES = 5 * 1024 * 1024
const MAXIMUM_VIDEO_BYTES = maximumVideoUploadBytes

export { FOLDER_MIME_TYPE }

export type CaptureSaveTimings = {
  dedupeMs: number
  driveUploadMs: number
  idempotencyMs: number
  sourceResponseMs: number
}

export type CaptureSaveResult = {
  file: drive_v3.Schema$File
  outcome: CaptureOutcome
  timings: CaptureSaveTimings
}

export type LibraryImageUpload = {
  byteSize: number
  fileName: string
  mimeType: string
  stream: ReadableStream<Uint8Array>
}

export class CaptureSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CaptureSourceError"
  }
}

export function createDriveClient(credentials: GoogleTokenCredentials) {
  const auth = createGoogleOAuthClient()
  auth.setCredentials({
    access_token: credentials.accessToken,
    expiry_date: credentials.accessTokenExpiresAt,
    refresh_token: credentials.refreshToken,
  })

  return googleDrive({ version: "v3", auth })
}

export async function listStillroomLibrary(drive: drive_v3.Drive) {
  const files = await listDriveFiles(drive, "trashed = false")
  const existingRoot = files.find(
    (file) =>
      file.mimeType === FOLDER_MIME_TYPE &&
      file.appProperties?.[ROOT_PROPERTY_KEY] === ROOT_PROPERTY_VALUE
  )

  if (existingRoot?.id) return { files, root: existingRoot }

  const root = await createStillroomRoot(drive)
  return { files: [...files, root], root }
}

export async function backfillCaptureDedupeMetadata(
  credentials: GoogleTokenCredentials,
  pageToken?: string
) {
  const drive = createDriveClient(credentials)
  const response = await drive.files.list({
    fields:
      "nextPageToken,files(id,mimeType,description,sha256Checksum,appProperties)",
    pageSize: 100,
    pageToken,
    q: "appProperties has { key='stillroomType' and value='item' } and trashed = false",
    spaces: "drive",
  })
  const files = response.data.files ?? []
  let updatedCount = 0

  await runWithConcurrency(files, 4, async (file) => {
    if (!file.id) return

    const appProperties = createBackfillProperties(file)
    const hasNewSourceHash =
      !file.appProperties?.[SOURCE_HASH_PROPERTY] &&
      Boolean(appProperties[SOURCE_HASH_PROPERTY])
    const hasNewContentHash =
      !file.appProperties?.[CONTENT_HASH_PROPERTY] &&
      Boolean(appProperties[CONTENT_HASH_PROPERTY])

    if (!hasNewSourceHash && !hasNewContentHash) return

    await drive.files.update({
      fileId: file.id,
      fields: "id",
      requestBody: { appProperties },
    })
    updatedCount += 1
  })

  return {
    nextPageToken: response.data.nextPageToken ?? undefined,
    scannedCount: files.length,
    updatedCount,
  }
}

export async function listStillroomFolders(
  credentials: GoogleTokenCredentials
) {
  const drive = createDriveClient(credentials)
  const folders: drive_v3.Schema$File[] = []
  let pageToken: string | undefined

  do {
    const response = await drive.files.list({
      fields: "nextPageToken,files(id,name,parents,appProperties)",
      orderBy: "name_natural",
      pageSize: 1000,
      pageToken,
      q: `mimeType='${FOLDER_MIME_TYPE}' and trashed = false`,
      spaces: "drive",
    })

    folders.push(...(response.data.files ?? []))
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  const existingRoot = folders.find(
    (folder) =>
      folder.appProperties?.[ROOT_PROPERTY_KEY] === ROOT_PROPERTY_VALUE
  )

  if (existingRoot?.id) {
    return { folders, root: existingRoot }
  }

  const createdRoot = await createStillroomRoot(drive)

  return { folders: [...folders, createdRoot], root: createdRoot }
}

async function createStillroomRoot(drive: drive_v3.Drive) {
  const response = await drive.files.create({
    fields: "id,name,mimeType,parents,appProperties,createdTime",
    requestBody: {
      appProperties: { [ROOT_PROPERTY_KEY]: ROOT_PROPERTY_VALUE },
      mimeType: FOLDER_MIME_TYPE,
      name: "Akasha",
    },
  })

  return response.data
}

async function listDriveFiles(drive: drive_v3.Drive, query: string) {
  const files: drive_v3.Schema$File[] = []
  let pageToken: string | undefined

  do {
    const response = await drive.files.list({
      fields: FILE_FIELDS,
      orderBy: "folder,name_natural",
      pageSize: 1000,
      pageToken,
      q: query,
      spaces: "drive",
    })

    files.push(...(response.data.files ?? []))
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

export async function createFolder(
  credentials: GoogleTokenCredentials,
  parentFolderId: string,
  name: string
) {
  const drive = createDriveClient(credentials)
  const response = await drive.files.create({
    fields: "id,name,mimeType,parents,appProperties,createdTime",
    requestBody: {
      appProperties: { stillroomType: "folder" },
      mimeType: FOLDER_MIME_TYPE,
      name,
      parents: [parentFolderId],
    },
  })

  return response.data
}

export async function moveFile(
  credentials: GoogleTokenCredentials,
  fileId: string,
  destinationFolderId: string
) {
  const drive = createDriveClient(credentials)
  const currentFile = await drive.files.get({ fileId, fields: "parents" })
  const currentParents = currentFile.data.parents ?? []
  if (currentParents.includes(destinationFolderId)) return currentFile.data

  const previousParents = currentParents.join(",")
  const response = await drive.files.update({
    addParents: destinationFolderId,
    fileId,
    fields: "id,name,mimeType,parents,appProperties,createdTime",
    removeParents: previousParents,
  })

  return response.data
}

export async function trashFile(
  credentials: GoogleTokenCredentials,
  fileId: string
) {
  const drive = createDriveClient(credentials)
  const response = await drive.files.update({
    fileId,
    fields: "id,trashed",
    requestBody: { trashed: true },
  })

  return response.data
}

export async function saveCapture(
  credentials: GoogleTokenCredentials,
  draft: CaptureDraft,
  folderId: string,
  options: { attempt?: number; captureId?: string } = {}
): Promise<CaptureSaveResult> {
  const drive = createDriveClient(credentials)
  const timings: CaptureSaveTimings = {
    dedupeMs: 0,
    driveUploadMs: 0,
    idempotencyMs: 0,
    sourceResponseMs: 0,
  }

  if (options.captureId && (options.attempt ?? 1) > 1) {
    const idempotencyStartedAt = performance.now()
    const existingCapture = await findCaptureById(drive, options.captureId)
    timings.idempotencyMs = performance.now() - idempotencyStartedAt

    if (existingCapture) {
      return { file: existingCapture, outcome: "saved", timings }
    }
  }

  const sourceHash = createSourceFingerprint(draft.sourceUrl)
  const sourceDuplicate = await findDuplicateByProperty(
    drive,
    SOURCE_HASH_PROPERTY,
    sourceHash,
    timings
  )

  if (sourceDuplicate) {
    return {
      file: sourceDuplicate,
      outcome: "already_saved",
      timings,
    }
  }

  if (draft.kind === "video" && draft.storageMode !== "binary") {
    throw new CaptureSourceError(
      "This site does not expose a downloadable video."
    )
  }

  if (draft.kind === "video") {
    const { bytes, mimeType } = await downloadCaptureVideo(draft)
    const result = await uploadCaptureStream(
      drive,
      draft,
      folderId,
      Readable.from([bytes]),
      mimeType,
      MAXIMUM_VIDEO_BYTES,
      timings,
      sourceHash,
      options.captureId
    )
    return { ...result, timings }
  }

  const sourceRequestStartedAt = performance.now()
  const sourceResponse = await fetchSafeRemoteSource(draft.sourceUrl, {
    headers: { "User-Agent": "Akasha Capture/1.0" },
    signal: AbortSignal.timeout(15_000),
  })

  if (!sourceResponse.ok) {
    if (
      sourceResponse.status === 408 ||
      sourceResponse.status === 429 ||
      sourceResponse.status >= 500
    ) {
      throw new Error(`The source ${draft.kind} is temporarily unavailable.`)
    }

    throw new CaptureSourceError(
      `The source ${draft.kind} could not be downloaded.`
    )
  }
  timings.sourceResponseMs = performance.now() - sourceRequestStartedAt

  const contentLength = Number(sourceResponse.headers.get("Content-Length"))
  const maximumBytes = MAXIMUM_IMAGE_BYTES

  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new CaptureSourceError(`This ${draft.kind} is too large to save.`)
  }

  if (!sourceResponse.body) {
    throw new CaptureSourceError(
      `The source ${draft.kind} did not contain any data.`
    )
  }

  const mimeType = normalizeMediaMimeType(
    sourceResponse.headers.get("Content-Type"),
    draft.kind
  )
  const sourceStream = Readable.fromWeb(
    sourceResponse.body as unknown as NodeReadableStream
  )

  try {
    const result = await uploadCaptureStream(
      drive,
      draft,
      folderId,
      sourceStream,
      mimeType,
      maximumBytes,
      timings,
      sourceHash,
      options.captureId
    )
    return { ...result, timings }
  } finally {
    sourceStream.destroy()
  }
}

async function downloadCaptureVideo(draft: CaptureDraft) {
  const variants = draft.videoVariants?.length
    ? [...draft.videoVariants].sort((a, b) => b.bitrate - a.bitrate)
    : [{ url: draft.sourceUrl, bitrate: 0 }]
  if (draft.videoVariants?.length) {
    const identity = getXVideoMediaIdentity(draft.thumbnailUrl ?? "", "poster")
    if (
      !identity ||
      !variants.some((variant) => variant.url === draft.sourceUrl) ||
      variants.some(
        (variant) => getXVideoMediaIdentity(variant.url, "video") !== identity
      )
    )
      throw new CaptureSourceError(
        "Akasha could not match this video's source."
      )
  }
  for (const variant of variants) {
    const response = await fetchSafeRemoteSource(variant.url, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      if (response.status === 429 || response.status >= 500)
        throw new Error("The source video is temporarily unavailable.")
      continue
    }
    if (Number(response.headers.get("content-length")) > MAXIMUM_VIDEO_BYTES) {
      await response.body.cancel()
      continue
    }
    const mimeType = normalizeMediaMimeType(
      response.headers.get("content-type"),
      "video"
    )
    const stream = Readable.fromWeb(
      response.body as unknown as NodeReadableStream
    )
    const validator = createVideoValidationTransform(
      mimeType,
      MAXIMUM_VIDEO_BYTES
    )
    stream.on("error", (error) => validator.destroy(error))
    stream.pipe(validator)
    try {
      const chunks: Buffer[] = []
      for await (const chunk of validator) chunks.push(Buffer.from(chunk))
      return { bytes: Buffer.concat(chunks), mimeType }
    } catch (error) {
      if (
        !(error instanceof CaptureSourceError) ||
        !error.message.includes("too large")
      )
        throw error
    } finally {
      stream.destroy()
      validator.destroy()
    }
  }
  throw new CaptureSourceError("No downloadable video fits the 50 MiB limit.")
}

export async function saveUploadedImage(
  credentials: GoogleTokenCredentials,
  folderId: string,
  upload: LibraryImageUpload
): Promise<CaptureSaveResult> {
  if (upload.byteSize <= 0) {
    throw new CaptureSourceError("This image is empty.")
  }
  if (upload.byteSize > MAXIMUM_IMAGE_BYTES) {
    throw new CaptureSourceError("This image is too large to save.")
  }

  const mimeType = normalizeMediaMimeType(
    upload.mimeType,
    "image"
  ) as LibraryUploadMimeType
  const fileName = normalizeLibraryUploadFileName(upload.fileName, mimeType)
  const sourceStream = Readable.fromWeb(
    upload.stream as unknown as NodeReadableStream
  )
  const contentHash = createContentHashTransform()
  const drive = createDriveClient(credentials)
  const timings: CaptureSaveTimings = {
    dedupeMs: 0,
    driveUploadMs: 0,
    idempotencyMs: 0,
    sourceResponseMs: 0,
  }

  try {
    const driveUploadStartedAt = performance.now()
    const response = await drive.files.create(
      {
        fields:
          "id,name,mimeType,size,parents,thumbnailLink,webViewLink,appProperties,createdTime",
        media: {
          body: sourceStream
            .pipe(createImageValidationTransform(mimeType, MAXIMUM_IMAGE_BYTES))
            .pipe(contentHash.stream),
          mimeType,
        },
        requestBody: {
          appProperties: {
            stillroomKind: "image",
            stillroomOrigin: "upload",
            stillroomType: "item",
          },
          description: JSON.stringify({
            storageMode: "binary",
            title: removeFileExtension(fileName),
          }),
          mimeType,
          name: fileName,
          parents: [folderId],
        },
      },
      { timeout: 60_000 }
    )
    timings.driveUploadMs = performance.now() - driveUploadStartedAt

    if (!response.data.id) {
      throw new Error("Akasha could not identify the uploaded image.")
    }

    const result = await finalizeContentHash(
      drive,
      response.data,
      contentHash.digest(),
      timings
    )
    return { ...result, timings }
  } finally {
    sourceStream.destroy()
  }
}

async function uploadCaptureStream(
  drive: drive_v3.Drive,
  draft: CaptureDraft,
  folderId: string,
  sourceStream: Readable,
  mimeType: string,
  maximumBytes: number,
  timings: CaptureSaveTimings,
  sourceHash: string,
  captureId?: string
) {
  const limitedStream = sourceStream.pipe(
    draft.kind === "video"
      ? createVideoValidationTransform(mimeType, maximumBytes)
      : createSizeLimitTransform(maximumBytes)
  )
  const contentHash = createContentHashTransform()
  const driveUploadStartedAt = performance.now()
  const response = await drive.files.create(
    {
      fields:
        "id,name,mimeType,parents,thumbnailLink,appProperties,createdTime",
      media: { body: limitedStream.pipe(contentHash.stream), mimeType },
      requestBody: createCaptureMetadata(
        draft,
        folderId,
        mimeType,
        sourceHash,
        captureId
      ),
    },
    { timeout: 60_000 }
  )
  timings.driveUploadMs = performance.now() - driveUploadStartedAt
  let file = response.data

  if (!file.id) {
    throw new Error("Akasha could not identify the saved capture.")
  }

  const finalized = await finalizeContentHash(
    drive,
    file,
    contentHash.digest(),
    timings
  )
  if (finalized.outcome === "already_saved") return finalized
  file = finalized.file

  if (draft.kind === "video" && file.id && draft.thumbnailUrl) {
    const posterDriveFileId = await saveVideoPoster(
      drive,
      draft.thumbnailUrl,
      draft.title,
      folderId,
      captureId
    ).catch(() => undefined)

    if (posterDriveFileId) {
      const updated = await drive.files
        .update({
          fileId: file.id,
          fields:
            "id,name,mimeType,size,parents,thumbnailLink,appProperties,createdTime",
          requestBody: {
            description: createCaptureDescription(draft, posterDriveFileId),
          },
        })
        .catch(() => undefined)
      if (updated) file = updated.data
    }
  }

  return { file, outcome: "saved" as const }
}

function createCaptureMetadata(
  draft: CaptureDraft,
  folderId: string,
  mimeType: string,
  sourceHash: string,
  captureId?: string
) {
  const extension =
    mimeType.split("/")[1]?.replace(/[^a-z0-9.+-]/gi, "") || "jpg"
  const fileName = `${slugify(draft.title)}.${extension}`

  return {
    appProperties: {
      ...(captureId ? { akashaCaptureId: captureId } : {}),
      [SOURCE_HASH_PROPERTY]: sourceHash,
      stillroomKind: draft.kind,
      stillroomType: "item",
    },
    description: createCaptureDescription(draft),
    mimeType,
    name: fileName,
    parents: [folderId],
  }
}

function createCaptureDescription(
  draft: CaptureDraft,
  posterDriveFileId?: string
) {
  return JSON.stringify({
    durationSeconds: draft.durationSeconds,
    height: draft.height,
    pageUrl: draft.pageUrl,
    posterDriveFileId,
    sourceUrl: draft.sourceUrl,
    storageMode: draft.storageMode,
    thumbnailUrl: draft.thumbnailUrl,
    title: draft.title,
    width: draft.width,
  })
}

export function createSizeLimitTransform(
  maximumBytes: number,
  mediaLabel = "image"
) {
  let receivedBytes = 0

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength

      if (receivedBytes > maximumBytes) {
        callback(
          new CaptureSourceError(`This ${mediaLabel} is too large to save.`)
        )
        return
      }

      callback(null, chunk)
    },
  })
}

export function createImageValidationTransform(
  mimeType: LibraryUploadMimeType,
  maximumBytes: number
) {
  let buffered = Buffer.alloc(0)
  let receivedBytes = 0
  let validated = false

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength
      if (receivedBytes > maximumBytes) {
        callback(new CaptureSourceError("This image is too large to save."))
        return
      }

      if (validated) {
        callback(null, chunk)
        return
      }

      buffered = Buffer.concat([buffered, chunk])
      if (buffered.byteLength < 32) {
        callback()
        return
      }

      if (detectImageMimeType(buffered) !== mimeType) {
        callback(new CaptureSourceError("This image format is not supported."))
        return
      }

      validated = true
      callback(null, buffered)
      buffered = Buffer.alloc(0)
    },
    flush(callback) {
      if (!validated && detectImageMimeType(buffered) !== mimeType) {
        callback(new CaptureSourceError("This image format is not supported."))
        return
      }
      if (!validated) this.push(buffered)
      callback()
    },
  })
}

function detectImageMimeType(bytes: Buffer): LibraryUploadMimeType | undefined {
  if (
    bytes.byteLength >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png"
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg"
  }
  if (
    bytes.byteLength >= 6 &&
    ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif"
  }
  if (
    bytes.byteLength >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  if (
    bytes.byteLength >= 16 &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    for (let offset = 8; offset + 4 <= bytes.byteLength; offset += 4) {
      if (
        ["avif", "avis"].includes(
          bytes.subarray(offset, offset + 4).toString("ascii")
        )
      ) {
        return "image/avif"
      }
    }
  }

  return undefined
}

export function normalizeLibraryUploadFileName(
  value: string,
  mimeType: LibraryUploadMimeType | "video/mp4" | "video/webm"
) {
  const extensionByMimeType: Record<
    LibraryUploadMimeType | "video/mp4" | "video/webm",
    string
  > = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
  }
  const extension = extensionByMimeType[mimeType]
  const cleaned = removeControlCharacters(value.replace(/[\\/]+/g, "-")).trim()
  const stem = removeFileExtension(cleaned).trim() || "upload"
  const maximumStemLength = 240 - extension.length - 1

  return `${stem.slice(0, maximumStemLength)}.${extension}`
}

export function createVideoValidationTransform(
  mimeType: string,
  maximumBytes: number
) {
  let buffered = Buffer.alloc(0)
  let receivedBytes = 0
  let validated = false

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength
      if (receivedBytes > maximumBytes) {
        callback(new CaptureSourceError("This video is too large to save."))
        return
      }

      if (validated) {
        callback(null, chunk)
        return
      }

      buffered = Buffer.concat([buffered, chunk])
      if (buffered.byteLength < 12) {
        callback()
        return
      }

      if (!hasSupportedVideoSignature(buffered, mimeType)) {
        callback(new CaptureSourceError("This video format is not supported."))
        return
      }

      validated = true
      callback(null, buffered)
      buffered = Buffer.alloc(0)
    },
    flush(callback) {
      if (!validated) {
        callback(new CaptureSourceError("This video format is not supported."))
        return
      }
      callback()
    },
  })
}

function hasSupportedVideoSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "video/webm") {
    return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  }

  return (
    mimeType === "video/mp4" &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp"
  )
}

function normalizeMediaMimeType(
  value: string | null,
  kind: CaptureDraft["kind"]
) {
  const mimeType = value?.split(";")[0]?.trim().toLowerCase() ?? ""
  const allowedTypes = kind === "video" ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES

  if (!allowedTypes.has(mimeType)) {
    throw new CaptureSourceError(`This ${kind} format is not supported.`)
  }

  return mimeType
}

async function saveVideoPoster(
  drive: drive_v3.Drive,
  sourceUrl: string,
  title: string,
  folderId: string,
  captureId?: string
) {
  const response = await fetchSafeRemoteSource(sourceUrl, {
    headers: { "User-Agent": "Akasha Capture/1.0" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok || !response.body) return undefined

  const mimeType = normalizeMediaMimeType(
    response.headers.get("Content-Type"),
    "image"
  )
  const contentLength = Number(response.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_POSTER_BYTES) {
    return undefined
  }

  const sourceStream = Readable.fromWeb(
    response.body as unknown as NodeReadableStream
  )

  try {
    const extension = mimeType.split("/")[1] ?? "jpg"
    const created = await drive.files.create({
      fields: "id",
      media: {
        body: sourceStream.pipe(
          createSizeLimitTransform(MAXIMUM_POSTER_BYTES, "poster")
        ),
        mimeType,
      },
      requestBody: {
        appProperties: {
          ...(captureId ? { akashaCaptureId: `${captureId}:poster` } : {}),
          stillroomType: "poster",
        },
        mimeType,
        name: `${slugify(title)}-poster.${extension}`,
        parents: [folderId],
      },
    })
    return created.data.id ?? undefined
  } finally {
    sourceStream.destroy()
  }
}

async function findCaptureById(drive: drive_v3.Drive, captureId: string) {
  const response = await drive.files.list({
    fields:
      "files(id,name,mimeType,parents,thumbnailLink,appProperties,createdTime)",
    pageSize: 1,
    q: `appProperties has { key='akashaCaptureId' and value='${captureId}' } and trashed = false`,
    spaces: "drive",
  })

  return response.data.files?.[0]
}

async function findDuplicateByProperty(
  drive: drive_v3.Drive,
  property: string,
  value: string,
  timings: CaptureSaveTimings
) {
  const dedupeStartedAt = performance.now()
  const response = await drive.files.list({
    fields:
      "files(id,name,mimeType,size,parents,thumbnailLink,appProperties,createdTime)",
    pageSize: 1,
    q: buildCapturePropertyQuery(property, value),
    spaces: "drive",
  })
  timings.dedupeMs += performance.now() - dedupeStartedAt

  return response.data.files?.[0]
}

export async function finalizeContentHash(
  drive: drive_v3.Drive,
  file: drive_v3.Schema$File,
  contentHash: string,
  timings: CaptureSaveTimings
): Promise<{ file: drive_v3.Schema$File; outcome: CaptureOutcome }> {
  const duplicate = await findDuplicateByProperty(
    drive,
    CONTENT_HASH_PROPERTY,
    contentHash,
    timings
  )

  if (duplicate && duplicate.id === file.id)
    return { file: duplicate, outcome: "saved" }
  if (duplicate) {
    const dedupeStartedAt = performance.now()
    await drive.files.update({
      fileId: file.id!,
      fields: "id,trashed",
      requestBody: {
        trashed: true,
        ...(file.appProperties?.stillroomType === "upload_pending"
          ? {
              appProperties: {
                ...file.appProperties,
                akashaDuplicateOf: duplicate.id!,
              },
            }
          : {}),
      },
    })
    timings.dedupeMs += performance.now() - dedupeStartedAt
    return { file: duplicate, outcome: "already_saved" }
  }

  const dedupeStartedAt = performance.now()
  const fingerprinted = await drive.files.update({
    fileId: file.id!,
    fields:
      "id,name,mimeType,size,parents,thumbnailLink,webViewLink,appProperties,createdTime",
    requestBody: {
      appProperties: {
        ...file.appProperties,
        [CONTENT_HASH_PROPERTY]: contentHash,
      },
    },
  })
  timings.dedupeMs += performance.now() - dedupeStartedAt
  return { file: fingerprinted.data, outcome: "saved" }
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>
) {
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex]
        nextIndex += 1
        if (value !== undefined) await operation(value)
      }
    })
  )
}

export async function fetchSafeRemoteSource(
  value: string,
  init: RequestInit = {},
  dependencies: {
    fetcher?: typeof fetch
    resolveAddresses?: (hostname: string) => Promise<string[]>
  } = {}
) {
  const fetcher = dependencies.fetcher ?? fetch
  const resolveAddresses =
    dependencies.resolveAddresses ??
    (async (hostname: string) =>
      (await lookup(hostname, { all: true, verbatim: true })).map(
        (entry) => entry.address
      ))
  let currentUrl = new URL(value)

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertSafeRemoteSourceUrl(currentUrl.toString())
    const hostname = normalizeHostname(currentUrl.hostname)
    const addresses = isIP(hostname)
      ? [hostname]
      : await resolveAddresses(hostname)

    if (addresses.length === 0 || addresses.some(isPrivateIpAddress)) {
      throw new CaptureSourceError(
        "Akasha cannot download media from private addresses."
      )
    }

    const response = await fetcher(currentUrl, { ...init, redirect: "manual" })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response

    const location = response.headers.get("Location")
    await response.body?.cancel()
    if (!location) {
      throw new CaptureSourceError(
        "The media source returned an invalid redirect."
      )
    }
    currentUrl = new URL(location, currentUrl)
  }

  throw new CaptureSourceError("The media source redirected too many times.")
}

function assertSafeRemoteSourceUrl(value: string) {
  const url = new URL(value)
  const hostname = normalizeHostname(url.hostname)

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new CaptureSourceError("Akasha can only save remote media.")
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIpAddress(hostname)
  ) {
    throw new CaptureSourceError(
      "Akasha cannot download media from private addresses."
    )
  }
}

export function isPrivateIpAddress(hostname: string) {
  hostname = normalizeHostname(hostname)
  const ipVersion = isIP(hostname)

  if (ipVersion === 4) {
    const [first = 0, second = 0, third = 0] = hostname.split(".").map(Number)
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 198 && [18, 19, 51].includes(second)) ||
      (first === 203 && second === 0 && third === 113) ||
      first === 0 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first >= 224
    )
  }

  if (ipVersion === 6) {
    return (
      hostname === "::1" ||
      hostname === "::" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb") ||
      hostname.startsWith("ff") ||
      hostname.startsWith("::ffff:")
    )
  }

  return false
}

function normalizeHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized
}

function removeFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "")
}

function removeControlCharacters(value: string) {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 32 && codePoint !== 127
    })
    .join("")
}

function slugify(value: string) {
  const slug = value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)

  return slug || "saved-inspiration"
}
