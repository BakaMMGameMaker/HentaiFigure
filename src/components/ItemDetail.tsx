import { useState } from 'react';
import type { Character, Item } from '../types';
import {
  formatDateCN, formatMoney, photoUrl, shotLabel, statusLabel, typeLabel,
} from '../constants';
import { Modal, PhotoLightbox } from './ui';
import {
  IconBook, IconCalendar, IconGallery, IconPencil, IconTrash, IconX,
} from '../icons';

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
  const photos = item.photos || [];
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const current = photos[active] || photos[0];
  const mainSrc = current ? photoUrl(current.file) : '';
  const character = characters.find((c) => c.id === item.characterId) || null;
  const siblings = character ? relatedItems.filter((i) => i.id !== item.id) : [];

  return (
    <Modal className="modal-detail" onClose={onClose}>
      <div className="detail">
        <div className="detail-gallery">
          <div className="detail-main" onClick={() => current && setLightbox(true)}>
            {mainSrc ? (
              <img src={mainSrc} alt={item.name} />
            ) : (
              <div className="detail-main-empty"><IconGallery size={30} /></div>
            )}
            <span className="detail-main-tag">{current ? shotLabel(current.shot) : ''}</span>
          </div>
          {photos.length > 1 && (
            <div className="detail-thumbs">
              {photos.map((photo, i) => (
                <button
                  key={photo.id}
                  className={`detail-thumb ${i === active ? 'active' : ''}`}
                  onClick={() => setActive(i)}
                  title={photo.caption || shotLabel(photo.shot)}
                >
                  <img src={photoUrl(photo.thumbFile || photo.file, true)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="detail-head">
            <div>
              <div className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</div>
              <h2>{item.name}</h2>
              <div className="detail-sub">
                {typeLabel(item.type)}
                {character ? ` · ${character.name}` : item.series ? ` · ${item.series}` : ''}
                {item.scale ? ` · ${item.scale}` : ''}
              </div>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="关闭"><IconX size={20} /></button>
          </div>

          {character && (
            <div className="detail-character">
              <span className="character-badge large">{character.name.slice(0, 1)}</span>
              <div>
                <strong>{character.name}</strong>
                <small>{character.source ? `出自《${character.source}》` : '未填写作品'}</small>
                {character.description && <p>{character.description}</p>}
                {siblings.length > 0 && (
                  <small className="detail-character-more">
                    同角色还有 {siblings.length} 款：{siblings.slice(0, 4).map((i) => i.name).join('、')}
                  </small>
                )}
              </div>
            </div>
          )}

          {item.dueDate && (
            <div className="detail-due">
              <IconCalendar size={16} />
              补款日 {formatDateCN(item.dueDate)}
            </div>
          )}

          <div className="detail-prices">
            <div><span>原价</span><b>{formatMoney(item.originalPrice)}</b></div>
            <div><span>购入</span><b>{formatMoney(item.purchasePrice)}</b></div>
            <div><span>定金</span><b>{formatMoney(item.deposit)}</b></div>
            <div><span>尾款</span><b>{formatMoney(item.balance)}</b></div>
          </div>

          {item.detail && (
            <div className="detail-section">
              <div className="detail-section-title">商品详情</div>
              <p className="detail-intro">{item.detail}</p>
            </div>
          )}

          {(item.thought || item.intro) && (
            <div className="detail-section">
              <div className="detail-section-title">最初的想法</div>
              <p className="detail-intro">{item.thought || item.intro}</p>
            </div>
          )}

          <div className="detail-section">
            <div className="detail-section-title">照片 · {photos.length} 张</div>
            <div className="detail-tags">
              {photos.map((p, i) => (
                <button key={p.id} className="shot-tag" onClick={() => { setActive(i); setLightbox(true); }}>
                  {shotLabel(p.shot)}
                </button>
              ))}
            </div>
          </div>

          <div className="detail-actions">
            <button className="btn btn-primary" onClick={onEdit}><IconPencil size={15} /> 编辑</button>
            <button className="btn btn-soft" onClick={onViewMemory}><IconBook size={15} /> 相关记忆</button>
            <button className="btn btn-danger-ghost" onClick={onDelete}><IconTrash size={15} /> 删除</button>
          </div>
        </div>
      </div>
      {lightbox && current && (
        <PhotoLightbox photos={photos} startIndex={active} onClose={() => setLightbox(false)} />
      )}
    </Modal>
  );
}
