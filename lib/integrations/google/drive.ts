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

type DriveListedFile = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
};

/** Paginate Drive search and collect file ids (and light metadata). */
export async function driveListFileIds(
  accessToken: string,
  opts: { query: string; maxTotal?: number; pageSize?: number },
) {
  const rawQuery = String(opts.query || '').trim();
  if (!rawQuery) throw new Error('query is required');
  // Drive includes trashed files by default; bulk mutators should not touch trash
  // unless the caller explicitly filters on trashed=.
  const query = /\btrashed\s*=/i.test(rawQuery) ? rawQuery : `(${rawQuery}) and trashed=false`;
  const maxTotal = Math.min(Math.max(opts.maxTotal || 100, 1), 500);
  const pageSize = Math.min(Math.max(opts.pageSize || 50, 1), 50);
  const files: DriveListedFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let truncated = false;

  while (files.length < maxTotal) {
    const list = await driveSearchFiles(accessToken, {
      query,
      pageSize: Math.min(pageSize, maxTotal - files.length),
      pageToken,
    });
    pages += 1;
    const batch = Array.isArray(list.files)
      ? (list.files as Array<GoogleRestJson>)
          .map((f) => ({
            id: String(f.id || '').trim(),
            name: f.name != null ? String(f.name) : undefined,
            mimeType: f.mimeType != null ? String(f.mimeType) : undefined,
            webViewLink: f.webViewLink != null ? String(f.webViewLink) : undefined,
            parents: Array.isArray(f.parents)
              ? (f.parents as unknown[]).map((p) => String(p)).filter(Boolean)
              : undefined,
          }))
          .filter((f) => f.id)
      : [];
    for (const file of batch) {
      if (files.length >= maxTotal) {
        truncated = true;
        break;
      }
      files.push(file);
    }
    const next = String(list.nextPageToken || '').trim();
    if (!next || !batch.length) break;
    if (files.length >= maxTotal) {
      truncated = true;
      break;
    }
    pageToken = next;
    if (pages >= 20) {
      truncated = true;
      break;
    }
  }

  return {
    query,
    ids: files.map((f) => f.id),
    count: files.length,
    pages,
    truncated,
    sample: files.slice(0, 8),
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function summarizeDriveBulkResults<T extends { ok: boolean }>(results: T[]) {
  const failed = results.filter((r) => !r.ok);
  return {
    sample: results.slice(0, 8),
    failedSample: failed.slice(0, 20),
  };
}

/** Move matching files to trash. Requires an explicit Drive query. */
export async function driveTrashByQuery(
  accessToken: string,
  opts: { query: string; maxTotal?: number },
) {
  const listed = await driveListFileIds(accessToken, {
    query: opts.query,
    maxTotal: opts.maxTotal ?? 100,
  });
  const results = await mapPool(listed.ids, 4, async (fileId) => {
    try {
      const out = await driveTrashFile(accessToken, fileId);
      return { fileId, ok: true as const, name: out?.name };
    } catch (error) {
      return {
        fileId,
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const trashed = results.filter((r) => r.ok).length;
  const summary = summarizeDriveBulkResults(results);
  return {
    ok: true,
    query: listed.query,
    requested: listed.count,
    trashed,
    failed: results.length - trashed,
    truncated: listed.truncated,
    ...summary,
  };
}

/** Move a file into destinationFolderId (removes previous parents). */
export async function driveMoveFile(
  accessToken: string,
  opts: { fileId: string; destinationFolderId: string },
) {
  const fileId = String(opts.fileId || '').trim();
  const destinationFolderId = String(opts.destinationFolderId || '').trim();
  if (!fileId) throw new Error('fileId is required');
  if (!destinationFolderId) throw new Error('destinationFolderId is required');
  const meta = await driveGetFile(accessToken, fileId);
  const parents = Array.isArray(meta.parents)
    ? (meta.parents as unknown[]).map((p) => String(p)).filter(Boolean)
    : [];
  if (!parents.length) {
    throw new Error(
      'Cannot move file: current parents are unknown (missing parents on metadata). Use drive_update_file with explicit removeParents/addParents.',
    );
  }
  const removeParents = parents.filter((p) => p !== destinationFolderId);
  return driveUpdateFile(accessToken, {
    fileId,
    addParents: parents.includes(destinationFolderId) ? undefined : [destinationFolderId],
    removeParents: removeParents.length ? removeParents : undefined,
  });
}

/** Move all files matching a query into a destination folder. */
export async function driveMoveByQuery(
  accessToken: string,
  opts: { query: string; destinationFolderId: string; maxTotal?: number },
) {
  const destinationFolderId = String(opts.destinationFolderId || '').trim();
  if (!destinationFolderId) throw new Error('destinationFolderId is required');
  const listed = await driveListFileIds(accessToken, {
    query: opts.query,
    maxTotal: opts.maxTotal ?? 100,
  });
  const results = await mapPool(listed.ids, 3, async (fileId) => {
    try {
      const out = await driveMoveFile(accessToken, { fileId, destinationFolderId });
      return { fileId, ok: true as const, name: out?.name };
    } catch (error) {
      return {
        fileId,
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const moved = results.filter((r) => r.ok).length;
  const summary = summarizeDriveBulkResults(results);
  return {
    ok: true,
    query: listed.query,
    destinationFolderId,
    requested: listed.count,
    moved,
    failed: results.length - moved,
    truncated: listed.truncated,
    ...summary,
  };
}

/** Share all files matching a query. */
export async function driveShareByQuery(
  accessToken: string,
  opts: {
    query: string;
    role: 'reader' | 'commenter' | 'writer' | 'owner';
    type: 'user' | 'group' | 'domain' | 'anyone';
    emailAddress?: string;
    domain?: string;
    sendNotificationEmail?: boolean;
    maxTotal?: number;
  },
) {
  const listed = await driveListFileIds(accessToken, {
    query: opts.query,
    maxTotal: opts.maxTotal ?? 50,
  });
  const results = await mapPool(listed.ids, 3, async (fileId) => {
    try {
      const out = await driveShareFile(accessToken, {
        fileId,
        role: opts.role,
        type: opts.type,
        emailAddress: opts.emailAddress,
        domain: opts.domain,
        sendNotificationEmail: opts.sendNotificationEmail,
      });
      return { fileId, ok: true as const, permissionId: out?.id };
    } catch (error) {
      return {
        fileId,
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const shared = results.filter((r) => r.ok).length;
  const summary = summarizeDriveBulkResults(results);
  return {
    ok: true,
    query: listed.query,
    requested: listed.count,
    shared,
    failed: results.length - shared,
    truncated: listed.truncated,
    ...summary,
  };
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function findChildFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveListedFile | null> {
  const safeName = escapeDriveQueryLiteral(name);
  const safeParent = escapeDriveQueryLiteral(parentId);
  const q =
    `'${safeParent}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${safeName}'`;
  const listed = await driveSearchFiles(accessToken, { query: q, pageSize: 10 });
  const files = Array.isArray(listed.files) ? (listed.files as Array<GoogleRestJson>) : [];
  const hit = files.find((f) => String(f.name || '') === name && f.id);
  if (!hit?.id) return null;
  return {
    id: String(hit.id),
    name: String(hit.name || name),
    mimeType: String(hit.mimeType || 'application/vnd.google-apps.folder'),
    webViewLink: hit.webViewLink != null ? String(hit.webViewLink) : undefined,
  };
}

function splitDrivePath(path: string): string[] {
  return String(path || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.');
}

/** Resolve a folder path like "Documents/Work/Q3" under My Drive (or parentId). */
export async function driveResolvePath(
  accessToken: string,
  opts: { path: string; parentId?: string },
) {
  const segments = splitDrivePath(opts.path);
  if (!segments.length) throw new Error('path is required (e.g. Documents/Work)');
  let parentId = String(opts.parentId || 'root').trim() || 'root';
  const resolved: Array<{ id: string; name: string }> = [];
  for (const name of segments) {
    const folder = await findChildFolder(accessToken, parentId, name);
    if (!folder) {
      return {
        ok: false as const,
        path: segments.join('/'),
        resolved,
        missing: name,
        parentId,
        error: `Folder not found: ${[...resolved.map((r) => r.name), name].join('/')}`,
      };
    }
    resolved.push({ id: folder.id, name: folder.name || name });
    parentId = folder.id;
  }
  return {
    ok: true as const,
    path: segments.join('/'),
    folderId: parentId,
    resolved,
  };
}

/** Ensure each folder in a path exists (create missing ones). */
export async function driveEnsureFolder(
  accessToken: string,
  opts: { path: string; parentId?: string },
) {
  const segments = splitDrivePath(opts.path);
  if (!segments.length) throw new Error('path is required (e.g. Documents/Work)');
  let parentId = String(opts.parentId || 'root').trim() || 'root';
  const resolved: Array<{ id: string; name: string; created: boolean }> = [];
  for (const name of segments) {
    const existing = await findChildFolder(accessToken, parentId, name);
    if (existing) {
      resolved.push({ id: existing.id, name: existing.name || name, created: false });
      parentId = existing.id;
      continue;
    }
    const created = await driveCreateFolder(accessToken, { name, parentId });
    const id = String(created?.id || '').trim();
    if (!id) throw new Error(`Failed to create folder: ${name}`);
    resolved.push({ id, name, created: true });
    parentId = id;
  }
  return {
    ok: true,
    path: segments.join('/'),
    folderId: parentId,
    resolved,
  };
}

