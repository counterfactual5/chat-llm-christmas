/** Explicit image-gen command: `/image a cat` or `/img a cat`. */
const IMAGE_CMD_RE = /^(?:\/image|\/img)\s+([\s\S]+)$/i;

export function parseImageCommand(text: string): string | null {
  const m = text.trim().match(IMAGE_CMD_RE);
  return m?.[1]?.trim() || null;
}
