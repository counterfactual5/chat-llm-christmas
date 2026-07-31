import {
  DRIVE_API,
  googleAuthHeaders,
  googleGetJson,
  googleSendJson,
  readGoogleError,
  type GoogleRestJson,
} from '@/lib/integrations/google/client';

export async function driveSearchFiles(
  accessToken: string,
  opts: { query?: string; pageSize?: number; pageToken?: string },
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 10, 1), 50)),
    fields:
      'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size,owners,parents)',
  });
  if (opts.query) params.set('q', opts.query);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(`${DRIVE_API}/files?${params.toString()}`, accessToken);
}

export async function driveGetFile(accessToken: string, fileId: string) {
  const params = new URLSearchParams({
    fields:
      'id,name,mimeType,webViewLink,webContentLink,modifiedTime,size,owners,parents,description',
  });
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    accessToken,
  );
}

export async function driveReadFileText(accessToken: string, fileId: string) {
  const meta = await driveGetFile(accessToken, fileId);
  const mime = String(meta.mimeType || '');
  let text = '';

  if (mime.startsWith('application/vnd.google-apps.')) {
    const exportMime =
      mime === 'application/vnd.google-apps.spreadsheet'
        ? 'text/csv'
        : 'text/plain';
    const response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: googleAuthHeaders(accessToken), cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await readGoogleError(response));
    text = await response.text();
  } else {
    const response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: googleAuthHeaders(accessToken), cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await readGoogleError(response));
    text = await response.text();
  }

  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    webViewLink: meta.webViewLink,
    text: text.slice(0, 40_000),
  };
}

export async function driveCreateTextFile(
  accessToken: string,
  opts: { name: string; content: string; parentId?: string; mimeType?: string },
) {
  const mimeType = opts.mimeType || 'text/plain';
  const metadata: GoogleRestJson = { name: opts.name, mimeType };
  if (opts.parentId) metadata.parents = [opts.parentId];

  const boundary = `christmas_${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    opts.content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: googleAuthHeaders(accessToken, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(await readGoogleError(response));
  return (await response.json()) as GoogleRestJson;
}

export async function driveCreateFolder(
  accessToken: string,
  opts: { name: string; parentId?: string },
) {
  const metadata: GoogleRestJson = {
    name: opts.name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (opts.parentId) metadata.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,parents`,
    accessToken,
    'POST',
    metadata,
  );
}

export async function driveCopyFile(
  accessToken: string,
  opts: { fileId: string; name?: string; parentId?: string },
) {
  const body: GoogleRestJson = {};
  if (opts.name) body.name = opts.name;
  if (opts.parentId) body.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/copy?fields=id,name,mimeType,webViewLink,parents`,
    accessToken,
    'POST',
    body,
  );
}

/** Rename and/or move a file (update parents via addParents/removeParents). */
export async function driveUpdateFile(
  accessToken: string,
  opts: {
    fileId: string;
    name?: string;
    description?: string;
    addParents?: string[];
    removeParents?: string[];
  },
) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,webViewLink,parents,description',
  });
  if (opts.addParents?.length) params.set('addParents', opts.addParents.join(','));
  if (opts.removeParents?.length) params.set('removeParents', opts.removeParents.join(','));
  const body: GoogleRestJson = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}?${params.toString()}`,
    accessToken,
    'PATCH',
    body,
  );
}

export async function driveTrashFile(accessToken: string, fileId: string) {
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,webViewLink`,
    accessToken,
    'PATCH',
    { trashed: true },
  );
}

export async function driveUntrashFile(accessToken: string, fileId: string) {
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,webViewLink`,
    accessToken,
    'PATCH',
    { trashed: false },
  );
}

export async function driveDeleteFile(accessToken: string, fileId: string) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: fileId };
}

/** Export a Google Docs/Sheets/Slides file to a target MIME (returns text/base64-safe text). */
export async function driveExportFile(
  accessToken: string,
  opts: { fileId: string; mimeType?: string },
) {
  const meta = await driveGetFile(accessToken, opts.fileId);
  const mime = String(meta.mimeType || '');
  let exportMime = opts.mimeType;
  if (!exportMime) {
    if (mime === 'application/vnd.google-apps.spreadsheet') exportMime = 'text/csv';
    else if (mime === 'application/vnd.google-apps.presentation') {
      exportMime = 'text/plain';
    } else {
      exportMime = 'text/plain';
    }
  }
  const response = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
    { headers: googleAuthHeaders(accessToken), cache: 'no-store' },
  );
  if (!response.ok) throw new Error(await readGoogleError(response));
  const text = await response.text();
  return {
    id: meta.id,
    name: meta.name,
    sourceMimeType: meta.mimeType,
    exportMimeType: exportMime,
    webViewLink: meta.webViewLink,
    content: text.slice(0, 40_000),
  };
}

export async function driveListPermissions(accessToken: string, fileId: string) {
  const params = new URLSearchParams({
    fields:
      'permissions(id,type,role,emailAddress,domain,displayName,photoLink,allowFileDiscovery)',
    pageSize: '100',
  });
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
    accessToken,
  );
}

export async function driveShareFile(
  accessToken: string,
  opts: {
    fileId: string;
    role: 'reader' | 'commenter' | 'writer' | 'owner';
    type: 'user' | 'group' | 'domain' | 'anyone';
    emailAddress?: string;
    domain?: string;
    sendNotificationEmail?: boolean;
  },
) {
  const body: GoogleRestJson = {
    role: opts.role,
    type: opts.type,
  };
  if (opts.emailAddress) body.emailAddress = opts.emailAddress;
  if (opts.domain) body.domain = opts.domain;
  const params = new URLSearchParams({
    fields: 'id,type,role,emailAddress,domain,displayName',
    sendNotificationEmail: opts.sendNotificationEmail === false ? 'false' : 'true',
  });
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/permissions?${params.toString()}`,
    accessToken,
    'POST',
    body,
  );
}

export async function driveRevokePermission(
  accessToken: string,
  opts: { fileId: string; permissionId: string },
) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/permissions/${encodeURIComponent(opts.permissionId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, fileId: opts.fileId, permissionId: opts.permissionId };
}

export async function driveCreateShortcut(
  accessToken: string,
  opts: { targetId: string; name?: string; parentId?: string },
) {
  const metadata: GoogleRestJson = {
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: opts.targetId },
  };
  if (opts.name) metadata.name = opts.name;
  if (opts.parentId) metadata.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,shortcutDetails,parents`,
    accessToken,
    'POST',
    metadata,
  );
}

export async function driveListSharedDrives(
  accessToken: string,
  opts: { pageSize?: number; pageToken?: string } = {},
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 20, 1), 50)),
    fields: 'nextPageToken,drives(id,name,createdTime)',
  });
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(`${DRIVE_API}/drives?${params.toString()}`, accessToken);
}

/** Upload a file from utf-8 text or base64 payload. */
export async function driveUploadFile(
  accessToken: string,
  opts: {
    name: string;
    mimeType?: string;
    parentId?: string;
    content?: string;
    contentBase64?: string;
  },
) {
  const mimeType = opts.mimeType || 'application/octet-stream';
  const metadata: GoogleRestJson = { name: opts.name, mimeType };
  if (opts.parentId) metadata.parents = [opts.parentId];

  let binary: Uint8Array;
  if (opts.contentBase64) {
    const padded = opts.contentBase64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const raw = atob(padded + pad);
    binary = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } else {
    binary = new TextEncoder().encode(opts.content || '');
  }
  // Cap upload size in chat context (~1.5MB decoded).
  if (binary.byteLength > 1_500_000) {
    throw new Error('Upload too large for chat tool (max ~1.5MB). Use Drive UI for bigger files.');
  }

  const boundary = `christmas_${Date.now().toString(36)}`;
  const metaPart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: binary',
    '',
  ].join('\r\n');
  const endPart = `\r\n--${boundary}--\r\n`;
  const metaBytes = new TextEncoder().encode(metaPart);
  const endBytes = new TextEncoder().encode(endPart);
  const body = new Uint8Array(metaBytes.length + binary.length + endBytes.length);
  body.set(metaBytes, 0);
  body.set(binary, metaBytes.length);
  body.set(endBytes, metaBytes.length + binary.length);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size',
    {
      method: 'POST',
      headers: googleAuthHeaders(accessToken, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(await readGoogleError(response));
  return (await response.json()) as GoogleRestJson;
}

/** List immediate children of a folder (Drive search under parent). Defaults to My Drive root. */
export async function driveListChildren(
  accessToken: string,
  opts: { folderId?: string; pageSize?: number; pageToken?: string } = {},
) {
  const folderId = String(opts.folderId || 'root').trim() || 'root';
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`;
  return driveSearchFiles(accessToken, {
    query: q,
    pageSize: opts.pageSize,
    pageToken: opts.pageToken,
  });
}

export async function driveListComments(
  accessToken: string,
  opts: { fileId: string; pageSize?: number; pageToken?: string },
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 20, 1), 100)),
    fields:
      'nextPageToken,comments(id,content,createdTime,modifiedTime,author,resolved,htmlContent,quotedFileContent)',
  });
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments?${params.toString()}`,
    accessToken,
  );
}

export async function driveCreateComment(
  accessToken: string,
  opts: { fileId: string; content: string },
) {
  const content = String(opts.content || '').trim();
  if (!content) throw new Error('content is required');
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments?fields=id,content,createdTime,author`,
    accessToken,
    'POST',
    { content },
  );
}

export async function driveDeleteComment(
  accessToken: string,
  opts: { fileId: string; commentId: string },
) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments/${encodeURIComponent(opts.commentId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: opts.commentId };
}

