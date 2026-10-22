import { FunnelSimpleIcon } from "@phosphor-icons/react"
import { Button, Dropdown, Label, Separator } from "@heroui/react"

import type { LibrarySortOrder } from "./library-items"

type MediaFilter = "all" | "image" | "video"

type LibraryFilterMenuProps = {
  mediaFilter: MediaFilter
  onMediaFilterChange: (filter: MediaFilter) => void
  onSortOrderChange: (sortOrder: LibrarySortOrder) => void
  sortOrder: LibrarySortOrder
}

export function LibraryFilterMenu({
  mediaFilter,
  onMediaFilterChange,
  onSortOrderChange,
  sortOrder,
}: LibraryFilterMenuProps) {
  const selectedKeys = new Set([`media:${mediaFilter}`, `sort:${sortOrder}`])

  function applySelection(key: React.Key) {
    const selection = String(key)
    if (selection.startsWith("media:")) {
      onMediaFilterChange(selection.slice("media:".length) as MediaFilter)
    }
    if (selection.startsWith("sort:")) {
      onSortOrderChange(selection.slice("sort:".length) as LibrarySortOrder)
    }
  }

  return (
    <Dropdown>
      <Button
        isIconOnly
        aria-label="Filter and sort"
        size="sm"
        variant="outline"
      >
        <FunnelSimpleIcon aria-hidden="true" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          selectedKeys={selectedKeys}
          selectionMode="multiple"
          onAction={applySelection}
        >
          <Dropdown.Item id="media:all" textValue="All media">
            <Label>All media</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="media:image" textValue="Images">
            <Label>Images</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="media:video" textValue="Videos">
            <Label>Videos</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Separator />
          <Dropdown.Item id="sort:newest" textValue="Newest first">
            <Label>Newest first</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="sort:oldest" textValue="Oldest first">
            <Label>Oldest first</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="sort:title" textValue="Title">
            <Label>Title</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
