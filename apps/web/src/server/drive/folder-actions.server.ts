import { getFolderDescendantIds } from "@akasha/contracts"
import type { LibraryFolder } from "@akasha/contracts"
import type { GoogleTokenCredentials } from "../auth/google-oauth.server"

import {
  createDriveClient,
  listStillroomFolders,
  moveFile,
  trashFile,
} from "./drive.server"
import { buildReachableFolders } from "./extension-library.server"

type FolderActionContext = {
  folder: LibraryFolder
  folders: LibraryFolder[]
  rootFolderId: string
}

export async function renameDriveFolder(
  credentials: GoogleTokenCredentials,
  folderId: string,
  name: string
) {
  await loadFolderActionContext(credentials, folderId)
  const drive = createDriveClient(credentials)
  const response = await drive.files.update({
    fields: "id,name,mimeType,parents,appProperties,createdTime",
    fileId: folderId,
    requestBody: { name },
  })

  return response.data
}

export async function moveDriveFolder(
  credentials: GoogleTokenCredentials,
  folderId: string,
  destinationFolderId: string
) {
  const context = await loadFolderActionContext(credentials, folderId)
  assertFolderMoveDestination(context, destinationFolderId)
  return moveFile(credentials, folderId, destinationFolderId)
}

export async function trashDriveFolder(
  credentials: GoogleTokenCredentials,
  folderId: string
) {
  await loadFolderActionContext(credentials, folderId)
  return trashFile(credentials, folderId)
}

async function loadFolderActionContext(
  credentials: GoogleTokenCredentials,
  folderId: string
): Promise<FolderActionContext> {
  const { folders: driveFolders, root } =
    await listStillroomFolders(credentials)
  if (!root.id) throw new Error("Akasha could not identify the library root.")

  const folders = buildReachableFolders(root.id, driveFolders)
  const folder = folders.find((candidate) => candidate.id === folderId)
  if (!folder) throw new Error("Choose a folder inside Akasha.")

  return { folder, folders, rootFolderId: root.id }
}

function assertFolderMoveDestination(
  context: FolderActionContext,
  destinationFolderId: string
) {
  const destinationExists =
    destinationFolderId === context.rootFolderId ||
    context.folders.some((folder) => folder.id === destinationFolderId)

  if (!destinationExists) throw new Error("Choose a folder inside Akasha.")

  const descendants = getFolderDescendantIds(context.folders, context.folder.id)
  if (
    destinationFolderId === context.folder.id ||
    descendants.has(destinationFolderId)
  ) {
    throw new Error("A folder cannot be moved inside itself.")
  }
}
