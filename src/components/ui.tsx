import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { photoUrl } from '../constants';
import type { Photo } from '../types';
import { IconChevronLeft, IconChevronRight, IconX } from '../icons';

export function Modal({
  children,
  onClose,
  className = '',
  closeOnBackdrop = true,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${className}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: string }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  desc,
  action,
  icon,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

/** 管理员头像：设置了自定义头像就显示图片，否则显示「管」字。 */
export function ManagerAvatar({
  src,
  className = '',
  glyph = '管',
  style,
}: {
  src?: string | null;
  className?: string;
  glyph?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`manager-avatar ${className}`.trim()} style={style}>
      {src ? <img src={src} alt="管理员头像" /> : <span className="manager-avatar-glyph">{glyph}</span>}
    </span>
  );
}

export function Toast({ text, kind }: { text: string; kind?: 'ok' | 'error' | 'info' }) {
  return (
    <div className={`toast toast-${kind || 'info'}`}>
      <span className="toast-dot" />
      <span>{text}</span>
    </div>
  );
}

export function PhotoLightbox({
  photos,
  startIndex,
  onClose,
}: {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const photo = photos[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, photos.length]);

  if (!photo) return null;

  return createPortal(
    <div className="lightbox" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="lightbox-inner">
        <button className="lightbox-close" onClick={onClose} aria-label="关闭">
          <IconX size={22} />
        </button>
        {photos.length > 1 && (
          <>
            <button
              className="lightbox-nav left"
              onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
              aria-label="上一张"
            >
              <IconChevronLeft size={26} />
            </button>
            <button
              className="lightbox-nav right"
              onClick={() => setIndex((i) => (i + 1) % photos.length)}
              aria-label="下一张"
            >
              <IconChevronRight size={26} />
            </button>
          </>
        )}
        <img className="lightbox-image" src={photoUrl(photo.file)} alt={photo.caption || '照片'} />
        <div className="lightbox-caption">
          {photo.caption || '未命名照片'}
          <span className="lightbox-count">{index + 1} / {photos.length}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
