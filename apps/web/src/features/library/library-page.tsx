import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FolderSimplePlusIcon, XIcon, StackIcon } from "@phosphor-icons/react"
import { Button, Card, Chip, Label, Typography } from "@heroui/react"
import { ContextMenu } from "@heroui-pro/react"
import { getFolderDescendantIds, getFolderPath } from "@akasha/contracts"
import type { LibraryFolder } from "@akasha/contracts"

import type { DriveLibrarySnapshot } from "@/server/drive/library.server"
import { useTheme } from "@/features/theme/use-theme"
import { FolderGallery } from "./folder-tree"
import {
  MoveFolderDialog,
  RemoveFolderDialog,
  RenameFolderDialog,
} from "./folder-action-dialogs"
import {
  MoveItemsDialog,
  NewFolderDialog,
  RemoveItemsDialog,
} from "./library-action-dialogs"
import { LibraryBulkActions } from "./library-bulk-actions"
import { LibraryCommandPalette } from "./library-command-palette"
import { LibraryEmptyState } from "./library-empty-state"
import {
  getFolderMoveDestinations,
  getFolderRemovalSummary,
} from "./library-folder-actions"
import { filterLibraryItems } from "./library-items"
import type { LibrarySortOrder } from "./library-items"
import { LibraryToolbar } from "./library-toolbar"
import { LibraryDropTarget, LibraryUploader } from "./library-upload"
import type { LibraryUploaderHandle } from "./library-upload"
import { MediaGallery } from "./media-gallery"
import { useTemporaryPool } from "./use-temporary-pool"
import { useLibraryKeyboardShortcuts } from "./use-library-keyboard-shortcuts"
import {
  createLibraryFolder,
  moveLibraryFolder,
  moveLibraryItems,
  removeLibraryFolder,
  removeLibraryItems,
  renameLibraryFolder,
} from "./library.functions"

type LibraryPageProps = {
  initialSnapshot: DriveLibrarySnapshot
  onFolderNavigate?: (folderId?: string) => void
  onRefresh?: () => Promise<void>
  requestedFolderId?: string
}

export function LibraryPage({
  initialSnapshot,
  onFolderNavigate,
  onRefresh = async () => {},
  requestedFolderId,
}: LibraryPageProps) {
  const [activeTab, setActiveTab] = useState<"all" | "folders">("all")
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "video">(
    "all"
  )
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>("newest")
  const [commandOpen, setCommandOpen] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [folderToMove, setFolderToMove] = useState<LibraryFolder | null>(null)
  const [folderToRemove, setFolderToRemove] = useState<LibraryFolder | null>(
    null
  )
  const [folderToRename, setFolderToRename] = useState<LibraryFolder | null>(
    null
  )
  const [moveItemIds, setMoveItemIds] = useState<string[]>([])
  const [removeItemIds, setRemoveItemIds] = useState<string[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const { theme, setTheme, toggleTheme } = useTheme()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const uploaderRef = useRef<LibraryUploaderHandle>(null)
  const { folders, items, rootFolderId } = snapshot
  const pool = useTemporaryPool(rootFolderId)
  const poolItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]))
    return Array.from(pool.itemIds).flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
  }, [items, pool.itemIds])
  const selectedFolderId = getSelectedFolderId(
    folders,
    rootFolderId,
    requestedFolderId
  )
  const { folderPath, parentFolderId, selectedFolderName } = useMemo(
    () => getSelectedFolderDetails(folders, selectedFolderId),
    [folders, selectedFolderId]
  )
  const filteredItems = useMemo(
    () =>
      filterLibraryItems(items, {
        mediaFilter,
        rootFolderId,
        selectedFolderId,
        sortOrder,
      }),
    [items, mediaFilter, rootFolderId, selectedFolderId, sortOrder]
  )
  const visibleFolders = useMemo(
    () =>
      folders.filter((folder) =>
        selectedFolderId === rootFolderId
          ? folder.parentId === null
          : folder.parentId === selectedFolderId
      ),
    [folders, rootFolderId, selectedFolderId]
  )
  const isLibraryEmpty = folders.length === 0 && items.length === 0
  const moveDestinations = useMemo(() => {
    const movingItems = items.filter((item) => moveItemIds.includes(item.id))
    const destinations: LibraryFolder[] = [
      { id: rootFolderId, name: "Akasha", parentId: null },
      ...folders,
    ]

    return destinations.filter(
      (folder) =>
        movingItems.length === 0 ||
        !movingItems.every((item) => item.folderId === folder.id)
    )
  }, [folders, items, moveItemIds, rootFolderId])
  const folderMoveDestinations = useMemo(
    () => getFolderMoveDestinations(folders, rootFolderId, folderToMove),
    [folderToMove, folders, rootFolderId]
  )
  const folderRemovalSummary = useMemo(
    () => getFolderRemovalSummary(folders, items, folderToRemove),
    [folderToRemove, folders, items]
  )

  useEffect(() => {
    setSnapshot(initialSnapshot)
  }, [initialSnapshot])

  useEffect(() => {
    setSelectedItemIds(new Set())
    setIsSelectionMode(false)
  }, [activeTab, mediaFilter, selectedFolderId])

  useLibraryKeyboardShortcuts({
    activeView: activeTab,
    canGoToParent:
      selectedFolderId !== rootFolderId && Boolean(onFolderNavigate),
    hasItems: filteredItems.length > 0,
    isSelectionMode,
    onCommandPaletteToggle: () => setCommandOpen((open) => !open),
    onExitSelection: exitSelectionMode,
    onGoToParent: () => onFolderNavigate?.(parentFolderId ?? undefined),
    onMediaFilterCycle: () =>
      setMediaFilter((current) => cycleMediaFilter(current)),
    onSelectionModeToggle: () => changeSelectionMode(!isSelectionMode),
    onThemeToggle: toggleTheme,
    onUpload: () => uploaderRef.current?.openFilePicker(),
    onViewToggle: () =>
      setActiveTab((current) => (current === "all" ? "folders" : "all")),
  })

  async function createFolder(name: string) {
    const folder = await createLibraryFolder({
      data: { name, parentFolderId: selectedFolderId },
    })
    const folderId = folder.id
    if (!folderId) return onRefresh()

    setSnapshot((current) => ({
      ...current,
      folders: [
        ...current.folders,
        {
          id: folderId,
          name: name.trim(),
          parentId: selectedFolderId === rootFolderId ? null : selectedFolderId,
        },
      ],
    }))
  }

  async function renameFolder(name: string) {
    if (!folderToRename) return
    await renameLibraryFolder({
      data: { folderId: folderToRename.id, name },
    })
    setSnapshot((current) => ({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === folderToRename.id
          ? { ...folder, name: name.trim() }
          : folder
      ),
    }))
  }

  async function moveFolder(destinationFolderId: string) {
    if (!folderToMove) return
    await moveLibraryFolder({
      data: { destinationFolderId, folderId: folderToMove.id },
    })
    setSnapshot((current) => ({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === folderToMove.id
          ? {
              ...folder,
              parentId:
                destinationFolderId === rootFolderId
                  ? null
                  : destinationFolderId,
            }
          : folder
      ),
    }))
  }

  async function removeFolder() {
    if (!folderToRemove) return
    await removeLibraryFolder({ data: { folderId: folderToRemove.id } })
    setSnapshot((current) => {
      const removedFolderIds = getFolderDescendantIds(
        current.folders,
        folderToRemove.id
      )
      removedFolderIds.add(folderToRemove.id)

      return {
        ...current,
        folders: current.folders.filter(
          (folder) => !removedFolderIds.has(folder.id)
        ),
        items: current.items.filter(
          (item) => !removedFolderIds.has(item.folderId)
        ),
      }
    })
  }

  function changeSelectionMode(nextSelectionMode: boolean) {
    setIsSelectionMode(nextSelectionMode)
    if (!nextSelectionMode) setSelectedItemIds(new Set())
  }

  function exitSelectionMode() {
    setIsSelectionMode(false)
    setSelectedItemIds(new Set())
  }

  const changeItemSelection = useCallback(
    (itemId: string, isSelected: boolean) => {
      setSelectedItemIds((current) => {
        const next = new Set(current)
        if (isSelected) next.add(itemId)
        else next.delete(itemId)
        return next
      })
    },
    []
  )
  const openMoveItem = useCallback(
    (itemId: string) => setMoveItemIds([itemId]),
    []
  )
  const openRemoveItem = useCallback(
    (itemId: string) => setRemoveItemIds([itemId]),
    []
  )
  const openItemFolder = useCallback(
    (folderId: string) => {
      if (folderId !== selectedFolderId) onFolderNavigate?.(folderId)
    },
    [onFolderNavigate, selectedFolderId]
  )

  async function moveItems(destinationFolderId: string) {
    if (moveItemIds.length === 0) return
    await moveLibraryItems({
      data: { destinationFolderId, fileIds: moveItemIds },
    })
    const movedItemIds = new Set(moveItemIds)
    setSnapshot((current) => ({
      ...current,
      items: current.items.map((item) =>
        movedItemIds.has(item.id)
          ? { ...item, folderId: destinationFolderId }
          : item
      ),
    }))
    exitSelectionMode()
  }

  async function removeItems() {
    if (removeItemIds.length === 0) return
    await removeLibraryItems({ data: { fileIds: removeItemIds } })
    const removedItemIds = new Set(removeItemIds)
    setSnapshot((current) => ({
      ...current,
      items: current.items.filter((item) => !removedItemIds.has(item.id)),
    }))
    exitSelectionMode()
  }

  function renderLibraryContent() {
    if (activeTab === "folders") {
      return (
        <FolderGallery
          folders={visibleFolders}
          items={items}
          libraryFolders={folders}
          onMoveFolder={setFolderToMove}
          onRemoveFolder={setFolderToRemove}
          onRenameFolder={setFolderToRename}
        />
      )
    }

    if (isLibraryEmpty) {
      return (
        <LibraryEmptyState
          onCreateFolder={createFolder}
          onUpload={() => uploaderRef.current?.openFilePicker()}
        />
      )
    }

    return (
      <MediaGallery
        poolItemIds={pool.itemIds}
        onTogglePool={pool.toggleItem}
        showPoolControls={pool.isActive}
        isSelectionMode={isSelectionMode}
        items={filteredItems}
        onMoveItem={openMoveItem}
        onOpenFolder={openItemFolder}
        onRemoveItem={openRemoveItem}
        onSelectionChange={changeItemSelection}
        selectedItemIds={selectedItemIds}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LibraryToolbar
        poolOpen={pool.isOpen}
        poolCount={poolItems.length}
        onPoolToggle={pool.toggleOpen}
        activeView={activeTab}
        canSelect={filteredItems.length > 0}
        folderPath={folderPath}
        isSelectionMode={isSelectionMode}
        mediaFilter={mediaFilter}
        onMediaFilterChange={setMediaFilter}
        onSelectionModeChange={changeSelectionMode}
        onSortOrderChange={setSortOrder}
        onThemeChange={setTheme}
        onUpload={() => uploaderRef.current?.openFilePicker()}
        onViewChange={setActiveTab}
        sortOrder={sortOrder}
        theme={theme}
        user={snapshot.user}
      />
      <div
        className={
          pool.isOpen
            ? "grid items-start min-[64rem]:grid-cols-[minmax(0,1fr)_22rem]"
            : ""
        }
      >
        <div className="min-w-0">
          <LibraryDropTarget
            folderName={selectedFolderName}
            onFiles={(files) => uploaderRef.current?.addFiles(files)}
          >
            <ContextMenu>
              <ContextMenu.Trigger
                render={(props) => (
                  <div
                    {...props}
                    className="block min-h-[calc(100svh-4.5rem)] w-full"
                    data-library-context-trigger
                  />
                )}
              >
                <main
                  className="w-full px-[clamp(0.75rem,1.5vw,1.5rem)] pt-4 pb-12"
                  id="main-content"
                >
                  <div className="sr-only">
                    <Typography type="h1">{selectedFolderName}</Typography>
                  </div>
                  <div className="min-h-[calc(100svh-10rem)]">
                    {renderLibraryContent()}
                  </div>
                </main>
              </ContextMenu.Trigger>
              <ContextMenu.Popover>
                <ContextMenu.Menu
                  aria-label="Folder actions"
                  onAction={() => setCreateFolderOpen(true)}
                >
                  <ContextMenu.Item
                    id="create-folder"
                    textValue="Create folder"
                  >
                    <FolderSimplePlusIcon aria-hidden="true" />
                    <Label>Create folder</Label>
                  </ContextMenu.Item>
                </ContextMenu.Menu>
              </ContextMenu.Popover>
            </ContextMenu>
          </LibraryDropTarget>
        </div>
        {pool.isOpen ? (
          <aside
            aria-label="Temporary pool"
            id="temporary-pool"
            className="order-first min-w-0 px-3 pt-4 pb-4 min-[64rem]:sticky min-[64rem]:top-[4.5rem] min-[64rem]:order-last min-[64rem]:pl-0"
          >
            <Card>
              <Card.Header>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Card.Title>Temporary pool</Card.Title>
                    <Chip size="sm">{poolItems.length}</Chip>
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label="Collapse pool"
                    onPress={() => {
                      pool.close()
                      document.getElementById("temporary-pool-toggle")?.focus()
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </Card.Header>
              <Card.Content>
                <div className="max-h-[38svh] overflow-y-auto overscroll-contain p-1 min-[64rem]:max-h-[calc(100svh-16rem)]">
                  {poolItems.length > 0 ? (
                    <MediaGallery
                      poolMode
                      poolItemIds={pool.itemIds}
                      onTogglePool={pool.toggleItem}
                      isSelectionMode={false}
                      items={poolItems}
                      onMoveItem={openMoveItem}
                      onOpenFolder={openItemFolder}
                      onRemoveItem={openRemoveItem}
                      onSelectionChange={changeItemSelection}
                      selectedItemIds={pool.itemIds}
                    />
                  ) : (
                    <div className="grid min-h-36 place-content-center justify-items-center gap-3 text-muted">
                      <StackIcon aria-hidden="true" size={28} />
                      <Typography color="muted">
                        Add assets to your pool
                      </Typography>
                    </div>
                  )}
                </div>
              </Card.Content>
              <Card.Footer>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    pool.dismiss()
                    document.getElementById("temporary-pool-toggle")?.focus()
                  }}
                >
                  Dismiss pool
                </Button>
              </Card.Footer>
            </Card>
          </aside>
        ) : null}
      </div>
      <LibraryCommandPalette
        folders={folders}
        onOpenChange={setCommandOpen}
        onThemeChange={setTheme}
        open={commandOpen}
      />
      <LibraryBulkActions
        onAddToPool={() => {
          pool.addItems(Array.from(selectedItemIds))
          exitSelectionMode()
        }}
        onDelete={() => setRemoveItemIds(Array.from(selectedItemIds))}
        onExit={exitSelectionMode}
        onMove={() => setMoveItemIds(Array.from(selectedItemIds))}
        selectedCount={selectedItemIds.size}
      />
      <NewFolderDialog
        onCreate={createFolder}
        onOpenChange={setCreateFolderOpen}
        open={createFolderOpen}
        parentName={selectedFolderName}
      />
      <MoveItemsDialog
        folders={moveDestinations}
        itemCount={moveItemIds.length}
        onMove={moveItems}
        onOpenChange={(open) => {
          if (!open) setMoveItemIds([])
        }}
        open={moveItemIds.length > 0}
      />
      <RemoveItemsDialog
        itemCount={removeItemIds.length}
        onOpenChange={(open) => {
          if (!open) setRemoveItemIds([])
        }}
        onRemove={removeItems}
        open={removeItemIds.length > 0}
      />
      <RenameFolderDialog
        folder={folderToRename}
        onOpenChange={(open) => {
          if (!open) setFolderToRename(null)
        }}
        onRename={renameFolder}
      />
      <MoveFolderDialog
        destinations={folderMoveDestinations}
        folder={folderToMove}
        onMove={moveFolder}
        onOpenChange={(open) => {
          if (!open) setFolderToMove(null)
        }}
      />
      <RemoveFolderDialog
        assetCount={folderRemovalSummary.assetCount}
        folder={folderToRemove}
        nestedFolderCount={folderRemovalSummary.nestedFolderCount}
        onOpenChange={(open) => {
          if (!open) setFolderToRemove(null)
        }}
        onRemove={removeFolder}
      />
      <LibraryUploader
        folderId={selectedFolderId}
        folderName={selectedFolderName}
        onRefresh={onRefresh}
        ref={uploaderRef}
      />
    </div>
  )
}

function cycleMediaFilter(current: "all" | "image" | "video") {
  if (current === "all") return "image"
  if (current === "image") return "video"
  return "all"
}

function getSelectedFolderId(
  folders: DriveLibrarySnapshot["folders"],
  rootFolderId: string,
  requestedFolderId?: string
) {
  return requestedFolderId &&
    folders.some((folder) => folder.id === requestedFolderId)
    ? requestedFolderId
    : rootFolderId
}

function getSelectedFolderDetails(
  folders: LibraryFolder[],
  selectedFolderId: string
) {
  const folderPath = getFolderPath(folders, selectedFolderId)

  return {
    folderPath,
    parentFolderId: folders.find((folder) => folder.id === selectedFolderId)
      ?.parentId,
    selectedFolderName: folderPath.at(-1)?.name ?? "Akasha",
  }
}
