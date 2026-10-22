import type { CaptureDraft } from "@akasha/contracts"
import { Checkbox } from "@heroui/react"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  FolderIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { FolderOption } from "@/utils/akasha-api"
import { type CaptureSelection, toCaptureSelection } from "@/utils/capture"
import { connectLibrary, getFolderOptions, saveLibraryCapture } from "@/utils/messages"
import { captureDraftStorage, selectedFolderStorage } from "@/utils/storage"

type SaveStatus = "idle" | "saving"

export default function App({ onClose }: { onClose: () => void }) {
  const [selection, setSelection] = useState<CaptureSelection | null>(null)
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const comboboxRef = useRef<HTMLDivElement>(null)

  const applyFolders = useCallback(
    (availableFolders: FolderOption[], storedFolderId: string | null) => {
      const storedFolderExists = availableFolders.some((folder) => folder.id === storedFolderId)
      const nextFolderId =
        storedFolderExists && storedFolderId ? storedFolderId : (availableFolders[0]?.id ?? "")

      setFolders(availableFolders)
      setSelectedFolderId(nextFolderId)
    },
    []
  )

  useEffect(() => {
    async function initialize() {
      const [storedDraft, storedFolderId] = await Promise.all([
        captureDraftStorage.getValue(),
        selectedFolderStorage.getValue(),
      ])
      const next = toCaptureSelection(storedDraft)
      setSelection(next)
      setErrorMessage(next?.errorMessage ?? null)
      setSelectedSources(new Set(next?.items.map((item) => item.draft.sourceUrl)))

      try {
        const availableFolders = await getFolderOptions()
        applyFolders(availableFolders, next?.folderId ?? storedFolderId)
        setIsConnected(true)
      } catch {
        setIsConnected(false)
      } finally {
        setIsLoading(false)
      }
    }

    void initialize()
    return captureDraftStorage.watch((nextDraft) => {
      const next = toCaptureSelection(nextDraft)
      setSelection(next)
      setErrorMessage(next?.errorMessage ?? null)
      setSelectedSources(new Set(next?.items.map((item) => item.draft.sourceUrl)))
      if (next?.folderId) setSelectedFolderId(next.folderId)
      setSaveStatus("idle")
    })
  }, [applyFolders])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (folderPickerOpen) {
        event.preventDefault()
        setFolderPickerOpen(false)
        comboboxRef.current?.querySelector("input")?.focus()
        return
      }
      onClose()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [folderPickerOpen, onClose])

  useEffect(() => {
    if (!folderPickerOpen) return
    function onPointerDown(event: PointerEvent) {
      if (comboboxRef.current?.contains(event.target as Node)) return
      setFolderPickerOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [folderPickerOpen])

  async function handleConnect() {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const availableFolders = await connectLibrary()
      applyFolders(
        availableFolders,
        selection?.folderId ?? (await selectedFolderStorage.getValue())
      )
      setIsConnected(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Akasha could not connect.")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSave() {
    if (!selection || !selectedFolderId || !selectedSources.size) return

    setSaveStatus("saving")
    setErrorMessage(null)

    try {
      await saveLibraryCapture(selection.id, [...selectedSources], selectedFolderId)
      onClose()
    } catch (error) {
      setSaveStatus("idle")
      setErrorMessage(error instanceof Error ? error.message : "Akasha could not save this item.")
    }
  }

  async function handleFolderChange(folderId: string) {
    setSelectedFolderId(folderId)
    setFolderPickerOpen(false)
    await selectedFolderStorage.setValue(folderId)
  }

  return (
    <div className="akasha-backdrop">
      <button
        aria-label="Close Akasha Capture"
        className="backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <main aria-label="Akasha Capture" aria-modal="true" className="akasha-panel" role="dialog">
        <header className="akasha-header">
          <div className="akasha-brand">
            <span aria-hidden="true" className="akasha-mark" />
            <strong>Akasha</strong>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">
            <XIcon aria-hidden="true" />
          </button>
        </header>

        <div className="akasha-body">
          {isLoading ? (
            <div className="status-line" role="status">
              <ArrowClockwiseIcon aria-hidden="true" className="spin" />
              Loading library
            </div>
          ) : !isConnected ? (
            <section className="connection-state">
              <div>
                <h1>Connect Akasha</h1>
                <p>Save images to your library.</p>
              </div>
              <button className="primary-button" onClick={handleConnect} type="button">
                Connect Akasha
              </button>
            </section>
          ) : selection?.items.length ? (
            <>
              {selection.items.length > 1 ||
              selection.items.some((item) => item.captureId && selection.folderId) ? (
                <section aria-label="Images to save" className="capture-selection dark">
                  {selection.items.map(({ draft }, index) => (
                    <Checkbox
                      key={draft.sourceUrl}
                      aria-label={`Select image ${index + 1}`}
                      isSelected={selectedSources.has(draft.sourceUrl)}
                      isDisabled={saveStatus === "saving"}
                      onChange={(checked) =>
                        setSelectedSources((current) => {
                          const next = new Set(current)
                          if (checked) next.add(draft.sourceUrl)
                          else next.delete(draft.sourceUrl)
                          return next
                        })
                      }
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <img
                          alt=""
                          src={draft.thumbnailUrl ?? draft.sourceUrl}
                          width={48}
                          height={48}
                        />
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                </section>
              ) : selection.items[0] ? (
                <CapturePreview draft={selection.items[0].draft} />
              ) : null}
              <FolderCombobox
                comboboxRef={comboboxRef}
                folders={folders}
                isOpen={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                onSelect={(folderId) => void handleFolderChange(folderId)}
                selectedFolderId={selectedFolderId}
              />
              <button
                className="primary-button"
                disabled={!selectedFolderId || !selectedSources.size || saveStatus === "saving"}
                onClick={handleSave}
                type="button"
              >
                {saveStatus === "saving" ? (
                  <ArrowClockwiseIcon aria-hidden="true" className="spin" />
                ) : null}
                {saveStatus === "saving"
                  ? "Queueing"
                  : selection.folderId
                    ? "Retry failed"
                    : selection.items.length > 1
                      ? `Save ${selectedSources.size} image${selectedSources.size === 1 ? "" : "s"}`
                      : "Save"}
              </button>
            </>
          ) : (
            <section className="empty-state">
              <ImageIcon aria-hidden="true" />
              <p>Right-click an image to save it.</p>
            </section>
          )}

          {errorMessage ? (
            <p className="error-message" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function FolderCombobox({
  comboboxRef,
  folders,
  isOpen,
  onOpenChange,
  onSelect,
  selectedFolderId,
}: {
  comboboxRef: React.RefObject<HTMLDivElement | null>
  folders: FolderOption[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (folderId: string) => void
  selectedFolderId: string
}) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const labelId = useId()

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalizedQuery) return folders
    return folders.filter((folder) => folder.label.toLowerCase().includes(normalizedQuery))
  }, [folders, normalizedQuery])

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(() => {
        const selectedIndex = filtered.findIndex((folder) => folder.id === selectedFolderId)
        return selectedIndex >= 0 ? selectedIndex : 0
      })
    }
  }, [isOpen, filtered, selectedFolderId])

  useEffect(() => {
    if (!isOpen) setQuery("")
  }, [isOpen])

  const displayValue = isOpen ? query : (selectedFolder?.label ?? "")
  const activeId = filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined

  function selectFolder(folderId: string) {
    onSelect(folderId)
    inputRef.current?.focus()
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!isOpen) {
        onOpenChange(true)
        return
      }
      setActiveIndex((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (isOpen) {
        setActiveIndex((index) =>
          filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length
        )
      }
    } else if (event.key === "Enter") {
      const target = filtered[activeIndex]
      if (isOpen && target) {
        event.preventDefault()
        selectFolder(target.id)
      }
    }
  }

  return (
    <div className="folder-field">
      <label htmlFor={`${listId}-input`} id={labelId}>
        Folder
      </label>
      <div className="folder-combobox" ref={comboboxRef}>
        <div className="folder-input-wrap">
          <FolderIcon aria-hidden="true" className="folder-leading-icon" />
          <input
            aria-activedescendant={isOpen ? activeId : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={isOpen}
            autoComplete="off"
            id={`${listId}-input`}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
              if (!isOpen) onOpenChange(true)
            }}
            onFocus={() => onOpenChange(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Search folders…"
            ref={inputRef}
            role="combobox"
            type="text"
            value={displayValue}
          />
          {isOpen && query ? (
            <button
              aria-label="Clear folder search"
              className="folder-clear"
              onClick={() => {
                setQuery("")
                setActiveIndex(0)
                inputRef.current?.focus()
              }}
              type="button"
            >
              <XIcon aria-hidden="true" />
            </button>
          ) : (
            <MagnifyingGlassIcon aria-hidden="true" className="folder-trailing-icon" />
          )}
          <button
            aria-label={
              isOpen ? "Close folder list" : `Open folder list, ${filtered.length} folders`
            }
            className="folder-toggle"
            onClick={() => onOpenChange(!isOpen)}
            tabIndex={-1}
            type="button"
          >
            <CaretDownIcon aria-hidden="true" className={isOpen ? "caret-open" : undefined} />
          </button>
        </div>
        {isOpen ? (
          <div className="folder-options">
            {filtered.length === 0 ? (
              <p className="folder-empty">No folders match “{query.trim()}”</p>
            ) : (
              <div aria-labelledby={labelId} id={listId} role="listbox" tabIndex={-1}>
                {filtered.map((folder, index) => {
                  const isSelected = folder.id === selectedFolderId
                  const isActive = index === activeIndex
                  return (
                    <button
                      aria-selected={isSelected}
                      className={isActive ? "folder-option-active" : undefined}
                      id={`${listId}-${folder.id}`}
                      key={folder.id}
                      role="option"
                      onClick={() => selectFolder(folder.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      style={{ paddingInlineStart: `${12 + folder.depth * 18}px` }}
                      tabIndex={-1}
                      type="button"
                    >
                      <FolderMatch label={folder.label} query={normalizedQuery} />
                      {isSelected ? <CheckIcon aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
      <p aria-live="polite" className="folder-count" role="status">
        {isOpen && normalizedQuery
          ? `${filtered.length} of ${folders.length} folders`
          : `${folders.length} folders`}
      </p>
    </div>
  )
}

function FolderMatch({ label, query }: { label: string; query: string }) {
  if (!query) return <span>{label}</span>
  const matchIndex = label.toLowerCase().indexOf(query)
  if (matchIndex < 0) return <span>{label}</span>
  return (
    <span>
      {label.slice(0, matchIndex)}
      <mark>{label.slice(matchIndex, matchIndex + query.length)}</mark>
      {label.slice(matchIndex + query.length)}
    </span>
  )
}

function CapturePreview({ draft }: { draft: CaptureDraft }) {
  const sourceLabel = new URL(draft.pageUrl).hostname.replace(/^www\./, "")

  return (
    <section aria-label="Current capture" className="capture-preview">
      <div className="preview-media">
        {draft.thumbnailUrl ? (
          <img alt="" src={draft.thumbnailUrl} />
        ) : (
          <ImageIcon aria-hidden="true" />
        )}
      </div>
      <div className="preview-copy">
        <h1>{draft.title}</h1>
        <p>{sourceLabel}</p>
      </div>
    </section>
  )
}
