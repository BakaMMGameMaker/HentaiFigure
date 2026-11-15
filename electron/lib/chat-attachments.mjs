function isChatImage(value) {
  return typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function validateChatImages(images) {
  if (!Array.isArray(images) || !images.every(isChatImage)) {
    throw new Error('有图片无法发送，请移除后重新添加。');
  }
  return images;
}

export function chatMessageContent(message, detail) {
  const images = message.role === 'user' && Array.isArray(message.images)
    ? message.images.filter(isChatImage)
    : [];
  if (!images.length) return message.content;

  const parts = images.map((url) => ({ type: 'image_url', image_url: { url, detail } }));
  return message.content ? [{ type: 'text', text: message.content }, ...parts] : parts;
}
