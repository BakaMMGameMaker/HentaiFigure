import type { Photo, Shot } from '../../src/types';

export const SHOT_LABELS: Record<Shot, string>;
export const SHOT_OPTIONS: { value: Shot; label: string }[];
export function shotLabel(shot: string | undefined): string;
export function sortPhotos(photos: readonly Photo[]): Photo[];
