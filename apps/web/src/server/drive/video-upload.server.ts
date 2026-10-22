import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import {
  maximumVideoUploadBytes,
  videoUploadChunkBytes,
  videoUploadMimeTypes,
} from "@akasha/contracts"
import { z } from "zod"
import type { GoogleTokenCredentials } from "../auth/google-oauth.server"
import { getSessionSecret } from "../env.server"
import {
  CaptureSourceError,
  createDriveClient,
  createVideoValidationTransform,
  finalizeContentHash,
  normalizeLibraryUploadFileName,
} from "./drive.server"
import { assertLibraryUploadDestination } from "./library-upload.server"

export const videoUploadInput = z.object({
  fileName: z.string().trim().min(1).max(240),
  folderId: z.string().min(1).max(200),
  mimeType: z.enum(videoUploadMimeTypes),
  byteSize: z.int().positive().max(maximumVideoUploadBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
type Upload = z.infer<typeof videoUploadInput> & {
  fileId: string
  uri: string
  owner: string
  expires: number
}
const fields =
  "id,name,size,mimeType,sha256Checksum,appProperties,parents,trashed"

export async function startVideoUpload(
  credentials: GoogleTokenCredentials,
  input: z.infer<typeof videoUploadInput>
) {
  await assertLibraryUploadDestination(credentials, input.folderId)
  const drive = createDriveClient(credentials)
  const ids = await drive.files.generateIds({ count: 1 })
  const fileId = ids.data.ids?.[0]
  if (!fileId) throw new Error("Could not start upload.")
  const name = normalizeLibraryUploadFileName(input.fileName, input.mimeType)
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.byteSize),
      },
      body: JSON.stringify({
        id: fileId,
        name,
        mimeType: input.mimeType,
        parents: [input.folderId],
        description: JSON.stringify({
          storageMode: "binary",
          title: name.replace(/\.[^.]+$/, ""),
        }),
        appProperties: {
          stillroomType: "upload_pending",
          stillroomKind: "video",
          stillroomOrigin: "upload",
        },
      }),
    }
  )
  const uri = response.headers.get("location")
  if (
    !response.ok ||
    !uri ||
    new URL(uri).origin !== "https://www.googleapis.com"
  )
    throw new Error("Could not start upload.")
  return {
    token: seal({
      ...input,
      fileId,
      uri,
      owner: owner(credentials),
      expires: Date.now() + 6 * 24 * 60 * 60_000,
    }),
    offset: 0,
  }
}

export async function continueVideoUpload(
  credentials: GoogleTokenCredentials,
  token: string,
  chunk?: { offset: number; bytes: Uint8Array }
) {
  const upload = unseal(token, credentials)
  if (
    chunk &&
    (!Number.isSafeInteger(chunk.offset) ||
      chunk.offset < 0 ||
      chunk.offset % (256 * 1024) !== 0 ||
      chunk.bytes.length === 0 ||
      chunk.bytes.length > videoUploadChunkBytes ||
      chunk.offset + chunk.bytes.length > upload.byteSize ||
      (chunk.offset + chunk.bytes.length < upload.byteSize &&
        chunk.bytes.length % (256 * 1024) !== 0))
  )
    throw new CaptureSourceError("Invalid upload chunk.")
  const response = await fetch(upload.uri, {
    method: "PUT",
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": upload.mimeType,
      "Content-Length": String(chunk?.bytes.length ?? 0),
      "Content-Range": chunk
        ? `bytes ${chunk.offset}-${chunk.offset + chunk.bytes.length - 1}/${upload.byteSize}`
        : `bytes */${upload.byteSize}`,
    },
    body: chunk ? Buffer.from(chunk.bytes) : undefined,
  })
  if (response.status === 308) {
    const range = response.headers.get("range")
    const match = range?.match(/^bytes=0-(\d+)$/)
    const offset = match ? Number(match[1]) + 1 : 0
    if (offset > upload.byteSize) throw new Error("Invalid upload progress.")
    return { offset }
  }
  // A completed session may no longer answer status probes. Its preallocated ID
  // lets recovery validate the stored file without starting another upload.
  if (response.ok || response.status === 404 || response.status === 410)
    return finishVideoUpload(credentials, upload)
  throw new Error("The upload was interrupted. Retry to continue.")
}

async function finishVideoUpload(
  credentials: GoogleTokenCredentials,
  upload: Upload
) {
  const drive = createDriveClient(credentials)
  const file = await drive.files
    .get({ fileId: upload.fileId, fields })
    .then((r) => r.data)
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === 404
      )
        throw new CaptureSourceError(
          "This upload expired. Remove it and select the file again."
        )
      throw error
    })
  if (file.appProperties?.stillroomType === "item" && !file.trashed)
    return { offset: upload.byteSize, outcome: "saved" as const }
  if (
    file.appProperties?.stillroomType !== "upload_pending" ||
    !file.parents?.includes(upload.folderId)
  )
    throw new CaptureSourceError("This upload is no longer available.")
  if (
    Number(file.size) !== upload.byteSize ||
    file.mimeType !== upload.mimeType ||
    file.sha256Checksum !== upload.sha256
  ) {
    await drive.files.update({
      fileId: upload.fileId,
      requestBody: { trashed: true },
    })
    throw new CaptureSourceError(
      "The uploaded file does not match. Select the original file again."
    )
  }
  if (file.trashed && file.appProperties.akashaDuplicateOf)
    return { offset: upload.byteSize, outcome: "already_saved" as const }
  await assertLibraryUploadDestination(credentials, upload.folderId)
  const header = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(upload.fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Range: "bytes=0-63",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (header.status !== 206) {
    await header.body?.cancel()
    throw new Error("Could not verify uploaded video.")
  }
  const validator = createVideoValidationTransform(upload.mimeType, 64)
  const validation = (async () => {
    for await (const _chunk of validator) {
      /* Validate using the existing binary-video owner. */
    }
  })()
  validator.end(Buffer.from(await header.arrayBuffer()))
  try {
    await validation
  } catch (error) {
    await drive.files.update({
      fileId: upload.fileId,
      requestBody: { trashed: true },
    })
    throw error
  }
  const result = await finalizeContentHash(drive, file, upload.sha256, {
    dedupeMs: 0,
    driveUploadMs: 0,
    idempotencyMs: 0,
    sourceResponseMs: 0,
  })
  if (result.outcome === "saved")
    await drive.files.update({
      fileId: upload.fileId,
      requestBody: {
        appProperties: { ...result.file.appProperties, stillroomType: "item" },
      },
    })
  return { offset: upload.byteSize, outcome: result.outcome }
}

function owner(credentials: GoogleTokenCredentials) {
  return createHash("sha256").update(credentials.refreshToken).digest("hex")
}
function key() {
  return createHash("sha256")
    .update(`akasha-video-upload-v1\0${getSessionSecret()}`)
    .digest()
}
function seal(upload: Upload) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(upload)),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url")
}
function unseal(token: string, credentials: GoogleTokenCredentials): Upload {
  try {
    if (token.length > 12_000) throw new Error()
    const bytes = Buffer.from(token, "base64url")
    if (bytes.toString("base64url") !== token) throw new Error()
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      bytes.subarray(0, 12)
    )
    decipher.setAuthTag(bytes.subarray(12, 28))
    const upload = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString()
    ) as Upload
    if (upload.owner !== owner(credentials) || upload.expires < Date.now())
      throw new Error()
    return upload
  } catch {
    throw new CaptureSourceError(
      "This upload expired. Remove it and select the file again."
    )
  }
}
