import { useEffect, useState } from "react"
import {
  AlertDialog,
  Button,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  Typography,
} from "@heroui/react"
import type { LibraryFolder } from "@akasha/contracts"

type RenameFolderDialogProps = {
  folder: LibraryFolder | null
  onOpenChange: (open: boolean) => void
  onRename: (name: string) => Promise<void>
}

export function RenameFolderDialog({
  folder,
  onOpenChange,
  onRename,
}: RenameFolderDialogProps) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    setName(folder?.name ?? "")
    setError(undefined)
  }, [folder])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!folder || name.trim().length === 0) {
      setError("Enter a folder name.")
      return
    }

    setError(undefined)
    setIsPending(true)
    try {
      await onRename(name)
      onOpenChange(false)
    } catch (caughtError) {
      setError(getActionError(caughtError))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Modal.Backdrop isOpen={folder !== null} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <form className="grid gap-4" onSubmit={submit}>
            <Modal.Header>
              <Modal.Heading>Rename folder</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField fullWidth isInvalid={Boolean(error)}>
                <Label>Folder name</Label>
                <Input
                  autoFocus
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError>{error}</FieldError>
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex justify-end gap-3">
                <Button slot="close" type="button" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={isPending} type="submit">
                  {isPending ? "Renaming…" : "Rename"}
                </Button>
              </div>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

type MoveFolderDialogProps = {
  destinations: LibraryFolder[]
  folder: LibraryFolder | null
  onMove: (folderId: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

export function MoveFolderDialog({
  destinations,
  folder,
  onMove,
  onOpenChange,
}: MoveFolderDialogProps) {
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    setDestinationId(null)
    setError(undefined)
  }, [folder])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!folder || !destinationId) {
      setError("Choose a destination folder.")
      return
    }

    setError(undefined)
    setIsPending(true)
    try {
      await onMove(destinationId)
      onOpenChange(false)
    } catch (caughtError) {
      setError(getActionError(caughtError))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Modal.Backdrop isOpen={folder !== null} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <form className="grid gap-4" onSubmit={submit}>
            <Modal.Header>
              <Modal.Heading>Move {folder?.name ?? "folder"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-4">
                <Select
                  fullWidth
                  placeholder="Choose a folder"
                  selectedKey={destinationId}
                  onSelectionChange={(key) => setDestinationId(String(key))}
                >
                  <Label>Destination</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {destinations.map((destination) => (
                        <ListBox.Item
                          id={destination.id}
                          key={destination.id}
                          textValue={destination.name}
                        >
                          {destination.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {error ? (
                  <Typography color="muted" role="alert" type="body-sm">
                    {error}
                  </Typography>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex justify-end gap-3">
                <Button slot="close" type="button" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={isPending} type="submit">
                  {isPending ? "Moving…" : "Move folder"}
                </Button>
              </div>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

type RemoveFolderDialogProps = {
  assetCount: number
  folder: LibraryFolder | null
  nestedFolderCount: number
  onOpenChange: (open: boolean) => void
  onRemove: () => Promise<void>
}

export function RemoveFolderDialog({
  assetCount,
  folder,
  nestedFolderCount,
  onOpenChange,
  onRemove,
}: RemoveFolderDialogProps) {
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)

  useEffect(() => setError(undefined), [folder])

  async function remove() {
    if (!folder) return

    setError(undefined)
    setIsPending(true)
    try {
      await onRemove()
      onOpenChange(false)
    } catch (caughtError) {
      setError(getActionError(caughtError))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <AlertDialog.Backdrop isOpen={folder !== null} onOpenChange={onOpenChange}>
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>
              Delete {folder?.name ?? "folder"}?
            </AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <Typography color="muted">
              This moves the folder, {nestedFolderCount} nested folders, and{" "}
              {assetCount} assets to trash.
            </Typography>
            {error ? (
              <Typography color="muted" role="alert" type="body-sm">
                {error}
              </Typography>
            ) : null}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <div className="flex justify-end gap-3">
              <Button slot="close" variant="tertiary">
                Cancel
              </Button>
              <Button isPending={isPending} variant="danger" onPress={remove}>
                {isPending ? "Deleting…" : "Delete folder"}
              </Button>
            </div>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function getActionError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to complete the action. Try again."
}
