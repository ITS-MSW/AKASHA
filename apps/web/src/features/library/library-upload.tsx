import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { UploadSimpleIcon } from "@phosphor-icons/react"
import { Button, toast, Typography } from "@heroui/react"
import { DropZone, useDropZonePickerContext } from "@heroui-pro/react"
import {
  libraryUploadMimeTypes,
  maximumLibraryUploadBytes,
  maximumVideoUploadBytes,
  videoUploadMimeTypes,
} from "@akasha/contracts"
import type { CaptureOutcome } from "@akasha/contracts"

import { useLocalStorage } from "@/hooks/use-local-storage"
import {
  emptyPendingVideos,
  parsePendingVideos,
  reportUploadStorageError,
  uploadVideo,
} from "./video-upload"
import type { PendingVideoUpload } from "./video-upload"

const uploadConcurrency = 2

type UploadStatus =
  "complete" | "duplicate" | "failed" | "queued" | "saving" | "uploading"

type UploadTask = {
  error?: string
  resume?: PendingVideoUpload
  file: File
  folderId: string
  folderName: string
  id: string
  progress: number
  status: UploadStatus
}

export type LibraryUploaderHandle = {
  addFiles: (files: File[]) => void
  openFilePicker: () => void
}

type LibraryUploaderProps = {
  rootFolderId: string
  folderId: string
  folderName: string
  onRefresh: () => Promise<void>
}

export const LibraryUploader = forwardRef<
  LibraryUploaderHandle,
  LibraryUploaderProps
>(function LibraryUploader(
  { rootFolderId, folderId, folderName, onRefresh },
  ref
) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [pendingVideos, setPendingVideos] = useLocalStorage(
    `akasha:video-uploads:${rootFolderId}`,
    emptyPendingVideos,
    { parse: parsePendingVideos, onError: reportUploadStorageError }
  )
  const resumeRef = useRef<PendingVideoUpload | null>(null)
  const batchChainRef = useRef(Promise.resolve())
  const openFilePickerRef = useRef<() => void>(() => undefined)

  const updateTask = useCallback(
    (id: string, update: Partial<Omit<UploadTask, "id">>) => {
      setTasks((current) =>
        current.map((task) => (task.id === id ? { ...task, ...update } : task))
      )
    },
    []
  )

  const runBatch = useCallback(
    async (batch: UploadTask[]) => {
      let savedCount = 0
      let duplicateCount = 0
      let failedCount = 0

      await runWithConcurrency(batch, uploadConcurrency, async (task) => {
        updateTask(task.id, {
          error: undefined,
          progress: 0,
          status: "uploading",
        })

        try {
          const onProgress = (progress: number, saving: boolean) => {
            updateTask(task.id, {
              progress,
              status: saving ? "saving" : "uploading",
            })
          }
          const outcome = task.file.type.startsWith("video/")
            ? await uploadVideo(
                task.file,
                task,
                (session) => {
                  task.resume = session
                  setPendingVideos((current) => [
                    ...current.filter((item) => item.id !== session.id),
                    session,
                  ])
                },
                onProgress
              )
            : await uploadLibraryImage(task, onProgress)
          if (task.resume)
            setPendingVideos((current) =>
              current.filter((item) => item.id !== task.resume!.id)
            )
          if (outcome === "already_saved") {
            duplicateCount += 1
            updateTask(task.id, { progress: 100, status: "duplicate" })
          } else {
            savedCount += 1
            updateTask(task.id, { progress: 100, status: "complete" })
          }
        } catch (error) {
          failedCount += 1
          updateTask(task.id, {
            error:
              error instanceof Error
                ? error.message
                : "Akasha could not upload this file.",
            status: "failed",
          })
        }
      })

      if (savedCount > 0) {
        await onRefresh().catch(() => {
          toast.warning("Upload complete. Refresh Akasha to see the new files.")
        })
      }

      if (failedCount > 0) {
        toast.danger(formatFailureMessage(failedCount), {
          description: "Failed files remain in the upload list.",
        })
      } else if (savedCount > 0) {
        toast.success(
          formatSavedMessage(savedCount, batch[0]?.folderName ?? "Akasha")
        )
      }
      if (duplicateCount > 0) {
        toast.info(formatDuplicateMessage(duplicateCount))
      }
    },
    [onRefresh, updateTask, setPendingVideos]
  )

  const queueBatch = useCallback(
    (batch: UploadTask[]) => {
      batchChainRef.current = batchChainRef.current
        .catch(() => undefined)
        .then(() => runBatch(batch))
    },
    [runBatch]
  )

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted: UploadTask[] = []
      const rejected: string[] = []

      const resume = resumeRef.current
      resumeRef.current = null
      for (const [index, file] of (resume
        ? files.slice(0, 1)
        : files
      ).entries()) {
        const error = getFileValidationError(file)
        if (error) {
          rejected.push(`${file.name}: ${error}`)
          continue
        }

        accepted.push({
          file,
          folderId: resume?.folderId ?? folderId,
          folderName: resume?.folderName ?? folderName,
          id: resume?.id ?? `${crypto.randomUUID()}-${index}`,
          resume: resume ?? undefined,
          progress: 0,
          status: "queued",
        })
      }

      if (rejected.length > 0) {
        toast.danger(
          rejected.length === 1
            ? rejected[0]
            : `${rejected.length} files could not be added.`
        )
      }
      if (accepted.length === 0) return

      setTasks((current) => [
        ...accepted,
        ...current.filter(
          (task) => !accepted.some((item) => item.id === task.id)
        ),
      ])
      queueBatch(accepted)
    },
    [folderId, folderName, queueBatch]
  )

  const retryTask = useCallback(
    (task: UploadTask) => {
      updateTask(task.id, {
        error: undefined,
        progress: 0,
        status: "queued",
      })
      queueBatch([task])
    },
    [queueBatch, updateTask]
  )

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files) => {
        resumeRef.current = null
        addFiles(files)
      },
      openFilePicker: () => {
        resumeRef.current = null
        openFilePickerRef.current()
      },
    }),
    [addFiles]
  )

  useEffect(() => {
    if (
      !tasks.some((task) => ["complete", "duplicate"].includes(task.status))
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      setTasks((current) =>
        current.filter(
          (task) => !["complete", "duplicate"].includes(task.status)
        )
      )
    }, 4_000)

    return () => window.clearTimeout(timeout)
  }, [tasks])

  return (
    <>
      <DropZone>
        <UploadPicker
          onOpenReady={(openFilePicker) => {
            openFilePickerRef.current = openFilePicker
          }}
          onSelect={(files) => addFiles(Array.from(files))}
        />
      </DropZone>
      {tasks.length > 0 || pendingVideos.length > 0 ? (
        <aside
          aria-label="Uploads"
          aria-live="polite"
          className="fixed right-4 bottom-4 z-40 grid max-h-[min(32rem,calc(100dvh-2rem))] w-[min(26rem,calc(100vw-2rem))] gap-3 overflow-auto rounded-2xl border border-border bg-surface p-3 shadow-overlay"
        >
          <Typography weight="semibold">Uploads</Typography>
          {pendingVideos
            .filter((item) => !tasks.some((task) => task.id === item.id))
            .map((item) => (
              <div key={item.id}>
                <Typography>{item.fileName}</Typography>
                <Button
                  size="sm"
                  onPress={() => {
                    resumeRef.current = item
                    openFilePickerRef.current()
                  }}
                >
                  Select file to resume
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    setPendingVideos((current) =>
                      current.filter((value) => value.id !== item.id)
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          <DropZone>
            <DropZone.FileList>
              {tasks.map((task) => (
                <DropZone.FileItem
                  key={task.id}
                  status={
                    task.status === "failed"
                      ? "failed"
                      : task.status === "complete" ||
                          task.status === "duplicate"
                        ? "complete"
                        : "uploading"
                  }
                >
                  <DropZone.FileFormatIcon
                    color="purple"
                    format={getFileExtension(task.file.name)}
                  />
                  <DropZone.FileInfo>
                    <DropZone.FileName>{task.file.name}</DropZone.FileName>
                    <DropZone.FileMeta>
                      {getTaskStatusLabel(task)}
                    </DropZone.FileMeta>
                    {task.status === "uploading" || task.status === "saving" ? (
                      <DropZone.FileProgress
                        isIndeterminate={task.status === "saving"}
                        value={task.progress}
                      >
                        <DropZone.FileProgressTrack>
                          <DropZone.FileProgressFill />
                        </DropZone.FileProgressTrack>
                      </DropZone.FileProgress>
                    ) : null}
                    {task.status === "failed" ? (
                      <DropZone.FileRetryTrigger
                        onPress={() => retryTask(task)}
                      />
                    ) : null}
                  </DropZone.FileInfo>
                  {task.status === "failed" ? (
                    <DropZone.FileRemoveTrigger
                      aria-label={`Remove ${task.file.name}`}
                      onPress={() => {
                        setTasks((current) =>
                          current.filter((item) => item.id !== task.id)
                        )
                        setPendingVideos((current) =>
                          current.filter((item) => item.id !== task.id)
                        )
                      }}
                    />
                  ) : null}
                </DropZone.FileItem>
              ))}
            </DropZone.FileList>
          </DropZone>
        </aside>
      ) : null}
    </>
  )
})

type LibraryDropTargetProps = {
  children: React.ReactNode
  folderName: string
  onFiles: (files: File[]) => void
}

export function LibraryDropTarget({
  children,
  folderName,
  onFiles,
}: LibraryDropTargetProps) {
  const dragDepthRef = useRef(0)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  return (
    <div
      className="relative"
      data-library-upload-zone
      onDragEnter={(event) => {
        if (!hasDraggedFiles(event.dataTransfer)) return
        event.preventDefault()
        dragDepthRef.current += 1
        setIsDraggingFiles(true)
      }}
      onDragLeave={(event) => {
        if (!hasDraggedFiles(event.dataTransfer)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setIsDraggingFiles(false)
      }}
      onDragOver={(event) => {
        if (!hasDraggedFiles(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        if (!hasDraggedFiles(event.dataTransfer)) return
        event.preventDefault()
        dragDepthRef.current = 0
        setIsDraggingFiles(false)
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {isDraggingFiles ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-3xl bg-[color-mix(in_oklch,var(--background)_82%,transparent)] p-6 backdrop-blur-md"
        >
          <DropZone>
            <DropZone.Area>
              <DropZone.Icon>
                <UploadSimpleIcon aria-hidden="true" />
              </DropZone.Icon>
              <DropZone.Label>Drop into {folderName}</DropZone.Label>
            </DropZone.Area>
          </DropZone>
        </div>
      ) : null}
    </div>
  )
}

function UploadPicker({
  onOpenReady,
  onSelect,
}: {
  onOpenReady: (openFilePicker: () => void) => void
  onSelect: (files: FileList) => void
}) {
  const { openFilePicker } = useDropZonePickerContext()

  useEffect(() => onOpenReady(openFilePicker), [onOpenReady, openFilePicker])

  return (
    <DropZone.Input
      accept={[...libraryUploadMimeTypes, ...videoUploadMimeTypes].join(",")}
      multiple
      onSelect={onSelect}
    />
  )
}

function uploadLibraryImage(
  task: UploadTask,
  onProgress: (progress: number, saving: boolean) => void
) {
  return new Promise<CaptureOutcome>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const form = new FormData()
    form.set("file", task.file)
    form.set("folderId", task.folderId)

    request.open("POST", "/api/uploads")
    request.responseType = "json"
    request.timeout = 90_000
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return
      onProgress(
        Math.min(99, Math.round((event.loaded / event.total) * 100)),
        false
      )
    })
    request.upload.addEventListener("load", () => onProgress(100, true))
    request.addEventListener("load", () => {
      const response = request.response as {
        error?: string
        outcome?: CaptureOutcome
      } | null
      if (request.status >= 200 && request.status < 300 && response?.outcome) {
        resolve(response.outcome)
        return
      }
      reject(new Error(response?.error ?? "Akasha could not upload this file."))
    })
    request.addEventListener("error", () =>
      reject(new Error("The upload was interrupted."))
    )
    request.addEventListener("timeout", () =>
      reject(new Error("The upload took too long."))
    )
    request.send(form)
  })
}

function getFileValidationError(file: File) {
  if (
    ![...libraryUploadMimeTypes, ...videoUploadMimeTypes].includes(
      file.type as (typeof libraryUploadMimeTypes)[number]
    )
  ) {
    return "Unsupported file format"
  }
  if (file.size === 0) return "File is empty"
  if (file.type.startsWith("video/"))
    return file.size > maximumVideoUploadBytes
      ? "Video exceeds 50 MiB"
      : undefined
  if (file.size > maximumLibraryUploadBytes) return "Image exceeds 20 MB"
  return undefined
}

function getTaskStatusLabel(task: UploadTask) {
  if (task.status === "queued") return "Queued"
  if (task.status === "uploading") return `${task.progress}%`
  if (task.status === "saving") return "Saving"
  if (task.status === "complete") return "Uploaded"
  if (task.status === "duplicate") return "Already in Akasha"
  return task.error ?? "Upload failed"
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.slice(0, 5).toUpperCase() || "IMG"
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

function formatSavedMessage(count: number, folderName: string) {
  return count === 1
    ? `File uploaded to ${folderName}.`
    : `${count} files uploaded to ${folderName}.`
}

function formatDuplicateMessage(count: number) {
  return count === 1
    ? "File already exists in Akasha."
    : `${count} files already exist in Akasha.`
}

function formatFailureMessage(count: number) {
  return count === 1 ? "File upload failed." : `${count} file uploads failed.`
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
