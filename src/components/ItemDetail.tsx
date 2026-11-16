import { useEffect, useRef, useState } from 'react';
import type { Character, Item } from '../types';
import {
  formatDateCN, formatMoney, photoUrl, shotLabel, sortPhotos, statusLabel, typeLabel,
} from '../constants';
import { Modal, PhotoLightbox } from './ui';
import { IconBook, IconCalendar, IconChevronLeft, IconChevronRight, IconGallery, IconPencil, IconTrash, IconX } from '../icons';
import { cx } from '../utils';

export function ItemDetail({
  item,
  characters,
  relatedItems,
  onClose,
  onEdit,
  onDelete,
  onViewMemory,
}: {
  item: Item;
  characters: Character[];
  relatedItems: Item[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewMemory: () => void;
}) {
  const photos = sortPhotos(item.photos || []);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const current = photos[active] || photos[0];
  const mainSrc = current ? photoUrl(current.file) : '';
  const character = characters.find((c) => c.id === item.characterId) || null;
  const siblings = character ? relatedItems.filter((i) => i.id !== item.id && i.characterId === character.id) : [];

  useEffect(() => {
    const strip = thumbsRef.current;
    const thumb = strip?.children[active] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const start = thumb.offsetLeft;
    const end = start + thumb.offsetWidth;
    if (start < strip.scrollLeft) strip.scrollLeft = start;
    if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth;
  }, [active]);

  return (
    <Modal size="xl" onClose={onClose} className="detail-sheet" titleId="item-detail-title">
      <header className="detail-head">
        <div className="detail-heading">
          <span className={cx('pill', `tone-${item.status}`)}>{statusLabel(item.status)}</span>
          <h2 id="item-detail-title">{item.name}</h2>
          <div className="detail-sub">
            {typeLabel(item.type)}
            {character ? ` · ${character.name}` : item.series ? ` · ${item.series}` : ''}
            {item.scale ? ` · ${item.scale}` : ''}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><IconX size={19} /></button>
      </header>

      <div className="detail">
        <div className="detail-gallery">
          <div className="detail-main">
            {mainSrc ? (
              <button type="button" className="detail-preview" onClick={() => setLightbox(true)} aria-label="查看原图">
                <img src={mainSrc} alt={item.name} />
              </button>
            ) : (
              <div className="detail-empty"><IconGallery size={30} /></div>
            )}
          </div>
          {current && (
            <div className="detail-photo-meta">
              <span className="pill">{shotLabel(current.shot)}</span>
              {current.caption && <span className="detail-caption" title={current.caption}>{current.caption}</span>}
              <span className="detail-photo-count">{active + 1} / {photos.length}</span>
            </div>
          )}
          {photos.length > 1 && (
            <div className="detail-photo-nav">
              <button type="button" className="icon-btn sm" aria-label="上一张照片" disabled={active === 0} onClick={() => setActive(active - 1)}>
                <IconChevronLeft size={17} />
              </button>
              <div className="detail-thumbs" ref={thumbsRef}>
                {photos.map((photo, i) => (
                  <button
                    type="button"
                    key={photo.id}
                    className={cx('detail-thumb', i === active && 'active')}
                    onClick={() => setActive(i)}
                    title={photo.caption || shotLabel(photo.shot)}
                    aria-label={`${i + 1} · ${photo.caption || shotLabel(photo.shot)}`}
                    aria-pressed={i === active}
                  >
                    <img src={photoUrl(photo.thumbFile || photo.file, true)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
              <button type="button" className="icon-btn sm" aria-label="下一张照片" disabled={active === photos.length - 1} onClick={() => setActive(active + 1)}>
                <IconChevronRight size={17} />
              </button>
            </div>
          )}
        </div>

        <section className="detail-scroll" aria-label="藏品资料">
          {character && (
            <div className="callout">
              <div className="char-row">
                <span className="char-badge lg">{character.name.slice(0, 1)}</span>
                <div>
                  <strong>{character.name}</strong>
                  <small>{character.source ? `出自《${character.source}》` : '未填写作品'}</small>
                </div>
              </div>
              {character.description && <p className="char-desc">{character.description}</p>}
              {siblings.length > 0 && (
                <div className="char-more">
                  同角色还有 {siblings.length} 款：{siblings.slice(0, 4).map((i) => i.name).join('、')}
                </div>
              )}
            </div>
          )}

          {item.dueDate && (
            <div className="due-pill">
              <IconCalendar size={15} />
              补款日 {formatDateCN(item.dueDate)}
            </div>
          )}

          <div className="price-strip">
            <div><span>原价</span><b>{formatMoney(item.originalPrice)}</b></div>
            <div><span>购入</span><b>{formatMoney(item.purchasePrice)}</b></div>
            <div><span>定金</span><b>{formatMoney(item.deposit)}</b></div>
            <div><span>尾款</span><b>{formatMoney(item.balance)}</b></div>
          </div>

          {item.detail && (
            <div className="detail-block">
              <div className="detail-block-title">商品详情</div>
              <p>{item.detail}</p>
            </div>
          )}

          {(item.thought || item.intro) && (
            <div className="detail-block">
              <div className="detail-block-title">最初的想法</div>
              <p>{item.thought || item.intro}</p>
            </div>
          )}

          <div className="detail-block">
            <div className="detail-block-title">照片 · {photos.length} 张</div>
            <div className="tag-list">
              {photos.map((p, i) => (
                <button type="button" key={p.id} className="tag-btn" onClick={() => { setActive(i); setLightbox(true); }}>
                  {shotLabel(p.shot)}{p.caption ? ` · ${p.caption}` : ''}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
      <footer className="detail-foot">
        <button type="button" className="btn btn-danger-ghost" onClick={onDelete}><IconTrash size={15} /> 删除</button>
        <button type="button" className="btn btn-soft" onClick={onViewMemory}><IconBook size={15} /> 相关记忆</button>
        <button type="button" className="btn btn-primary" onClick={onEdit}><IconPencil size={15} /> 编辑</button>
      </footer>

      {lightbox && current && (
        <PhotoLightbox photos={photos} startIndex={active} onClose={() => setLightbox(false)} />
      )}
    </Modal>
  );
}
