import { afterEach, expect, it, vi } from "vitest"
import type { CaptureSelection } from "./capture"
import * as capture from "./capture"
import * as result from "./capture-result"
import type { CaptureOutboxJob } from "./outbox"
import * as outbox from "./outbox"

async function setup(fail: boolean) {
  vi.resetModules()
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const event = (name: string) => ({
    addListener: (fn: (...args: unknown[]) => unknown) => listeners.set(name, fn),
  })
  const item = <T>(initial: T) => {
    let value = initial
    return {
      getValue: async () => value,
      setValue: async (next: T) => {
        value = next
      },
      removeValue: async () => {
        value = null as T
      },
    }
  }
  const draft = item<CaptureSelection | null>(null)
  const jobs = item<CaptureOutboxJob[]>([])
  const save = vi.fn(async (_draft: unknown, _folder: string, id: string) => {
    if (fail && id === "image-2") throw new Error("Unavailable")
    return { outcome: id === "image-3" ? "already_saved" : "saved" }
  })
  const notify = vi.fn(async () => "notification")
  const clearNotification = vi.fn(async () => true)
  const send = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal("defineBackground", (fn: () => void) => fn())
  vi.stubGlobal("browser", {
    contextMenus: { onClicked: event("context"), update: vi.fn() },
    action: { onClicked: event("action") },
    alarms: { onAlarm: event("alarm"), clear: vi.fn(), create: vi.fn() },
    runtime: {
      onStartup: event("startup"),
      onMessage: event("message"),
      getURL: (path: string) => path,
    },
    notifications: { onClicked: event("notification"), create: notify, clear: clearNotification },
    tabs: { query: async () => [{ id: 10 }], sendMessage: send },
  })
  vi.doMock("@/utils/capture", () => capture)
  vi.doMock("@/utils/outbox", () => outbox)
  vi.doMock("@/utils/capture-result", () => result)
  vi.doMock("@/utils/akasha-api", () => ({
    saveCapture: save,
    hasAkashaCredential: async () => false,
    AkashaApiError: class extends Error {},
  }))
  vi.doMock("@/utils/storage", () => ({
    captureDraftStorage: draft,
    captureOutboxStorage: jobs,
    duplicateBackfillStorage: item({ complete: true }),
    folderOptionsCacheStorage: item(null),
  }))
  await import("../entrypoints/background")
  await vi.waitFor(() => expect(listeners.has("message")).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const selection: CaptureSelection = {
    id: "batch",
    origin: { tabId: 10, pageUrl: "https://x.com/home", postUrl: "https://x.com/user/status/123" },
    items: [1, 2, 3, 4].map((n) => ({
      captureId: `image-${n}`,
      draft: {
        kind: "image",
        pageUrl: "https://x.com/user/status/123",
        sourceUrl: `https://pbs.twimg.com/media/${n}?format=jpg&name=orig`,
        title: "Images",
      },
    })),
  }
  await draft.setValue(selection)
  const submit = (current: CaptureSelection, indices = [0, 1, 2, 3]) =>
    listeners.get("message")?.({
      type: "akasha:save",
      selectionId: current.id,
      sourceUrls: indices.flatMap((i) => current.items[i]?.draft.sourceUrl ?? []),
      folderId: "destination",
    })
  return { draft, jobs, save, notify, clearNotification, send, submit, selection, listeners }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock("@/utils/storage")
})

it("queues selected X images separately and reports saved and duplicate results once", async () => {
  const state = await setup(false)
  expect(await state.submit(state.selection, [0, 2, 3])).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(3))
  await vi.waitFor(() =>
    expect(state.notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: "2 saved · 1 already saved" })
    )
  )
  expect(state.save.mock.calls.map((call) => call[2])).toEqual(["image-1", "image-3", "image-4"])
  expect(await state.jobs.getValue()).toEqual([])
  expect(await state.draft.getValue()).toBeNull()
})

it("waits for exhausted retries, retains only failures and retries with the original identity", async () => {
  const state = await setup(true)
  await state.submit(state.selection)
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(4))
  expect(state.notify).not.toHaveBeenCalled()
  for (let attempt = 2; attempt <= 4; attempt++) {
    await state.jobs.setValue(
      (await state.jobs.getValue()).map((job) => ({ ...job, nextAttemptAt: 0 }))
    )
    state.listeners.get("alarm")?.({ name: "akasha-capture-outbox" })
    await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(3 + attempt))
  }
  await vi.waitFor(() =>
    expect(state.send).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        onlyIfPostUrl: state.selection.origin?.postUrl,
        pageUrl: "https://x.com/home",
      })
    )
  )
  expect(await state.jobs.getValue()).toMatchObject([
    { captureId: "image-2", status: "failed", attempt: 4 },
  ])
  expect(state.notify).not.toHaveBeenCalled()
  await vi.waitFor(async () => expect((await state.jobs.getValue())[0]?.reported).toBe(true))
  // Replay terminal work left durable by an interrupted worker, after leaving the post.
  await state.draft.setValue(null)
  await state.jobs.setValue(
    (await state.jobs.getValue()).map((job) => ({ ...job, reported: false }))
  )
  state.send.mockResolvedValueOnce({ ok: false })
  state.listeners.get("startup")?.()
  await vi.waitFor(() =>
    expect(state.notify).toHaveBeenCalledWith("akasha-save-failed:batch", expect.any(Object))
  )
  expect(await state.draft.getValue()).toBeNull()
  state.listeners.get("notification")?.("akasha-save-failed:batch")
  await vi.waitFor(async () => expect(await state.draft.getValue()).not.toBeNull())
  const recovery = await state.draft.getValue()
  expect(recovery?.items.map((entry) => entry.captureId)).toEqual(["image-2"])
  const unsaved = { ...state.selection, id: "unsaved" }
  await state.draft.setValue(unsaved)
  await state.listeners.get("action")?.()
  expect(await state.draft.getValue()).toEqual(unsaved)
  await state.draft.setValue(recovery)
  state.clearNotification.mockClear()
  state.save.mockImplementation(async () => ({ outcome: "saved" }))
  if (!recovery) throw new Error("Missing recovery")
  await state.submit(recovery, [0])
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(8))
  await vi.waitFor(async () => expect(await state.jobs.getValue()).toEqual([]))
  expect(state.save.mock.calls.at(-1)?.[2]).toBe("image-2")
  expect(state.clearNotification).toHaveBeenCalledWith("akasha-save-failed:batch")
})
