import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "@heroui/react"

import { useLocalStorage } from "@/hooks/use-local-storage"

function parsePool(value: unknown): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
    throw new Error("Invalid pool membership")
  }
  return [...new Set(value)]
}

export function useTemporaryPool(rootFolderId: string) {
  const storageWarningShown = useRef(false)
  const storageKey = `akasha:temporary-pool:${rootFolderId}`
  const onStorageError = useCallback(() => {
    if (storageWarningShown.current) return
    storageWarningShown.current = true
    toast.warning("Pool could not be saved in this browser", {
      description: "Keep this tab open to retain your selections.",
    })
  }, [])
  const [ids, setIds] = useLocalStorage<string[] | null>(storageKey, null, {
    parse: parsePool,
    migrateFromSession: true,
    onError: onStorageError,
  })
  const [visibility, setVisibility] = useState({ key: "", isOpen: true })
  const isOpen =
    ids !== null && (visibility.key !== storageKey || visibility.isOpen)

  const open = useCallback(() => {
    setVisibility({ key: storageKey, isOpen: true })
  }, [storageKey])
  const toggleItem = useCallback(
    (id: string) => {
      setIds((current) =>
        current?.includes(id)
          ? current.filter((itemId) => itemId !== id)
          : [...(current ?? []), id]
      )
      open()
    },
    [setIds, open]
  )
  const addItems = useCallback(
    (itemIds: string[]) => {
      setIds((current) => [...new Set([...(current ?? []), ...itemIds])])
      open()
    },
    [setIds, open]
  )
  const itemIds = useMemo(() => new Set(ids ?? []), [ids])

  return {
    itemIds,
    isActive: ids !== null,
    isOpen,
    toggleItem,
    addItems,
    toggleOpen() {
      setIds((current) => current ?? [])
      setVisibility({ key: storageKey, isOpen: !isOpen })
    },
    close() {
      setVisibility({ key: storageKey, isOpen: false })
    },
    dismiss() {
      setIds(null)
      setVisibility({ key: storageKey, isOpen: false })
    },
  }
}
