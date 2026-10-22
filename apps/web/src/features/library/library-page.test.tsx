// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LibraryPage } from "./library-page"

const actionMocks = vi.hoisted(() => ({
  createLibraryFolder: vi.fn(),
  moveLibraryFolder: vi.fn(),
  moveLibraryItems: vi.fn(),
  removeLibraryFolder: vi.fn(),
  removeLibraryItems: vi.fn(),
  renameLibraryFolder: vi.fn(),
}))

vi.mock("./library.functions", () => actionMocks)

vi.mock("@tanstack/react-router", async () => {
  const { forwardRef } = await import("react")

  return {
    Link: forwardRef<
      HTMLAnchorElement,
      React.ComponentProps<"a"> & { search?: unknown; to?: string }
    >(function TestLink({ search: _search, to = "/", ...props }, ref) {
      return <a {...props} href={to} ref={ref} />
    }),
    useNavigate: () => vi.fn(),
  }
})

const TestResizeObserver = globalThis.ResizeObserver

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver)
  vi.stubGlobal("CSS", { escape: (value: string) => value })
  for (const action of Object.values(actionMocks)) action.mockReset()
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("LibraryPage", () => {
  it("collects across folders, restores the pool, and dismisses without deleting assets", () => {
    const snapshot = {
      folders: [
        { id: "source", name: "Source", parentId: null },
        { id: "target", name: "Target", parentId: null },
      ],
      items: [
        createLibraryItem("one", "First asset", "source"),
        createLibraryItem("two", "Second asset", "target"),
      ],
      rootFolderId: "root",
    }
    sessionStorage.setItem(
      "akasha:temporary-pool:root",
      JSON.stringify(["one", "one"])
    )
    const page = render(
      <LibraryPage initialSnapshot={snapshot} requestedFolderId="source" />
    )
    expect(sessionStorage.getItem("akasha:temporary-pool:root")).toBeNull()
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one"])
    page.rerender(
      <LibraryPage initialSnapshot={snapshot} requestedFolderId="target" />
    )
    expect(
      within(
        screen.getByRole("complementary", { name: "Temporary pool" })
      ).getByRole("button", { name: "Open First asset" })
    ).toBeTruthy()
    fireEvent.keyDown(window, { key: "m" })
    fireEvent.click(screen.getByRole("button", { name: "Select Second asset" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Add selected assets to pool" })
    )
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one", "two"])
    fireEvent.click(screen.getByRole("button", { name: "Collapse pool" }))
    expect(screen.queryByRole("complementary")).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Temporary pool" })
    )
    page.unmount()
    render(<LibraryPage initialSnapshot={snapshot} />)
    const pool = within(
      screen.getByRole("complementary", { name: "Temporary pool" })
    )
    fireEvent.click(pool.getByRole("button", { name: "Open First asset" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(
      pool.getByRole("button", { name: "Remove from pool: First asset" })
    )
    expect(pool.queryByRole("button", { name: "Open First asset" })).toBeNull()
    fireEvent.click(pool.getByRole("button", { name: "Dismiss pool" }))
    expect(localStorage.getItem("akasha:temporary-pool:root")).toBe("null")
    expect(
      screen.getByRole("button", { name: "Open First asset" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Open Second asset" })
    ).toBeTruthy()
    cleanup()
    sessionStorage.setItem(
      "akasha:temporary-pool:root",
      JSON.stringify(["one"])
    )
    render(<LibraryPage initialSnapshot={snapshot} />)
    expect(screen.queryByRole("complementary")).toBeNull()
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "akasha:temporary-pool:root",
        newValue: JSON.stringify(["two"]),
        storageArea: localStorage,
      })
    )
    expect(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Open Second asset",
      })
    ).toBeTruthy()
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "akasha:temporary-pool:root",
        newValue: "null",
        storageArea: localStorage,
      })
    )
    expect(screen.queryByRole("complementary")).toBeNull()
    for (const action of Object.values(actionMocks))
      expect(action).not.toHaveBeenCalled()
  })

  it("recovers from invalid or blocked pool storage and isolates libraries", () => {
    localStorage.setItem("akasha:temporary-pool:root", '{"invalid":true}')
    const snapshot = {
      folders: [],
      items: [createLibraryItem("one", "First asset")],
      rootFolderId: "root",
    }
    let page = render(<LibraryPage initialSnapshot={snapshot} />)
    expect(screen.queryByRole("complementary")).toBeNull()
    page.unmount()
    sessionStorage.setItem(
      "akasha:temporary-pool:root",
      JSON.stringify(["one"])
    )
    const originalGet = Storage.prototype.getItem
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(function (this: Storage, key) {
        if (this === localStorage) throw new Error("Storage blocked")
        return originalGet.call(this, key)
      })
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage blocked")
      })
    page = render(<LibraryPage initialSnapshot={snapshot} />)
    expect(sessionStorage.getItem("akasha:temporary-pool:root")).toBe('["one"]')
    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Remove from pool: First asset",
      })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Add to pool: First asset" })
    )
    expect(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Open First asset",
      })
    ).toBeTruthy()
    setItem.mockRestore()
    getItem.mockRestore()
    page.rerender(
      <LibraryPage
        initialSnapshot={{ ...snapshot, rootFolderId: "other-root" }}
      />
    )
    expect(screen.queryByRole("complementary")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Temporary pool" }))
    expect(
      within(screen.getByRole("complementary")).queryByRole("button", {
        name: "Open First asset",
      })
    ).toBeNull()
  })

  it("adds the active preview to the pool with P or its action without closing", () => {
    const snapshot = {
      folders: [],
      rootFolderId: "root",
      items: [
        createLibraryItem("one", "First asset"),
        { ...createLibraryItem("two", "Second asset"), kind: "video" as const },
      ],
    }
    render(<LibraryPage initialSnapshot={snapshot} />)
    fireEvent.click(screen.getByRole("button", { name: "Open First asset" }))
    fireEvent.keyDown(window, { key: "p" })
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one"])
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "First asset"
    )
    expect(
      screen
        .getByRole("button", { name: "Added to pool" })
        .hasAttribute("disabled")
    ).toBe(true)
    fireEvent.keyDown(window, { key: "p" })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: "Add to pool" }))
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one", "two"])
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "Second asset"
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Open First asset",
      })
    )
    fireEvent.keyDown(window, { key: "p" })
    expect(screen.getByRole("button", { name: "Added to pool" })).toBeTruthy()
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one", "two"])
  })

  it("ignores pool shortcuts outside preview, while typing, or beneath another dialog", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          rootFolderId: "root",
          items: [createLibraryItem("one", "First asset")],
        }}
      />
    )
    fireEvent.keyDown(window, { key: "p" })
    expect(localStorage.getItem("akasha:temporary-pool:root")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Open First asset" }))
    const dialog = screen.getByRole("dialog")
    const input = document.createElement("input")
    dialog.append(input)
    fireEvent.keyDown(input, { key: "p" })
    input.remove()
    for (const modifier of [
      "ctrlKey",
      "altKey",
      "metaKey",
      "shiftKey",
      "repeat",
      "isComposing",
    ]) {
      fireEvent.keyDown(window, { key: "p", [modifier]: true })
    }
    const other = document.createElement("div")
    other.setAttribute("role", "dialog")
    document.body.append(other)
    fireEvent.keyDown(window, { key: "p" })
    other.remove()
    expect(localStorage.getItem("akasha:temporary-pool:root")).toBeNull()
    fireEvent.keyDown(window, { key: "p" })
    expect(
      JSON.parse(localStorage.getItem("akasha:temporary-pool:root")!)
    ).toEqual(["one"])
  })

  it("shows an empty library with a first-folder action", () => {
    render(
      <LibraryPage
        initialSnapshot={{ folders: [], items: [], rootFolderId: "root" }}
      />
    )

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Akasha")
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")
    ).toBe("true")
    expect(screen.getByRole("radio", { name: "Folders" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Keyboard shortcuts" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Open account menu" })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Create folder" })).toBeTruthy()
    expect(
      screen.getAllByRole("button", { name: "Upload images" })
    ).toHaveLength(2)
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("adds a created folder without reloading the Drive library", async () => {
    const onRefresh = vi.fn()
    actionMocks.createLibraryFolder.mockResolvedValueOnce({
      id: "design",
      name: "Design",
    })
    render(
      <LibraryPage
        initialSnapshot={{ folders: [], items: [], rootFolderId: "root" }}
        onRefresh={onRefresh}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Create folder" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Folder name" }),
      { target: { value: "Design" } }
    )
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create folder" })
    )

    await screen.findByText("No media here yet.")
    fireEvent.click(screen.getByRole("radio", { name: "Folders" }))

    expect(await screen.findByText("Design")).toBeTruthy()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it("opens the image picker with the U shortcut", () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined)

    render(
      <LibraryPage
        initialSnapshot={{ folders: [], items: [], rootFolderId: "root" }}
      />
    )

    fireEvent.keyDown(window, { key: "u" })
    expect(click).toHaveBeenCalledOnce()
  })

  it("shows the current upload destination while files are dragged", () => {
    render(
      <LibraryPage
        initialSnapshot={{ folders: [], items: [], rootFolderId: "root" }}
      />
    )

    const uploadZone = document.querySelector("[data-library-upload-zone]")
    expect(uploadZone).toBeTruthy()
    fireEvent.dragEnter(uploadZone!, { dataTransfer: { types: ["Files"] } })
    expect(screen.getByText("Drop into Akasha")).toBeTruthy()
    fireEvent.dragLeave(uploadZone!, { dataTransfer: { types: ["Files"] } })
    expect(screen.queryByText("Drop into Akasha")).toBeNull()
  })

  it("enters selection mode from the toolbar or M shortcut", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          items: [createLibraryItem("one", "First asset")],
          rootFolderId: "root",
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Select multiple assets" })
    )
    expect(
      screen
        .getByRole("button", { name: "Exit selection mode" })
        .getAttribute("aria-pressed")
    ).toBe("true")

    fireEvent.keyDown(window, { key: "Escape" })
    expect(
      screen.getByRole("button", { name: "Select multiple assets" })
    ).toBeTruthy()

    fireEvent.keyDown(window, { key: "m" })
    expect(
      screen.getByRole("checkbox", { name: "Select First asset" })
    ).toBeTruthy()
  })

  it("opens bulk move and delete actions for selected assets", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [
            { id: "source", name: "Source", parentId: null },
            { id: "target", name: "Target", parentId: null },
          ],
          items: [
            createLibraryItem("one", "First asset", "source"),
            createLibraryItem("two", "Second asset", "source"),
          ],
          rootFolderId: "root",
        }}
      />
    )

    fireEvent.keyDown(window, { key: "m" })
    fireEvent.click(screen.getByRole("button", { name: "Select First asset" }))
    fireEvent.click(screen.getByRole("button", { name: "Select Second asset" }))

    expect(screen.getByText("2 selected")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected assets" })
    )
    expect(screen.getByRole("heading", { name: "Move 2 assets" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected assets" })
    )
    expect(
      screen.getByRole("heading", { name: "Delete 2 assets?" })
    ).toBeTruthy()
  })

  it("shows the connected Google profile in the account trigger", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          items: [],
          rootFolderId: "root",
          user: {
            displayName: "Ada Lovelace",
            emailAddress: "ada@example.com",
            photoLink: "https://example.com/ada.jpg",
          },
        }}
      />
    )

    const accountButton = screen.getByRole("button", {
      name: "Open account menu",
    })
    expect(accountButton.textContent).toContain("AL")
  })

  it("switches between All and Folders with the S shortcut", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          items: [],
          rootFolderId: "root",
        }}
      />
    )

    fireEvent.keyDown(window, { key: "s" })
    expect(
      screen
        .getByRole("radio", { name: "Folders" })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(screen.getByText("No folders here yet.")).toBeTruthy()

    fireEvent.keyDown(window, { key: "S" })
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")
    ).toBe("true")
  })

  it("returns to the parent folder from both library views with ArrowDown", () => {
    const onFolderNavigate = vi.fn()

    render(
      <LibraryPage
        initialSnapshot={{
          folders: [
            { id: "parent", name: "Parent", parentId: null },
            { id: "current", name: "Current", parentId: "parent" },
          ],
          items: [],
          rootFolderId: "root",
        }}
        onFolderNavigate={onFolderNavigate}
        requestedFolderId="current"
      />
    )

    fireEvent.keyDown(window, { key: "ArrowDown" })
    expect(onFolderNavigate).toHaveBeenCalledWith("parent")

    fireEvent.keyDown(window, { key: "s" })
    expect(screen.getByText("No folders here yet.")).toBeTruthy()
    fireEvent.keyDown(window, { key: "ArrowDown" })

    expect(onFolderNavigate).toHaveBeenNthCalledWith(2, "parent")
  })

  it("opens the focused media folder with ArrowUp from the All view", () => {
    const onFolderNavigate = vi.fn()

    render(
      <LibraryPage
        initialSnapshot={{
          folders: [{ id: "references", name: "References", parentId: null }],
          items: [
            {
              capturedAt: "2026-08-15T10:00:00.000Z",
              driveFileId: "drive-item",
              folderId: "references",
              id: "item",
              kind: "image",
              storageMode: "binary",
              sourceLabel: "example.com",
              sourceUrl: "https://example.com/source",
              thumbnailUrl: "/api/media/drive-item",
              title: "Connected reference",
            },
          ],
          rootFolderId: "root",
        }}
        onFolderNavigate={onFolderNavigate}
      />
    )

    const media = screen.getByRole("button", {
      name: "Open Connected reference",
    })
    media.focus()
    fireEvent.keyDown(media, { key: "ArrowUp" })

    expect(onFolderNavigate).toHaveBeenCalledWith("references")
  })

  it("renders connected images as media cards", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [{ id: "references", name: "References", parentId: null }],
          items: [
            {
              capturedAt: "2026-08-15T10:00:00.000Z",
              driveFileId: "drive-item",
              folderId: "references",
              id: "item",
              kind: "image",
              storageMode: "binary",
              sourceLabel: "example.com",
              sourceUrl: "https://example.com/source",
              thumbnailUrl: "/api/media/drive-item",
              title: "Connected reference",
            },
          ],
          rootFolderId: "root",
        }}
      />
    )

    expect(
      screen.getByRole("button", { name: "Open Connected reference" })
    ).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Connected reference" })
    ).toBeTruthy()
    expect(screen.queryByText("Connected reference")).toBeNull()
  })

  it("filters the library from the icon-only menu", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          items: [
            {
              capturedAt: "2026-08-15T10:00:00.000Z",
              driveFileId: "image-file",
              folderId: "root",
              id: "image",
              kind: "image",
              sourceLabel: "example.com",
              sourceUrl: "https://example.com/image",
              storageMode: "binary",
              thumbnailUrl: "/api/media/image-file",
              title: "Image reference",
            },
            {
              capturedAt: "2026-08-15T10:00:00.000Z",
              driveFileId: "video-file",
              folderId: "root",
              id: "video",
              kind: "video",
              sourceLabel: "example.com",
              sourceUrl: "https://example.com/video.mp4",
              storageMode: "binary",
              thumbnailUrl: "/api/media/poster-file",
              title: "Video reference",
            },
          ],
          rootFolderId: "root",
        }}
      />
    )

    expect(
      screen.queryByRole("searchbox", { name: "Search library" })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Filter and sort" }))
    fireEvent.click(screen.getByText("Videos"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(
      screen.getByRole("button", { name: "Open Video reference" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Open Image reference" })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Open Video reference" })
    )
    const video = document.querySelector("video")
    expect(video?.getAttribute("preload")).toBe("metadata")
    expect(video?.getAttribute("src")).toBe("/api/media/video-file")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    fireEvent.click(screen.getByRole("button", { name: "Filter and sort" }))
    fireEvent.click(screen.getByText("Images"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(
      screen.getByRole("button", { name: "Open Image reference" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Open Video reference" })
    ).toBeNull()

    fireEvent.keyDown(window, { key: "f" })
    expect(
      screen.getByRole("button", { name: "Open Video reference" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Open Image reference" })
    ).toBeNull()

    fireEvent.keyDown(window, { key: "F" })
    expect(
      screen.getByRole("button", { name: "Open Image reference" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Open Video reference" })
    ).toBeTruthy()
  })

  it("sorts the library from the icon-only menu", () => {
    render(
      <LibraryPage
        initialSnapshot={{
          folders: [],
          items: [
            createLibraryItem(
              "older",
              "Alpha older",
              "root",
              "2026-08-20T10:00:00.000Z"
            ),
            createLibraryItem(
              "newer",
              "Zulu newest",
              "root",
              "2026-08-30T10:00:00.000Z"
            ),
          ],
          rootFolderId: "root",
        }}
      />
    )

    const gallery = within(screen.getByLabelText("Saved media"))
    expect(
      gallery.getAllByRole("button").map((button) => button.ariaLabel)
    ).toEqual(["Open Zulu newest", "Open Alpha older"])

    fireEvent.click(screen.getByRole("button", { name: "Filter and sort" }))
    fireEvent.click(screen.getByText("Title"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    expect(
      gallery.getAllByRole("button").map((button) => button.ariaLabel)
    ).toEqual(["Open Alpha older", "Open Zulu newest"])
  })
})

function createLibraryItem(
  id: string,
  title: string,
  folderId = "root",
  capturedAt = "2026-08-23T10:00:00.000Z"
) {
  return {
    capturedAt,
    driveFileId: id,
    folderId,
    id,
    kind: "image" as const,
    sourceLabel: "example.com",
    sourceUrl: `https://example.com/${id}`,
    storageMode: "binary" as const,
    thumbnailUrl: `/api/media/${id}`,
    title,
  }
}
