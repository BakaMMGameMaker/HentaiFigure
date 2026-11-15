import type { ChatMessage, Photo } from '../../src/types';

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' } };
type PhotoPart = TextPart | ImagePart;

export const VIEW_ITEM_PHOTOS: { type: string; function: { name: string; description: string; parameters: object } };
export function createPhotoAccess(options: {
  photos: Photo[];
  history: ChatMessage[];
  labels: Record<string, string>;
  config: { baseUrl: string; imageDetail: 'low' | 'high' };
  loadImage: (photo: Photo) => string | null;
}): {
  names: string;
  count: number;
  instructions: string;
  viewedIds: Set<string>;
  view(args: unknown): { result: object; content?: PhotoPart[] };
  takeImageMessage(): { role: 'user'; content: PhotoPart[] } | null;
} | null;
