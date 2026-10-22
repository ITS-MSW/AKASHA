import type { drive_v3 } from "googleapis"
import { libraryFolderSchema, libraryItemSchema } from "@akasha/contracts"
import type { LibraryFolder, LibraryItem, MediaKind } from "@akasha/contracts"

import type { GoogleTokenCredentials } from "../auth/google-oauth.server"
import {
  createDriveClient,
  FOLDER_MIME_TYPE,
  listStillroomLibrary,
} from "./drive.server"
import { createDriveThumbnailUrl } from "./drive-thumbnail.server"

export type DriveLibrarySnapshot = {
  folders: LibraryFolder[]
  items: LibraryItem[]
  rootFolderId: string
  user?: DriveLibraryUser
}

export type DriveLibraryUser = {
  displayName?: string
  emailAddress?: string
  photoLink?: string
}

export async function loadDriveLibrary(
  credentials: GoogleTokenCredentials
): Promise<DriveLibrarySnapshot> {
  const drive = createDriveClient(credentials)
  const [{ files, root }, user] = await Promise.all([
    listStillroomLibrary(drive),
    loadDriveUser(drive),
  ])

  if (!root.id) {
    throw new Error("Akasha could not initialize the library root.")
  }

  return buildDriveLibrarySnapshot(root.id, files, user)
}

export function buildDriveLibrarySnapshot(
  rootFolderId: string,
  files: drive_v3.Schema$File[],
  user?: DriveLibraryUser
): DriveLibrarySnapshot {
  const filesByParent = new Map<string, drive_v3.Schema$File[]>()
  const filesById = new Map(
    files.flatMap((file) => (file.id ? [[file.id, file] as const] : []))
  )

  for (const file of files) {
    for (const parentId of file.parents ?? []) {
      const siblings = filesByParent.get(parentId) ?? []
      siblings.push(file)
      filesByParent.set(parentId, siblings)
    }
  }

  const folders: LibraryFolder[] = []
  const items: LibraryItem[] = []
  const pendingFolders: Array<{
    driveFolderId: string
    parentId: string | null
  }> = [{ driveFolderId: rootFolderId, parentId: null }]
  const visitedFolderIds = new Set<string>([rootFolderId])

  while (pendingFolders.length > 0) {
    const current = pendingFolders.shift()
    if (!current) break

    for (const file of filesByParent.get(current.driveFolderId) ?? []) {
      if (file.mimeType === FOLDER_MIME_TYPE) {
        if (!file.id || !file.name || visitedFolderIds.has(file.id)) continue

        folders.push(
          libraryFolderSchema.parse({
            id: file.id,
            name: file.name,
            parentId: current.parentId,
          })
        )
        visitedFolderIds.add(file.id)
        pendingFolders.push({ driveFolderId: file.id, parentId: file.id })
        continue
      }

      const item = mapDriveFileToLibraryItem(file, current.driveFolderId, {
        createThumbnailUrl: createDefaultThumbnailUrl,
        filesById,
      })
      if (item) items.push(item)
    }
  }

  return { folders, items, rootFolderId, user }
}

async function loadDriveUser(drive: drive_v3.Drive): Promise<DriveLibraryUser> {
  const response = await drive.about.get({
    fields: "user(displayName,emailAddress,photoLink)",
  })

  return {
    displayName: response.data.user?.displayName ?? undefined,
    emailAddress: response.data.user?.emailAddress ?? undefined,
    photoLink: response.data.user?.photoLink ?? undefined,
  }
}

export function mapDriveFileToLibraryItem(
  file: drive_v3.Schema$File,
  folderId: string,
  thumbnailContext?: ThumbnailContext
) {
  if (
    ["poster", "upload_pending"].includes(
      file.appProperties?.stillroomType ?? ""
    )
  )
    return null

  const captureMetadata = parseCaptureMetadata(file.description)
  const sourceUrl = captureMetadata.sourceUrl ?? file.webViewLink

  if (!file.id || !file.name || !file.createdTime || !sourceUrl) {
    return null
  }

  const result = libraryItemSchema.safeParse({
    byteSize: parseByteSize(file.size),
    capturedAt: file.createdTime,
    driveFileId: file.id,
    durationSeconds:
      parseDurationSeconds(file.videoMediaMetadata?.durationMillis) ??
      normalizeDurationSeconds(captureMetadata.durationSeconds),
    folderId,
    height:
      file.imageMediaMetadata?.height ??
      file.videoMediaMetadata?.height ??
      captureMetadata.height,
    id: file.id,
    kind: parseMediaKind(file),
    mimeType: file.mimeType ?? undefined,
    sourceLabel: getSourceLabel(sourceUrl),
    sourceUrl,
    storageMode:
      captureMetadata.storageMode ??
      (file.mimeType === "application/json" ? "reference" : "binary"),
    thumbnailUrl: getThumbnailUrl(
      file,
      captureMetadata,
      folderId,
      thumbnailContext
    ),
    title: captureMetadata.title ?? removeFileExtension(file.name),
    width:
      file.imageMediaMetadata?.width ??
      file.videoMediaMetadata?.width ??
      captureMetadata.width,
  })

  return result.success ? result.data : null
}

type CaptureMetadata = {
  durationSeconds?: number
  height?: number
  pageUrl?: string
  posterDriveFileId?: string
  sourceUrl?: string
  storageMode?: "binary" | "reference"
  thumbnailUrl?: string
  title?: string
  width?: number
}

type ThumbnailUrlFactory = (
  fileId: string,
  thumbnailUrl: string
) => string | undefined

type ThumbnailContext = {
  createThumbnailUrl: ThumbnailUrlFactory
  filesById: ReadonlyMap<string, drive_v3.Schema$File>
}

function getThumbnailUrl(
  file: drive_v3.Schema$File,
  captureMetadata: CaptureMetadata,
  folderId: string,
  thumbnailContext?: ThumbnailContext
) {
  if (!thumbnailContext) {
    if (file.appProperties?.stillroomKind !== "video") {
      return `/api/media/${file.id}`
    }

    return captureMetadata.posterDriveFileId
      ? `/api/media/${captureMetadata.posterDriveFileId}`
      : captureMetadata.thumbnailUrl
  }

  if (file.appProperties?.stillroomKind !== "video") {
    return file.id && file.thumbnailLink
      ? thumbnailContext.createThumbnailUrl(file.id, file.thumbnailLink)
      : undefined
  }

  const poster = captureMetadata.posterDriveFileId
    ? thumbnailContext.filesById.get(captureMetadata.posterDriveFileId)
    : undefined
  const validPoster =
    poster?.id &&
    poster.thumbnailLink &&
    poster.parents?.includes(folderId) &&
    poster.appProperties?.stillroomType === "poster"
      ? poster
      : undefined

  if (validPoster?.id && validPoster.thumbnailLink) {
    return thumbnailContext.createThumbnailUrl(
      validPoster.id,
      validPoster.thumbnailLink
    )
  }

  if (file.id && file.thumbnailLink) {
    return thumbnailContext.createThumbnailUrl(file.id, file.thumbnailLink)
  }

  return captureMetadata.thumbnailUrl
}

function createDefaultThumbnailUrl(fileId: string, thumbnailUrl: string) {
  const secret = process.env.SESSION_SECRET
  if (!secret) return undefined

  return createDriveThumbnailUrl(fileId, thumbnailUrl, { secret })
}

function parseByteSize(size?: string | null) {
  if (!size) return undefined
  const value = Number(size)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function parseCaptureMetadata(description?: string | null): CaptureMetadata {
  if (!description) {
    return {}
  }

  try {
    return JSON.parse(description) as CaptureMetadata
  } catch {
    return {}
  }
}

function parseMediaKind(file: drive_v3.Schema$File): MediaKind {
  if (
    file.appProperties?.stillroomKind === "video" ||
    file.mimeType?.startsWith("video/")
  ) {
    return "video"
  }

  return "image"
}

function parseDurationSeconds(durationMillis?: string | null) {
  if (!durationMillis) {
    return undefined
  }

  const duration = Number(durationMillis)

  return Number.isFinite(duration) ? Math.round(duration / 1000) : undefined
}

function normalizeDurationSeconds(duration?: number) {
  return duration !== undefined && Number.isFinite(duration)
    ? Math.round(duration)
    : undefined
}

function getSourceLabel(sourceUrl: string) {
  return new URL(sourceUrl).hostname.replace(/^www\./, "")
}

function removeFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "")
}
