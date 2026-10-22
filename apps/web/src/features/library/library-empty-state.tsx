import { useState } from "react"
import { FolderSimplePlusIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@heroui/react"
import { EmptyState } from "@heroui-pro/react"

import { NewFolderDialog } from "./library-action-dialogs"

type LibraryEmptyStateProps = {
  onCreateFolder: (name: string) => Promise<void>
  onUpload: () => void
}

export function LibraryEmptyState({
  onCreateFolder,
  onUpload,
}: LibraryEmptyStateProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="grid min-h-[28rem] place-items-center">
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Media variant="icon">
            <FolderSimplePlusIcon aria-hidden="true" />
          </EmptyState.Media>
          <EmptyState.Title>Start your library</EmptyState.Title>
        </EmptyState.Header>
        <EmptyState.Content>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="primary" onPress={onUpload}>
              <UploadSimpleIcon aria-hidden="true" />
              Upload media
            </Button>
            <NewFolderDialog
              onCreate={onCreateFolder}
              onOpenChange={setIsOpen}
              open={isOpen}
              parentName="Akasha"
              triggerLabel="Create folder"
            />
          </div>
        </EmptyState.Content>
      </EmptyState>
    </div>
  )
}
