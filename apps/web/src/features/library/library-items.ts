import type { LibraryItem, MediaKind } from "@akasha/contracts"

export type LibrarySortOrder = "newest" | "oldest" | "title"

type FilterLibraryItemsOptions = {
  mediaFilter: "all" | MediaKind
  rootFolderId: string
  selectedFolderId: string
  sortOrder: LibrarySortOrder
}

const itemComparators: Record<
  LibrarySortOrder,
  (left: LibraryItem, right: LibraryItem) => number
> = {
  newest: compareNewest,
  oldest: compareOldest,
  title: compareTitles,
}

export function filterLibraryItems(
  items: LibraryItem[],
  options: FilterLibraryItemsOptions
) {
  return [...items]
    .filter((item) => isItemInScope(item, options))
    .filter((item) => matchesMediaFilter(item, options.mediaFilter))
    .sort(itemComparators[options.sortOrder])
}

function isItemInScope(item: LibraryItem, options: FilterLibraryItemsOptions) {
  if (options.selectedFolderId === options.rootFolderId) return true
  return item.folderId === options.selectedFolderId
}

function matchesMediaFilter(
  item: LibraryItem,
  mediaFilter: FilterLibraryItemsOptions["mediaFilter"]
) {
  return mediaFilter === "all" || item.kind === mediaFilter
}

function compareNewest(left: LibraryItem, right: LibraryItem) {
  const difference = Date.parse(right.capturedAt) - Date.parse(left.capturedAt)
  return difference === 0 ? compareTitles(left, right) : difference
}

function compareOldest(left: LibraryItem, right: LibraryItem) {
  const difference = Date.parse(left.capturedAt) - Date.parse(right.capturedAt)
  return difference === 0 ? compareTitles(left, right) : difference
}

function compareTitles(left: LibraryItem, right: LibraryItem) {
  return left.title.localeCompare(right.title, undefined, {
    sensitivity: "base",
  })
}
