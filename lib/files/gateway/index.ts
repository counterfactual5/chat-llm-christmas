/** Barrel: llm.christmas (NewAPI) Files API — upload + chat content-part helpers. */

export type { GatewayFileRef } from './types';
export { gatewayBaseURL, filesGatewayBaseURL, resolveUploadModel } from './base';
export { parseDataUrl } from './data-url';
export { uploadGatewayFile, uploadGatewayDataUrl, uploadGatewayBase64Png } from './upload';
export {
  mutateGatewayOfficeFile,
  restoreGatewayOfficeFile,
  type OfficeMutateResult,
  type OfficeRestoreResult,
} from './mutate';
export { toImageContentPart } from './content-parts';
export { generatedImageAssistantSummary } from './prompts';
