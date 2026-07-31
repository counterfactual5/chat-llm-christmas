import {
  driveCopyFile,
  driveCreateComment,
  driveCreateFolder,
  driveCreateShortcut,
  driveCreateTextFile,
  driveDeleteComment,
  driveDeleteFile,
  driveExportFile,
  driveGetFile,
  driveListChildren,
  driveListComments,
  driveListPermissions,
  driveListSharedDrives,
  driveReadFileText,
  driveRevokePermission,
  driveSearchFiles,
  driveShareFile,
  driveTrashFile,
  driveUntrashFile,
  driveUpdateFile,
  driveUploadFile,
} from '@/lib/integrations/google/drive';
import { num, str, type GoogleToolDef } from '@/lib/mcp/google/shared';

export const driveToolDefs: GoogleToolDef[] = [
  {
    name: 'drive_search',
    description:
      'Search Google Drive files. query uses Drive search syntax (e.g. name contains "report", mimeType=...).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args, fallback) => {
      let query = str(args.query);
      if (!query && fallback) query = `fullText contains '${fallback.replace(/'/g, "\\'")}'`;
      return driveSearchFiles(token, {
        query: query || undefined,
        pageSize: num(args.pageSize, 10),
        pageToken: str(args.pageToken) || undefined,
      });
    },
  },
  {
    name: 'drive_list_children',
    description:
      'List files/folders directly inside a Drive folder. Defaults to My Drive root.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder id; omit for root' },
        parentId: { type: 'string', description: 'Alias of folderId' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args) =>
      driveListChildren(token, {
        folderId: str(args.folderId) || str(args.parentId) || undefined,
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'drive_get_file',
    description: 'Get Google Drive file metadata by fileId.',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveGetFile(token, fileId);
    },
  },
  {
    name: 'drive_read_file',
    description:
      'Read text content from a Drive file (exports Docs/Sheets when possible; otherwise downloads text).',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveReadFileText(token, fileId);
    },
  },
  {
    name: 'drive_create_text_file',
    description: 'Create a plain-text file in Google Drive.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        parentId: { type: 'string', description: 'Optional folder id' },
      },
      required: ['name', 'content'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      const content = str(args.content);
      if (!name || !content) throw new Error('name and content are required');
      return driveCreateTextFile(token, {
        name,
        content,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentId: { type: 'string', description: 'Optional parent folder id' },
      },
      required: ['name'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      if (!name) throw new Error('name is required');
      return driveCreateFolder(token, {
        name,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_copy_file',
    description: 'Copy a Drive file. Optionally rename and/or place in another folder.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveCopyFile(token, {
        fileId,
        name: str(args.name) || undefined,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_update_file',
    description:
      'Rename a Drive file and/or move it (addParents / removeParents). Use removeParents of the current parent and addParents of the destination to move.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        addParents: { type: 'array', items: { type: 'string' } },
        removeParents: { type: 'array', items: { type: 'string' } },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      const addParents = Array.isArray(args.addParents)
        ? args.addParents.map((x) => str(x)).filter(Boolean)
        : undefined;
      const removeParents = Array.isArray(args.removeParents)
        ? args.removeParents.map((x) => str(x)).filter(Boolean)
        : undefined;
      const name = str(args.name) || undefined;
      const description =
        args.description === undefined ? undefined : str(args.description);
      if (!name && description === undefined && !addParents?.length && !removeParents?.length) {
        throw new Error('Provide name, description, addParents, and/or removeParents');
      }
      return driveUpdateFile(token, {
        fileId,
        name,
        description,
        addParents,
        removeParents,
      });
    },
  },
  {
    name: 'drive_trash',
    description: 'Move a Drive file to trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveTrashFile(token, fileId);
    },
  },
  {
    name: 'drive_untrash',
    description: 'Restore a Drive file from trash.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveUntrashFile(token, fileId);
    },
  },
  {
    name: 'drive_delete',
    description: 'Permanently delete a Drive file (skips trash). Prefer drive_trash unless the user asked to permanently delete.',
    write: true,
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveDeleteFile(token, fileId);
    },
  },
  {
    name: 'drive_export',
    description:
      'Export a Google Docs/Sheets/Slides file to another MIME (default: Docs→text/plain, Sheets→text/csv).',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        mimeType: {
          type: 'string',
          description: 'Target MIME, e.g. text/plain, text/csv, application/pdf',
        },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveExportFile(token, {
        fileId,
        mimeType: str(args.mimeType) || undefined,
      });
    },
  },
  {
    name: 'drive_list_permissions',
    description: 'List sharing permissions for a Drive file.',
    parameters: {
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveListPermissions(token, fileId);
    },
  },
  {
    name: 'drive_share',
    description:
      'Share a Drive file. type=user|group|domain|anyone; role=reader|commenter|writer. For user/group provide emailAddress.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        role: {
          type: 'string',
          description: 'reader | commenter | writer | owner',
        },
        type: {
          type: 'string',
          description: 'user | group | domain | anyone',
        },
        emailAddress: { type: 'string' },
        domain: { type: 'string' },
        sendNotificationEmail: { type: 'boolean', description: 'Default true' },
      },
      required: ['fileId', 'role', 'type'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const role = str(args.role) as 'reader' | 'commenter' | 'writer' | 'owner';
      const type = str(args.type) as 'user' | 'group' | 'domain' | 'anyone';
      if (!fileId || !role || !type) throw new Error('fileId, role, and type are required');
      if (!['reader', 'commenter', 'writer', 'owner'].includes(role)) {
        throw new Error('role must be reader, commenter, writer, or owner');
      }
      if (!['user', 'group', 'domain', 'anyone'].includes(type)) {
        throw new Error('type must be user, group, domain, or anyone');
      }
      return driveShareFile(token, {
        fileId,
        role,
        type,
        emailAddress: str(args.emailAddress) || undefined,
        domain: str(args.domain) || undefined,
        sendNotificationEmail:
          args.sendNotificationEmail === undefined
            ? undefined
            : Boolean(args.sendNotificationEmail),
      });
    },
  },
  {
    name: 'drive_revoke_permission',
    description: 'Revoke a Drive sharing permission by permissionId (from drive_list_permissions).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        permissionId: { type: 'string' },
      },
      required: ['fileId', 'permissionId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const permissionId = str(args.permissionId);
      if (!fileId || !permissionId) throw new Error('fileId and permissionId are required');
      return driveRevokePermission(token, { fileId, permissionId });
    },
  },
  {
    name: 'drive_create_shortcut',
    description: 'Create a Drive shortcut pointing at targetId.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Target file/folder id' },
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['targetId'],
    },
    run: async (token, args) => {
      const targetId = str(args.targetId);
      if (!targetId) throw new Error('targetId is required');
      return driveCreateShortcut(token, {
        targetId,
        name: str(args.name) || undefined,
        parentId: str(args.parentId) || undefined,
      });
    },
  },
  {
    name: 'drive_list_shared_drives',
    description: 'List Shared drives (Team Drives) available to the connected account.',
    parameters: {
      type: 'object',
      properties: {
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
    },
    run: async (token, args) =>
      driveListSharedDrives(token, {
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      }),
  },
  {
    name: 'drive_upload_file',
    description:
      'Upload a file to Drive. Prefer content for utf-8 text; use contentBase64 for binary (max ~1.5MB).',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        mimeType: { type: 'string' },
        parentId: { type: 'string' },
        content: { type: 'string', description: 'UTF-8 text body' },
        contentBase64: { type: 'string', description: 'Base64 / base64url binary body' },
      },
      required: ['name'],
    },
    run: async (token, args) => {
      const name = str(args.name);
      if (!name) throw new Error('name is required');
      const content = args.content === undefined ? undefined : String(args.content);
      const contentBase64 = str(args.contentBase64) || undefined;
      if (content === undefined && !contentBase64) {
        throw new Error('content or contentBase64 is required');
      }
      return driveUploadFile(token, {
        name,
        mimeType: str(args.mimeType) || undefined,
        parentId: str(args.parentId) || undefined,
        content,
        contentBase64,
      });
    },
  },
  {
    name: 'drive_list_comments',
    description: 'List comments on a Drive file.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        pageSize: { type: 'integer' },
        pageToken: { type: 'string' },
      },
      required: ['fileId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      if (!fileId) throw new Error('fileId is required');
      return driveListComments(token, {
        fileId,
        pageSize: num(args.pageSize, 20),
        pageToken: str(args.pageToken) || undefined,
      });
    },
  },
  {
    name: 'drive_create_comment',
    description: 'Add a comment to a Drive file.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['fileId', 'content'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const content = str(args.content);
      if (!fileId || !content) throw new Error('fileId and content are required');
      return driveCreateComment(token, { fileId, content });
    },
  },
  {
    name: 'drive_delete_comment',
    description: 'Delete a Drive comment by commentId.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        commentId: { type: 'string' },
      },
      required: ['fileId', 'commentId'],
    },
    run: async (token, args) => {
      const fileId = str(args.fileId);
      const commentId = str(args.commentId);
      if (!fileId || !commentId) throw new Error('fileId and commentId are required');
      return driveDeleteComment(token, { fileId, commentId });
    },
  },
];
