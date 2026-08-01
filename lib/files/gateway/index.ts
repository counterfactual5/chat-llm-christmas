/** Barrel: llm.christmas (NewAPI) Files API — upload + chat content-part helpers. */

export type { GatewayFileRef } from './types';
export { gatewayBaseURL, resolveUploadModel } from './base';
export { parseDataUrl } from './data-url';
export { uploadGatewayFile, uploadGatewayDataUrl, uploadGatewayBase64Png } from './upload';
export { toImageContentPart } from './content-parts';
export { generatedImageAssistantSummary } from './prompts';
