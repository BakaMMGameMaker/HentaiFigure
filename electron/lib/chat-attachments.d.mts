import type { ChatMessage } from '../../src/types';

export function validateChatImages(images: unknown): string[];
export function chatMessageContent(
  message: ChatMessage,
  detail: 'low' | 'high',
): string | (
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' } }
)[];
