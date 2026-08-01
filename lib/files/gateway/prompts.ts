/** Clear assistant stub so non-vision models still know an image already exists. */
export function generatedImageAssistantSummary(prompts: string[]): string {
  const clean = prompts.map((p) => String(p || '').trim()).filter(Boolean);
  return [
    '【图片已成功生成并展示给用户】',
    'Christmas Chat successfully generated an image; it is already visible in the chat UI.',
    'Do NOT say generation failed. Do NOT claim missing project folders, workspaces, disks, or local tools.',
    'Do NOT substitute web search links or ASCII art for this image unless the user explicitly asks for alternatives.',
    'If the user asks what the generated image looks like or needs its visual details, and a 【历史图片引用（未转写）】 path is present below, call image_understand with that path.',
    clean.length ? `Image prompt: ${clean.join('; ')}` : 'Image prompt: (see prior user /image command)',
  ].join('\n');
}
