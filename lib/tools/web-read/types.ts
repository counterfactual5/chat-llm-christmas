/**
 * Shared web-read outcome type (execution lives on chat-api).
 */

export type WebReadOutcome = {
  provider: string;
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
};
