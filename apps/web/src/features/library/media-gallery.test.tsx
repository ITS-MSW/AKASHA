// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LibraryItem } from "@akasha/contracts"

import { MediaGallery } from "./media-gallery"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function createItem(
  kind: LibraryItem["kind"],
  overrides: Partial<LibraryItem> = {}
): LibraryItem {
  return {
    capturedAt: "2026-08-23T10:00:00.000Z",
    driveFileId: `${kind}-file`,
    folderId: "references",
    id: kind,
    kind,
    mimeType: kind === "image" ? "image/jpeg" : "video/mp4",
    sourceLabel: "example.com",
    sourceUrl: `https://example.com/${kind}`,
    storageMode: "binary",
    thumbnailUrl: `/api/media/${kind}-preview?preview=signed-token`,
    title: `${kind} reference`,
    ...overrides,
  }
}

type GalleryOptions = {
  isSelectionMode?: boolean
  onSelectionChange?: (itemId: string, isSelected: boolean) => void
  selectedItemIds?: ReadonlySet<string>
}

function renderGallery(
  items: LibraryItem[],
  {
    isSelectionMode = false,
    onSelectionChange = vi.fn(),
    selectedItemIds = new Set<string>(),
  }: GalleryOptions = {}
) {
  render(
    <MediaGallery
      isSelectionMode={isSelectionMode}
      items={items}
      onMoveItem={vi.fn()}
      onOpenFolder={vi.fn()}
      onRemoveItem={vi.fn()}
      onSelectionChange={onSelectionChange}
      selectedItemIds={selectedItemIds}
    />
  )
}

describe("MediaGallery selection", () => {
  it("selects a card instead of opening its preview in selection mode", () => {
    const onSelectionChange = vi.fn()
    renderGallery([createItem("image")], {
      isSelectionMode: true,
      onSelectionChange,
    })

    fireEvent.click(
      screen.getByRole("button", { name: "Select image reference" })
    )

    expect(onSelectionChange).toHaveBeenCalledWith("image", true)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(
      screen.getByRole("checkbox", { name: "Select image reference" })
    ).toBeTruthy()
  })

  it("exposes selected cards as pressed and checked", () => {
    renderGallery([createItem("image")], {
      isSelectionMode: true,
      selectedItemIds: new Set(["image"]),
    })

    expect(
      screen
        .getByRole("button", { name: "Deselect image reference" })
        .getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("checkbox", {
        name: "Deselect image reference",
      })
    ).toHaveProperty("checked", true)
  })
})

describe("MediaGallery context menu", () => {
  it("downloads the full image with its title and file extension", async () => {
    let downloadLink: HTMLAnchorElement | undefined
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureDownload(this: HTMLAnchorElement) {
        downloadLink = this
      }
    )
    renderGallery([createItem("image")])

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Open image reference" })
    )
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download" }))

    expect(downloadLink?.getAttribute("href")).toBe("/api/media/image-file")
    expect(downloadLink?.download).toBe("image reference.jpg")
  })

  it("does not offer downloads for videos", async () => {
    renderGallery([createItem("video")])

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Open video reference" })
    )

    expect(await screen.findByRole("menuitem", { name: "Move to folder" }))
    expect(screen.queryByRole("menuitem", { name: "Download" })).toBeNull()
  })
})

describe("MediaGallery image loading", () => {
  it("prefetches sustained hover at low priority and keyboard focus immediately", () => {
    vi.useFakeTimers()
    const image = document.createElement("img")
    const createImage = vi
      .spyOn(window, "Image")
      .mockImplementation(function () {
        return image
      })
    renderGallery([createItem("image")])
    const card = screen.getByRole("button", { name: "Open image reference" })

    fireEvent.pointerEnter(card, { pointerType: "mouse" })
    expect(createImage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)

    expect(createImage).toHaveBeenCalledTimes(1)
    expect(image.getAttribute("src")).toBe("/api/media/image-file")
    expect(image.fetchPriority).toBe("low")

    fireEvent.pointerLeave(card)
    fireEvent.focus(card)
    expect(createImage).toHaveBeenCalledTimes(2)
  })

  it("cancels original prefetch when hover ends or the gallery unmounts", () => {
    vi.useFakeTimers()
    const createImage = vi.spyOn(window, "Image")
    renderGallery([createItem("image")])
    const card = screen.getByRole("button", { name: "Open image reference" })

    fireEvent.pointerEnter(card, { pointerType: "mouse" })
    fireEvent.pointerLeave(card)
    vi.advanceTimersByTime(150)
    expect(createImage).not.toHaveBeenCalled()

    fireEvent.pointerEnter(card, { pointerType: "mouse" })
    cleanup()
    vi.advanceTimersByTime(150)
    expect(createImage).not.toHaveBeenCalled()
  })

  it("fills each masonry column through the context-menu trigger", () => {
    renderGallery([createItem("image")])

    expect(
      screen
        .getByRole("button", { name: "Open image reference" })
        .closest('[data-slot="context-menu-trigger"]')?.className
    ).toContain("w-full")
  })

  it("keeps intrinsic image geometry and limits high-priority previews", () => {
    renderGallery([
      createItem("image", {
        height: 800,
        id: "first",
        title: "First",
        width: 600,
      }),
      createItem("image", { id: "second", title: "Second" }),
      createItem("image", { id: "third", title: "Third" }),
    ])

    const images = screen.getAllByRole("img")
    expect(images).toHaveLength(3)
    expect(images[0]?.getAttribute("fetchpriority")).toBe("high")
    expect(images[0]?.getAttribute("loading")).toBe("eager")
    expect(images[1]?.getAttribute("fetchpriority")).toBe("high")
    expect(images[2]?.getAttribute("fetchpriority")).toBe("auto")
    expect(images[2]?.getAttribute("loading")).toBe("lazy")
    expect(
      images.every((image) => image.getAttribute("decoding") === "async")
    ).toBe(true)
    expect(images[0]?.getAttribute("width")).toBe("600")
    expect(images[0]?.getAttribute("height")).toBe("800")
  })

  it("loads the original only after opening an image", () => {
    renderGallery([createItem("image")])

    expect(screen.getByRole("img").getAttribute("src")).toContain(
      "image-preview?preview="
    )
    expect(
      document.querySelector('img[src="/api/media/image-file"]')
    ).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Open image reference" })
    )

    const dialog = screen.getByRole("dialog")
    const original = within(dialog).getByRole("img", {
      name: "image reference",
    })
    expect(original.getAttribute("src")).toBe("/api/media/image-file")
    expect(
      dialog.querySelector(
        'img[src="/api/media/image-preview?preview=signed-token"]'
      )
    ).toBeTruthy()
  })

  it("sizes the lightbox preview from the original image geometry", () => {
    renderGallery([
      createItem("image", {
        height: 1200,
        width: 1600,
      }),
    ])

    fireEvent.click(
      screen.getByRole("button", { name: "Open image reference" })
    )

    const dialog = screen.getByRole("dialog")
    const preview = dialog.querySelector(
      'img[src="/api/media/image-preview?preview=signed-token"]'
    )
    expect(preview?.getAttribute("width")).toBe("1600")
    expect(preview?.getAttribute("height")).toBe("1200")
  })

  it("keeps a clean fallback when a preview fails", () => {
    renderGallery([createItem("image")])

    fireEvent.error(screen.getByRole("img"))

    expect(screen.queryByRole("img")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Open image reference" })
    ).toBeTruthy()
  })

  it("does not hide the original while it loads", () => {
    renderGallery([
      createItem("image", { id: "first", title: "First" }),
      createItem("image", {
        driveFileId: "second-file",
        id: "second",
        title: "Second",
      }),
    ])

    fireEvent.click(screen.getByRole("button", { name: "Open First" }))
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByRole("img", { name: "First" }).className
    ).not.toContain("opacity-0")

    fireEvent.keyDown(window, { key: "ArrowRight" })
    const secondOriginal = within(dialog).getByRole("img", { name: "Second" })

    expect(secondOriginal.className).not.toContain("opacity-0")
  })

  it("keeps pointer-centered inspection across navigation without pointer re-entry", () => {
    renderGallery([
      createItem("image", { id: "first", title: "First" }),
      createItem("image", { id: "second", title: "Second" }),
      createItem("video"),
      createItem("image", { id: "third", title: "Third" }),
    ])
    fireEvent.click(screen.getByRole("button", { name: "Open First" }))
    const dialog = screen.getByRole("dialog")
    let content = within(dialog).getByRole("img", {
      name: "First",
    }).parentElement!
    let frame = content.parentElement!
    const bounds = {
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(bounds)

    fireEvent.pointerEnter(frame, { clientX: 150, clientY: 25 })
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true })
    expect(content.style.transform).toBe("scale(2)")
    expect(content.style.getPropertyValue("--zoom-origin")).toBe("75% 25%")
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true })
    expect(within(dialog).getByRole("img", { name: "Second" })).toBeTruthy()
    expect(content.style.transform).toBe("scale(2)")
    fireEvent.pointerMove(frame, { clientX: 50, clientY: 75, shiftKey: true })
    expect(content.style.getPropertyValue("--zoom-origin")).toBe("25% 75%")

    fireEvent.keyUp(window, { key: "Shift" })
    expect(content.style.transform).toBe("scale(1)")
    measure.mockReturnValue({
      ...bounds,
      right: 100,
      bottom: 200,
      width: 100,
      height: 200,
    })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(dialog.querySelector("video")).toBeTruthy()
    fireEvent.keyDown(window, { key: "Alt", altKey: true })
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true })
    content = within(dialog).getByRole("img", { name: "Third" }).parentElement!
    frame = content.parentElement!
    expect(within(dialog).getByRole("img", { name: "Third" })).toBeTruthy()
    expect(content.style.getPropertyValue("--zoom-origin")).toBe("50% 37.5%")
    expect(content.style.transform).toBe("scale(2)")
    fireEvent.blur(window)
    expect(content.style.transform).toBe("scale(1)")
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    content = within(dialog).getByRole("img", { name: "Second" }).parentElement!
    frame = content.parentElement!
    fireEvent.pointerMove(frame, { clientX: 25, clientY: 100, altKey: true })
    expect(content.style.getPropertyValue("--zoom-origin")).toBe("25% 50%")
    fireEvent.pointerLeave(frame)
    expect(content.style.transform).toBe("scale(1)")
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true })
    expect(
      within(dialog).getByRole("img", { name: "First" }).parentElement!.style
        .transform
    ).toBe("scale(1)")
  })

  it("renders every item before lazy image loading begins", () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      createItem("image", { id: `image-${index}`, title: `Image ${index}` })
    )

    renderGallery(items)

    expect(
      screen.getAllByRole("button", { name: /^Open Image / })
    ).toHaveLength(50)
  })
})
