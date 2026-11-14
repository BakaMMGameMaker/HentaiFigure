import { unzipSync, zipSync } from 'fflate';
import type { Item, Session } from '../src/types';
import type { MobileStore } from './store';

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  if (!isBase64) return new TextEncoder().encode(decodeURIComponent(data));
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes: Uint8Array, path: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return `data:${mimeFor(path)};base64,${btoa(binary)}`;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function decodeJson<T>(bytes: Uint8Array | undefined, fallback: T): T {
  if (!bytes) return fallback;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return fallback;
  }
}

function photoSyncPath(item: Item, photo: any, thumb = false): string {
  if (thumb) {
    if (typeof photo.thumbFile === 'string' && photo.thumbFile.startsWith('images/')) return photo.thumbFile;
    if (typeof photo.syncPath === 'string' && photo.syncPath.startsWith('images/')) {
      return photo.syncPath.replace(/(\.[a-zA-Z0-9]+)$/, '.thumb.jpg');
    }
  } else if (typeof photo.syncPath === 'string' && photo.syncPath.startsWith('images/')) {
    return photo.syncPath;
  }
  if (typeof photo.file === 'string' && photo.file.startsWith('images/')) return photo.file;
  const extMatch = /^data:image\/([a-zA-Z0-9+.-]+)/.exec(photo.file || '');
  let ext = 'jpg';
  if (extMatch) {
    const m = extMatch[1].toLowerCase();
    ext = m === 'jpeg' ? 'jpg' : m;
  }
  return `images/${item.id}/${photo.id}${thumb ? '.thumb' : ''}.${ext}`;
}

export async function exportSyncZip(store: MobileStore): Promise<Uint8Array> {
  const data = await store.exportData();
  const files: Record<string, Uint8Array> = {};
  const exportedItems: Item[] = data.items.map((item) => {
    const photos = (item.photos || []).map((photo) => {
      const next: any = { ...photo };
      const mainPath = photoSyncPath(item, photo, false);
      if (typeof photo.file === 'string' && photo.file.startsWith('data:')) {
        const bytes = dataUrlToBytes(photo.file);
        if (bytes) files[mainPath] = bytes;
        next.file = mainPath;
        next.syncPath = mainPath;
      } else if (typeof photo.file === 'string' && photo.file.startsWith('images/')) {
        next.file = photo.file;
        next.syncPath = photo.file;
      }
      const thumbPath = photoSyncPath(item, photo, true);
      if (typeof photo.thumbFile === 'string' && photo.thumbFile.startsWith('data:')) {
        const bytes = dataUrlToBytes(photo.thumbFile);
        if (bytes) files[thumbPath] = bytes;
        next.thumbFile = thumbPath;
      } else if (typeof photo.thumbFile === 'string' && photo.thumbFile.startsWith('images/')) {
        next.thumbFile = photo.thumbFile;
      } else {
        next.thumbFile = mainPath;
      }
      return next;
    });
    return { ...item, photos };
  });

  files['items.json'] = encodeJson(exportedItems);
  files['daily.json'] = encodeJson(data.daily);
  files['sessions.json'] = encodeJson(data.sessions);
  files['freechat.json'] = encodeJson(data.freechat);
  files['README-sync.txt'] = new TextEncoder().encode(
    'HentaiFigure sync package.\n' +
    'This archive contains items/sessions/daily/freechat JSON and images. ' +
    'It does not contain your API key. Import it from the other device\'s Settings -> Data.\n'
  );
  return zipSync(files, { level: 6 });
}

export async function importSyncZip(store: MobileStore, bytes: Uint8Array): Promise<{ items: number; sessions: number; freechat: number }> {
  const rawEntries = unzipSync(bytes);
  const entries: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(rawEntries)) entries[key.replace(/\\\\/g, '/')] = value as Uint8Array;
  const importedItems = decodeJson<Item[]>(entries['items.json'], []);
  const importedDaily = decodeJson<Record<string, any>>(entries['daily.json'], {});
  const importedSessions = decodeJson<Record<string, Session>>(entries['sessions.json'], {});
  const importedFreechat = decodeJson<Record<string, any>>(entries['freechat.json'], {});

  for (const item of importedItems) {
    for (const photo of item.photos || []) {
      if ((photo as any).shot === 'mango') (photo as any).shot = 'private';
      const path = (photo as any).syncPath
        || (typeof photo.file === 'string' && photo.file.startsWith('images/') ? photo.file : '');
      if (path && entries[path]) {
        (photo as any).file = bytesToDataUrl(entries[path], path);
        (photo as any).syncPath = path;
      }
      const thumbPath = (typeof photo.thumbFile === 'string' && photo.thumbFile.startsWith('images/'))
        ? photo.thumbFile
        : path.replace(/(\.[a-zA-Z0-9]+)$/, '.thumb.jpg');
      if (thumbPath && entries[thumbPath]) {
        (photo as any).thumbFile = bytesToDataUrl(entries[thumbPath], thumbPath);
      } else if (path && entries[path]) {
        (photo as any).thumbFile = (photo as any).file;
      }
    }
  }

  // Merge items by id, preferring the newer updatedAt.
  const local = await store.exportData();
  const itemMap = new Map(local.items.map((i) => [i.id, i]));
  for (const item of importedItems) {
    const existing = itemMap.get(item.id);
    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) itemMap.set(item.id, item);
  }

  // Merge sessions by id, merging messages by id so neither device loses a chat.
  const sessionMap = new Map<string, Session>(Object.entries(local.sessions as Record<string, Session>).map(([id, s]) => [id, s]));
  for (const [id, incoming] of Object.entries(importedSessions)) {
    const current = sessionMap.get(id);
    if (!current) {
      sessionMap.set(id, incoming);
      continue;
    }
    const messages = new Map<string, any>();
    for (const m of current.messages || []) messages.set(m.id, m);
    for (const m of incoming.messages || []) if (!messages.has(m.id)) messages.set(m.id, m);
    const merged = { ...current, ...incoming };
    merged.messages = Array.from(messages.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    merged.summary = incoming.summary || current.summary;
    merged.archived = Boolean(current.archived || incoming.archived);
    merged.endedAt = Math.max(current.endedAt || 0, incoming.endedAt || 0) || null;
    merged.outcome = incoming.outcome || current.outcome;
    sessionMap.set(id, merged);
  }

  // Merge daily records: prefer completed, otherwise the newer one.
  const dailyMap: Record<string, any> = { ...local.daily };
  for (const [day, incoming] of Object.entries(importedDaily)) {
    const current = dailyMap[day];
    if (!current) {
      dailyMap[day] = incoming;
      continue;
    }
    const curDone = Boolean(current.completedAt);
    const incDone = Boolean(incoming.completedAt);
    if (incDone && !curDone) dailyMap[day] = incoming;
    else if ((incoming.startedAt || 0) > (current.startedAt || 0) && !curDone) dailyMap[day] = incoming;
    else if (incDone && curDone && (incoming.completedAt || 0) > (current.completedAt || 0)) dailyMap[day] = incoming;
  }

  // Merge free chat messages by id.
  const localChat = local.freechat;
  const incomingChat = importedFreechat as any;
  const chatMessages = new Map<string, any>();
  for (const m of localChat.messages || []) chatMessages.set(m.id, m);
  for (const m of incomingChat.messages || []) if (!chatMessages.has(m.id)) chatMessages.set(m.id, m);
  const mergedChat = {
    ...localChat,
    ...incomingChat,
    messages: Array.from(chatMessages.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0)),
  };
  mergedChat.lastProactiveAt = Math.max(localChat.lastProactiveAt || 0, incomingChat.lastProactiveAt || 0) || null;

  await store.importData({
    items: Array.from(itemMap.values()),
    daily: dailyMap,
    sessions: Object.fromEntries(sessionMap),
    freechat: mergedChat,
  });

  return {
    items: importedItems.length,
    sessions: Object.keys(importedSessions).length,
    freechat: Array.isArray(incomingChat.messages) ? incomingChat.messages.length : 0,
  };
}



