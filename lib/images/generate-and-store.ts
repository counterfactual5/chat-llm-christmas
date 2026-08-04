/**
 * Generate an image via the gateway and persist it to Files API.
 * Shared by `/api/images` and the `generate_image` chat tool.
 */

import OpenAI from 'openai';
import {
  filesGatewayBaseURL,
  uploadGatewayBase64Png,
  uploadGatewayFile,
} from '@/lib/files/gateway';

export type GeneratedImageStored = {
  image: string;
  fileId: string;
  model: string;
  revised_prompt: string | null;
};

export async function generateAndStoreImage(opts: {
  apiKey: string;
  /** Chat completions / images gateway base URL. */
  baseURL: string;
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
}): Promise<GeneratedImageStored> {
  const prompt = String(opts.prompt || '').trim();
  if (!prompt) throw new Error('Missing image prompt');
  if (prompt.length > 4000) throw new Error('Prompt is too long (max 4000 chars)');

  const model = String(opts.model || 'gpt-image-1.5').trim() || 'gpt-image-1.5';
  const size = String(opts.size || '1024x1024').trim() || '1024x1024';
  const quality = String(opts.quality || 'medium').trim();
  const apiKey = String(opts.apiKey || '').trim();
  const baseURL = String(opts.baseURL || '').trim();
  if (!apiKey || !baseURL) throw new Error('Image generation requires a connected account');

  const openai = new OpenAI({ apiKey, baseURL });
  const result = (await openai.images.generate({
    model,
    prompt,
    n: 1,
    size: size as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
    ...(quality ? { quality: quality as 'low' | 'medium' | 'high' | 'auto' } : {}),
  } as any)) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };

  const item = result?.data?.[0];
  const b64 = item?.b64_json;
  const remoteUrl = item?.url;
  if (!b64 && !remoteUrl) {
    throw new Error('Upstream returned no image data');
  }

  const filesBaseURL = filesGatewayBaseURL();
  const filesModel =
    String(process.env.LLM_CHRISTMAS_FILE_MODEL || 'gpt-4o').trim() || 'gpt-4o';
  const filename = `gen-${Date.now()}.png`;

  let fileId = '';
  if (b64) {
    const uploaded = await uploadGatewayBase64Png({
      apiKey,
      baseURL: filesBaseURL,
      b64,
      filename,
      model: filesModel,
    });
    fileId = uploaded.id;
  } else if (remoteUrl) {
    const fetched = await fetch(String(remoteUrl));
    if (!fetched.ok) {
      throw new Error(`Failed to fetch generated image URL (HTTP ${fetched.status})`);
    }
    const bytes = new Uint8Array(await fetched.arrayBuffer());
    const uploaded = await uploadGatewayFile({
      apiKey,
      baseURL: filesBaseURL,
      bytes,
      filename,
      mime: fetched.headers.get('content-type') || 'image/png',
      model: filesModel,
    });
    fileId = uploaded.id;
  }

  if (!fileId) throw new Error('Image was generated but no file id was saved');

  return {
    image: `/api/files/${encodeURIComponent(fileId)}`,
    fileId,
    model,
    revised_prompt: item?.revised_prompt || null,
  };
}
