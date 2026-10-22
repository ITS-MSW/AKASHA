import { z } from "zod"

export const libraryUploadMimeTypes = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const
export const videoUploadMimeTypes = ["video/mp4", "video/webm"] as const
export const maximumVideoUploadBytes = 50 * 1024 * 1024
export const videoUploadChunkBytes = 1024 * 1024
export const maximumLibraryUploadBytes = 20 * 1024 * 1024

export const mediaKindSchema = z.enum(["image", "video"])
export const mediaStorageSchema = z.enum(["binary", "reference"])
export const captureOutcomeSchema = z.enum(["saved", "already_saved"])
export const libraryUploadMimeTypeSchema = z.enum(libraryUploadMimeTypes)

export const captureDraftSchema = z.object({
  kind: mediaKindSchema,
  storageMode: mediaStorageSchema.optional(),
  sourceUrl: z.url(),
  pageUrl: z.url(),
  videoVariants: z
    .array(z.object({ url: z.url(), bitrate: z.number().nonnegative() }))
    .max(12)
    .optional(),
  title: z.string().trim().min(1).max(240),
  thumbnailUrl: z.union([z.url(), z.string().startsWith("/")]).optional(),
  durationSeconds: z.number().nonnegative().optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
})

export const libraryFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable(),
})

export const libraryItemSchema = z.object({
  id: z.string().min(1),
  driveFileId: z.string().min(1),
  folderId: z.string().min(1),
  kind: mediaKindSchema,
  storageMode: mediaStorageSchema.optional(),
  title: z.string().trim().min(1).max(240),
  sourceUrl: z.url(),
  thumbnailUrl: z.union([z.url(), z.string().startsWith("/")]).optional(),
  sourceLabel: z.string().trim().min(1).max(120),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  durationSeconds: z.int().nonnegative().optional(),
  byteSize: z.int().nonnegative().optional(),
  mimeType: z.string().trim().min(1).optional(),
  capturedAt: z.iso.datetime(),
})

export const captureRequestSchema = captureDraftSchema.extend({
  attempt: z.int().positive().default(1),
  captureId: z.uuid().optional(),
  folderId: z.string().min(1),
})

export type CaptureDraft = z.infer<typeof captureDraftSchema>
export type CaptureOutcome = z.infer<typeof captureOutcomeSchema>
export type CaptureRequest = z.infer<typeof captureRequestSchema>
export type LibraryFolder = z.infer<typeof libraryFolderSchema>
export type LibraryItem = z.infer<typeof libraryItemSchema>
export type LibraryUploadMimeType = z.infer<typeof libraryUploadMimeTypeSchema>
export type MediaKind = z.infer<typeof mediaKindSchema>
export type MediaStorage = z.infer<typeof mediaStorageSchema>
