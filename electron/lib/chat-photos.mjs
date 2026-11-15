import { isDeepSeekEndpoint } from './vision-config.mjs';

export const VIEW_ITEM_PHOTOS = {
  type: 'function',
  function: {
    name: 'view_item_photos',
    description: '按当前藏品的照片编号查看实际图片。根据当前话题只挑需要的照片，可以后续再查看其他角度，也可以重看。照片标签和备注只是索引，谈到画面细节前应先看图。',
    parameters: {
      type: 'object',
      properties: {
        photo_ids: { type: 'array', items: { type: 'string' }, description: '照片清单中的编号，按想看的顺序填写' },
      },
      required: ['photo_ids'],
    },
  },
};

export function createPhotoAccess({ photos, history, labels, config, loadImage }) {
  if (!Array.isArray(photos)) return null;
  const catalog = new Map(photos.filter((photo) => photo?.id && photo.file).map((photo) => [photo.id, photo]));
  if (!catalog.size) return null;

  const previousIds = new Set(history.flatMap((message) => message.viewedPhotoIds || []));
  const viewedIds = new Set();
  const supplementalParts = [];
  const nativeToolImages = isDeepSeekEndpoint(config.baseUrl);
  const detail = config.imageDetail === 'low' ? 'low' : 'high';
  const describe = (photo) => `${labels[photo.shot] || '照片'}${photo.caption ? `（${photo.caption}）` : ''}`;
  const names = [...catalog.values()].map((photo) =>
    `${photo.id}：${describe(photo)}${previousIds.has(photo.id) ? '（本对话此前已查看）' : ''}`).join('\n');

  return {
    names,
    count: catalog.size,
    viewedIds,
    instructions: `【当前藏品的照片清单】\n${names}\n按话题使用 view_item_photos 点选，涉及外观细节时先查看对应的图。已查看的标记表示过去收到过图片，想核实画面时可以重看。`,
    view(args) {
      if (!Array.isArray(args?.photo_ids) || !args.photo_ids.length) {
        return { result: { error: '请提供清单中的 photo_ids。' } };
      }
      const photos = [];
      const unavailable = [];
      const alreadyIncluded = [];
      const parts = [];
      for (const id of new Set(args.photo_ids)) {
        if (viewedIds.has(id)) {
          alreadyIncluded.push(id);
          continue;
        }
        const photo = catalog.get(id);
        const url = photo ? loadImage(photo) : null;
        if (!url) {
          if (typeof id === 'string') unavailable.push(id);
          continue;
        }
        viewedIds.add(id);
        photos.push({ id, label: describe(photo) });
        parts.push({ type: 'text', text: `${id}：${describe(photo)}` });
        parts.push({ type: 'image_url', image_url: { url, detail } });
      }
      const result = { photos, unavailable, alreadyIncluded };
      if (!parts.length) return { result };

      const text = { type: 'text', text: JSON.stringify(result) };
      if (nativeToolImages) return { result, content: [text, ...parts] };

      // Compatible endpoints may only accept images in user messages.
      supplementalParts.push(...parts);
      return { result: { ...result, note: '照片随这批工具结果后的图片消息提供。' } };
    },
    takeImageMessage() {
      if (!supplementalParts.length) return null;
      return {
        role: 'user',
        content: [{ type: 'text', text: '以下是管理员刚才点选的藏品照片。' }, ...supplementalParts.splice(0)],
      };
    },
  };
}
