import { captureDraftSchema } from "@akasha/contracts"
import {
  AkashaApiError,
  backfillDuplicateMetadata,
  connectAkasha,
  hasAkashaCredential,
  listFolderOptions,
  saveCapture,
} from "@/utils/akasha-api"
import { createCaptureDraft, toCaptureSelection } from "@/utils/capture"
import { createCaptureResultNotification } from "@/utils/capture-result"
import type { ExtensionRequest, ExtensionResponse, OpenCapturePanelMessage } from "@/utils/messages"
import {
  type CaptureOutboxJob,
  createCaptureOutboxJob,
  prepareDeliveryAttempt,
  scheduleDeliveryRetry,
} from "@/utils/outbox"
import {
  captureDraftStorage,
  captureOutboxStorage,
  duplicateBackfillStorage,
  folderOptionsCacheStorage,
} from "@/utils/storage"

const CAPTURE_MENU_ID = "stillroom-capture-media"
const OUTBOX_ALARM_NAME = "akasha-capture-outbox"
const DEDUPE_BACKFILL_ALARM_NAME = "akasha-dedupe-backfill"
const FAILED_NOTIFICATION_PREFIX = "akasha-save-failed:"
const CAPTURE_PANEL_FILE = "content-scripts/akasha.js" as ScriptPublicPath
const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000

let storageMutation = Promise.resolve()
let outboxExecution: Promise<void> | null = null
let dedupeBackfillExecution: Promise<void> | null = null
let folderRefresh: Promise<Awaited<ReturnType<typeof listFolderOptions>>> | null = null

export default defineBackground(() => {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CAPTURE_MENU_ID) {
      return
    }

    let draft = createCaptureDraft(info, tab?.title)
    if (info.mediaType === "video" && tab?.id) {
      try {
        const result = await browser.tabs.sendMessage(tab.id, {
          type: "akasha:discover-video",
          srcUrl: info.srcUrl,
        })
        const parsed = captureDraftSchema.safeParse(result)
        draft = parsed.success && parsed.data.kind === "video" ? parsed.data : null
      } catch {
        draft = null
      }
    }

    if (!draft) {
      await showCaptureNotification(
        "Could not capture this media",
        info.mediaType === "video"
          ? "No downloadable video found. Reload the post and try again."
          : "Open the original image and try again."
      )
      return
    }

    let drafts = [draft]
    if (
      draft.kind === "image" &&
      tab?.id &&
      /^https:\/\/(www\.)?(x|twitter)\.com\//.test(info.pageUrl ?? "")
    ) {
      try {
        const discovered = await browser.tabs.sendMessage(tab.id, {
          type: "akasha:discover-images",
          srcUrl: info.srcUrl,
        })
        const parsed = captureDraftSchema.array().min(1).max(4).safeParse(discovered)
        if (
          parsed.success &&
          parsed.data.every(
            (item) => item.kind === "image" && item.pageUrl === parsed.data[0]?.pageUrl
          )
        )
          drafts = parsed.data
      } catch {
        // Existing tabs without the content script retain single-image capture.
      }
    }
    await withStorageMutation(() =>
      captureDraftStorage.setValue({
        id: crypto.randomUUID(),
        items: drafts.map((item) => ({ draft: item, captureId: crypto.randomUUID() })),
        origin:
          drafts.length > 1 && tab?.id && info.pageUrl && drafts[0]
            ? { tabId: tab.id, pageUrl: info.pageUrl, postUrl: drafts[0].pageUrl }
            : undefined,
      })
    )

    await openCapturePanel(tab?.id)
  })

  browser.action.onClicked.addListener(async () => {
    const failed = (await captureOutboxStorage.getValue()).find((job) => job.status === "failed")
    if (failed) await restoreFailedCapture(failed.batchId ?? failed.captureId)
    else
      await showCaptureNotification(
        "Save media",
        "Right-click an image or video and choose Save to Akasha."
      )
  })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OUTBOX_ALARM_NAME) void processOutbox()
    if (alarm.name === DEDUPE_BACKFILL_ALARM_NAME) void processDedupeBackfill()
  })
  browser.runtime.onStartup.addListener(() => {
    void processOutbox()
    void processDedupeBackfill()
  })
  browser.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith(FAILED_NOTIFICATION_PREFIX)) {
      void restoreFailedCapture(notificationId.slice(FAILED_NOTIFICATION_PREFIX.length))
    }
  })

  browser.runtime.onMessage.addListener((message: ExtensionRequest) =>
    handleExtensionRequest(message)
  )

  void processOutbox()
  void processDedupeBackfill()
  void ensureCaptureMenu()
})

async function ensureCaptureMenu() {
  try {
    await browser.contextMenus.update(CAPTURE_MENU_ID, {
      contexts: ["image", "video"],
      title: "Save to Akasha",
    })
  } catch {
    await browser.contextMenus.create({
      contexts: ["image", "video"],
      id: CAPTURE_MENU_ID,
      title: "Save to Akasha",
    })
  }
}

async function openCapturePanel(tabId?: number) {
  if (!tabId) return

  try {
    const message: OpenCapturePanelMessage = { type: "akasha:open-capture" }
    await sendOpenCaptureMessage(tabId, message)
  } catch {
    try {
      // Manifest content scripts are not added retroactively to tabs that were
      // already open when an unpacked extension was installed or reloaded.
      await browser.scripting.executeScript({
        files: [CAPTURE_PANEL_FILE],
        target: { tabId },
      })
      const message: OpenCapturePanelMessage = { type: "akasha:open-capture" }
      await sendOpenCaptureMessage(tabId, message, 5)
    } catch {
      await showCaptureNotification(
        "Open a webpage",
        "Akasha Capture is available on regular webpages."
      )
    }
  }
}

async function sendOpenCaptureMessage(
  tabId: number,
  message: OpenCapturePanelMessage,
  attempts = 1
) {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = (await browser.tabs.sendMessage(tabId, message)) as
        | { ok?: boolean }
        | undefined
      if (response?.ok !== true) throw new Error("Akasha Capture is not ready on this page.")
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  throw lastError
}

async function handleExtensionRequest(
  message: ExtensionRequest
): Promise<ExtensionResponse<unknown>> {
  try {
    if (message.type === "akasha:prepare-video") {
      const result = captureDraftSchema.safeParse(message.draft)
      if (!result.success || result.data.kind !== "video" || result.data.storageMode !== "binary") {
        await showCaptureNotification(
          "Could not capture video",
          "No downloadable video found. Reload the post and try again."
        )
        return { ok: false, error: "No downloadable video found." }
      }
      await withStorageMutation(() =>
        captureDraftStorage.setValue({
          id: crypto.randomUUID(),
          items: [{ draft: result.data, captureId: crypto.randomUUID() }],
        })
      )
      return { ok: true, value: null }
    }
    if (message.type === "akasha:connect") {
      const folders = await connectAkasha()
      await cacheFolderOptions(folders)
      queueMicrotask(() => void processDedupeBackfill())
      return { ok: true, value: folders }
    }

    if (message.type === "akasha:list-folders") {
      return { ok: true, value: await getFolderOptions() }
    }

    if (message.type === "akasha:save") {
      const captureIds = await enqueueCaptures(message)
      return { ok: true, value: { captureIds } }
    }

    return { ok: false, error: "Akasha could not complete that action." }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Akasha could not complete that action.",
    }
  }
}

async function enqueueCaptures(message: Extract<ExtensionRequest, { type: "akasha:save" }>) {
  const captureIds = await withStorageMutation(async () => {
    const selection = toCaptureSelection(await captureDraftStorage.getValue())
    if (!selection || selection.id !== message.selectionId || !message.folderId)
      throw new Error("Open the media and try again.")
    const selected = selection.items.filter((item) =>
      message.sourceUrls.includes(item.draft.sourceUrl)
    )
    if (
      !selected.length ||
      selected.some((item) => item.draft.kind === "video" && item.draft.storageMode !== "binary")
    )
      throw new Error("Choose media to save.")
    const jobs = await captureOutboxStorage.getValue()
    const added: CaptureOutboxJob[] = []
    const retried = new Set<string>()
    for (const item of selected) {
      const existing = item.captureId
        ? jobs.find((job) => job.captureId === item.captureId)
        : undefined
      if (existing && existing.status !== "failed") continue
      if (selection.folderId && !existing) continue
      const job = existing
        ? {
            ...existing,
            attempt: 0,
            errorMessage: undefined,
            folderId: message.folderId,
            nextAttemptAt: Date.now(),
            status: "pending" as const,
            reported: false,
          }
        : {
            ...createCaptureOutboxJob(item.draft, message.folderId, { captureId: item.captureId }),
            batchId: selection.items.length > 1 ? selection.id : undefined,
            origin: selection.origin,
          }
      added.push(job)
      retried.add(job.captureId)
    }
    if (!added.length) {
      const accepted = selected.flatMap((item) =>
        item.captureId && jobs.some((job) => job.captureId === item.captureId)
          ? [item.captureId]
          : []
      )
      if (accepted.length) return accepted
      throw new Error("These items are no longer waiting for retry.")
    }
    const batchIds = new Set(added.map((job) => job.batchId).filter(Boolean))
    await captureOutboxStorage.setValue([
      ...jobs
        .filter((job) => !retried.has(job.captureId))
        .map((job) => (batchIds.has(job.batchId) ? { ...job, reported: false } : job)),
      ...added,
    ])
    await captureDraftStorage.removeValue().catch(() => undefined)
    await Promise.all(
      [...new Set(added.map((job) => job.batchId ?? job.captureId))].map((id) =>
        browser.notifications.clear(`${FAILED_NOTIFICATION_PREFIX}${id}`).catch(() => undefined)
      )
    )
    return added.map((job) => job.captureId)
  })
  await scheduleNextOutboxAlarm()
  queueMicrotask(() => void processOutbox())
  return captureIds
}

function processOutbox() {
  if (outboxExecution) return outboxExecution

  outboxExecution = drainOutbox().finally(() => {
    outboxExecution = null
  })
  return outboxExecution
}

async function drainOutbox() {
  let job = await takeNextReadyJob()

  while (job) {
    await scheduleNextOutboxAlarm()

    try {
      const result = await saveCapture(job.draft, job.folderId, job.captureId, job.attempt)
      if (job.batchId) {
        await replaceOutboxJob({ ...job, status: result.outcome })
      } else {
        await removeOutboxJob(job.captureId)
        const notification = createCaptureResultNotification(result.outcome, job.draft.title)
        await showCaptureNotification(notification.title, notification.message).catch(
          () => undefined
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Akasha could not save this item."
      const retryable = !(error instanceof AkashaApiError) || error.retryable

      if (error instanceof AkashaApiError && (error.status === 401 || error.status === 422)) {
        await folderOptionsCacheStorage.removeValue()
      }
      const updatedJob = retryable
        ? scheduleDeliveryRetry(job, message)
        : { ...job, errorMessage: message, status: "failed" as const }

      await replaceOutboxJob(updatedJob)

      if (updatedJob.status === "failed" && !updatedJob.batchId) {
        await showFailedCaptureNotification(updatedJob).catch(() => undefined)
      }
    }

    job = await takeNextReadyJob()
  }

  try {
    await reportSettledBatches()
  } finally {
    await scheduleNextOutboxAlarm()
  }
}

async function reportSettledBatches() {
  const jobs = await captureOutboxStorage.getValue()
  const batchIds = new Set(jobs.flatMap((job) => (job.batchId ? [job.batchId] : [])))
  for (const batchId of batchIds) {
    const group = await withStorageMutation(async () => {
      const current = await captureOutboxStorage.getValue()
      const batch = current.filter((job) => job.batchId === batchId)
      if (
        !batch.length ||
        batch.some((job) => job.status === "pending") ||
        batch.every((job) => job.reported)
      )
        return []
      return batch
    })
    if (!group.length) continue
    const failed = group.filter((job) => job.status === "failed")
    const first = failed[0]
    if (first) {
      const reopened = await restoreFailedCapture(batchId, true).catch(() => false)
      if (!reopened) await showFailedCaptureNotification(first, failed.length)
    } else {
      const saved = group.filter((job) => job.status === "saved").length
      await showCaptureNotification(
        "Saved to Akasha",
        `${saved} saved · ${group.length - saved} already saved`
      )
    }
    // Keep terminal outcomes durable until recovery or notification completes.
    await withStorageMutation(async () => {
      const current = await captureOutboxStorage.getValue()
      if (current.some((job) => job.batchId === batchId && job.status === "pending")) return
      await captureOutboxStorage.setValue(
        current.flatMap((job) =>
          job.batchId !== batchId
            ? [job]
            : job.status === "failed"
              ? [{ ...job, reported: true }]
              : []
        )
      )
    })
  }
}

function processDedupeBackfill() {
  if (dedupeBackfillExecution) return dedupeBackfillExecution

  dedupeBackfillExecution = backfillNextDedupePage().finally(() => {
    dedupeBackfillExecution = null
  })
  return dedupeBackfillExecution
}

async function backfillNextDedupePage() {
  const state = await duplicateBackfillStorage.getValue()
  if (state.complete) {
    await browser.alarms.clear(DEDUPE_BACKFILL_ALARM_NAME)
    return
  }

  if (!(await hasAkashaCredential())) {
    await browser.alarms.clear(DEDUPE_BACKFILL_ALARM_NAME)
    return
  }

  try {
    const page = await backfillDuplicateMetadata(state.pageToken)

    if (page.restart) {
      await duplicateBackfillStorage.setValue({ complete: false, version: 1 })
      await browser.alarms.create(DEDUPE_BACKFILL_ALARM_NAME, {
        when: Date.now() + 60_000,
      })
      return
    }

    await duplicateBackfillStorage.setValue({
      complete: !page.nextPageToken,
      pageToken: page.nextPageToken,
      version: 1,
    })

    if (page.nextPageToken) {
      await browser.alarms.create(DEDUPE_BACKFILL_ALARM_NAME, {
        when: Date.now() + 60_000,
      })
    } else {
      await browser.alarms.clear(DEDUPE_BACKFILL_ALARM_NAME)
    }
  } catch {
    await browser.alarms.create(DEDUPE_BACKFILL_ALARM_NAME, {
      when: Date.now() + 5 * 60_000,
    })
  }
}

async function takeNextReadyJob() {
  return withStorageMutation(async () => {
    const jobs = await captureOutboxStorage.getValue()
    const jobIndex = jobs.findIndex(
      (job) => job.status === "pending" && job.nextAttemptAt <= Date.now()
    )

    if (jobIndex < 0) return null

    const job = jobs[jobIndex]
    if (!job) return null

    const preparedJob = prepareDeliveryAttempt(job)
    const nextJobs = [...jobs]
    nextJobs[jobIndex] = preparedJob
    await captureOutboxStorage.setValue(nextJobs)
    return preparedJob
  })
}

async function replaceOutboxJob(updatedJob: CaptureOutboxJob) {
  await withStorageMutation(async () => {
    const jobs = await captureOutboxStorage.getValue()
    await captureOutboxStorage.setValue(
      jobs.map((job) => (job.captureId === updatedJob.captureId ? updatedJob : job))
    )
  })
}

async function removeOutboxJob(captureId: string) {
  await withStorageMutation(async () => {
    const jobs = await captureOutboxStorage.getValue()
    await captureOutboxStorage.setValue(jobs.filter((job) => job.captureId !== captureId))
  })
}

async function scheduleNextOutboxAlarm() {
  const jobs = await captureOutboxStorage.getValue()
  const nextAttemptAt = jobs
    .filter((job) => job.status === "pending" || (job.batchId && !job.reported))
    .reduce<number | null>(
      (earliest, job) =>
        earliest === null
          ? job.status === "pending"
            ? job.nextAttemptAt
            : Date.now() + 60_000
          : Math.min(earliest, job.status === "pending" ? job.nextAttemptAt : Date.now() + 60_000),
      null
    )

  if (nextAttemptAt === null) {
    await browser.alarms.clear(OUTBOX_ALARM_NAME)
    return
  }

  await browser.alarms.create(OUTBOX_ALARM_NAME, {
    when: Math.max(Date.now() + 1_000, nextAttemptAt),
  })
}

async function restoreFailedCapture(captureId: string, automatic = false) {
  const jobs = await captureOutboxStorage.getValue()
  const failed = jobs.filter(
    (job) => (job.batchId === captureId || job.captureId === captureId) && job.status === "failed"
  )
  const first = failed[0]
  if (!first) return false
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (!activeTab?.id) return false
  const origin = first.origin
  if (automatic && (!origin || activeTab.id !== origin.tabId)) return false
  const selection = {
    id: crypto.randomUUID(),
    items: failed.map((job) => ({ draft: job.draft, captureId: job.captureId })),
    folderId: first.folderId,
    errorMessage: first.errorMessage,
    origin: first.origin,
  }
  // Opening recovery must never replace an unsaved capture.
  const restored = await withStorageMutation(async () => {
    if (await captureDraftStorage.getValue()) return false
    await captureDraftStorage.setValue(selection)
    return true
  })
  if (!restored) {
    if (!automatic) await openCapturePanel(activeTab.id)
    return false
  }
  if (automatic && origin) {
    const response = await browser.tabs
      .sendMessage(activeTab.id, {
        type: "akasha:open-capture",
        onlyIfPostUrl: origin.postUrl,
        pageUrl: origin.pageUrl,
      })
      .catch(() => null)
    if (response?.ok !== true) {
      await withStorageMutation(async () => {
        const current = toCaptureSelection(await captureDraftStorage.getValue())
        if (current?.id === selection.id) await captureDraftStorage.removeValue()
      })
    }
    return response?.ok === true
  }
  await openCapturePanel(activeTab.id)
  return true
}

async function getFolderOptions() {
  if (!(await hasAkashaCredential())) {
    await folderOptionsCacheStorage.removeValue()
    throw new Error("Connect Akasha to continue.")
  }

  const cached = await folderOptionsCacheStorage.getValue()

  if (cached) {
    if (Date.now() - cached.cachedAt >= FOLDER_CACHE_TTL_MS) {
      queueMicrotask(() => void refreshFolderOptions().catch(() => undefined))
    }
    return cached.folders
  }

  return refreshFolderOptions()
}

function refreshFolderOptions() {
  if (folderRefresh) return folderRefresh

  folderRefresh = listFolderOptions(AbortSignal.timeout(8_000))
    .then(async (folders) => {
      await cacheFolderOptions(folders)
      return folders
    })
    .finally(() => {
      folderRefresh = null
    })
  return folderRefresh
}

async function cacheFolderOptions(folders: Awaited<ReturnType<typeof listFolderOptions>>) {
  await folderOptionsCacheStorage.setValue({ cachedAt: Date.now(), folders })
}

function withStorageMutation<T>(operation: () => Promise<T>) {
  const result = storageMutation.then(operation, operation)
  storageMutation = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function showFailedCaptureNotification(job: CaptureOutboxJob, count = 1) {
  await browser.notifications.create(
    `${FAILED_NOTIFICATION_PREFIX}${job.batchId ?? job.captureId}`,
    {
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      message: `${count > 1 ? `${count} items need attention. ` : ""}${job.errorMessage ?? "Akasha could not save this item."} Click to try again.`,
      title: "Save needs attention",
      type: "basic",
    }
  )
}

async function showCaptureNotification(title: string, message: string) {
  await browser.notifications.create({
    iconUrl: browser.runtime.getURL("/icon/128.png"),
    message,
    title,
    type: "basic",
  })
}
