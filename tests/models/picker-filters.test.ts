import { describe, expect, it } from 'vitest';
import {
  isChatPickerModel,
  isEmbeddingModel,
  isImageGenerationModel,
  isNonChatSpecialistModel,
} from '@/lib/models/specs/filters';

describe('model picker filters', () => {
  it('hides image-generation and embedding models', () => {
    expect(isImageGenerationModel('gpt-image-1.5')).toBe(true);
    expect(isImageGenerationModel('dall-e-3')).toBe(true);
    expect(isEmbeddingModel('text-embedding-3-large')).toBe(true);
    expect(isChatPickerModel('gpt-image-1.5')).toBe(false);
    expect(isChatPickerModel('text-embedding-3-large')).toBe(false);
  });

  it('hides OCR / ASR / TTS specialists but keeps chat VLMs', () => {
    expect(isNonChatSpecialistModel('glm-ocr')).toBe(true);
    expect(isNonChatSpecialistModel('foo-ocr')).toBe(true);
    expect(isNonChatSpecialistModel('ocr-layout')).toBe(true);
    expect(isNonChatSpecialistModel('whisper-1')).toBe(true);
    expect(isNonChatSpecialistModel('tts-1')).toBe(true);

    expect(isNonChatSpecialistModel('glm-4.6v')).toBe(false);
    expect(isNonChatSpecialistModel('glm-4.7')).toBe(false);
    expect(isNonChatSpecialistModel('gemini-3.5-flash')).toBe(false);

    expect(isChatPickerModel('glm-ocr')).toBe(false);
    expect(isChatPickerModel('glm-4.6v')).toBe(true);
    expect(isChatPickerModel('glm-4.7')).toBe(true);
  });
});
