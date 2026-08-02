import { NextRequest } from 'next/server';
import {
  filesGatewayBaseURL,
  uploadGatewayDataUrl,
  uploadGatewayFile,
} from '@/lib/files/gateway';

export const runtime = 'edge';
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Upload an image/file to the llm.christmas Files API and return a reusable file id.
 * Body: multipart form (`file`) or JSON `{ dataUrl, filename? }`.
 */
export async function POST(req: NextRequest) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return json({ error: 'Sign in to upload files to the gateway.' }, 401);
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let uploaded;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return json({ error: 'Missing file.' }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      uploaded = await uploadGatewayFile({
        apiKey,
        bytes,
        filename: file.name || 'upload.bin',
        mime:
          file.type && file.type !== 'application/octet-stream'
            ? file.type
            : /\.(jpe?g)$/i.test(file.name || '')
              ? 'image/jpeg'
              : /\.png$/i.test(file.name || '')
                ? 'image/png'
                : /\.webp$/i.test(file.name || '')
                  ? 'image/webp'
                  : /\.gif$/i.test(file.name || '')
                    ? 'image/gif'
                    : file.type || 'application/octet-stream',
      });
    } else {
      const body = await req.json();
      const dataUrl = String(body?.dataUrl || '').trim();
      if (!dataUrl.startsWith('data:')) {
        return json({ error: 'Expected dataUrl or multipart file.' }, 400);
      }
      uploaded = await uploadGatewayDataUrl({
        apiKey,
        dataUrl,
        filename: String(body?.filename || 'upload.bin'),
      });
    }

    return json({
      success: true,
      id: uploaded.id,
      filename: uploaded.filename,
      bytes: uploaded.bytes,
      purpose: uploaded.purpose,
      /** App-local display URL (proxied). */
      url: `/api/files/${encodeURIComponent(uploaded.id)}`,
    });
  } catch (err: any) {
    return json({ error: err?.message || 'Upload failed' }, 502);
  }
}

/** List account-scoped files for the File Manager. */
export async function GET(req: NextRequest) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) return json({ error: 'Unauthorized' }, 401);
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 100));
  const baseURL = filesGatewayBaseURL();
  const res = await fetch(`${baseURL}/files?limit=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  return json(data, res.status);
}
