import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { photoUrl } from '../constants';
import type { Photo } from '../types';
import { IconAlert, IconChevronLeft, IconChevronRight, IconX } from '../icons';
import { cx } from '../utils';

/* ------------------------------------------------------------------ */
/* Responsive helper                                                   */
/* ------------------------------------------------------------------ */

const NARROW_QUERY = '(max-width: 760px)';

function subscribeNarrow(callback: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

/** true on phones / very narrow windows. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => false);
}

/* ------------------------------------------------------------------ */
/* Modal / sheet                                                       */
/* ------------------------------------------------------------------ */

const modalStack: number[] = [];
let modalSeq = 0;

export function Modal({
  children,
  onClose,
  className = '',
  size = 'md',
  closeOnBackdrop = true,
  titleId,
  inert,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  titleId?: string;
  inert?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    modalSeq += 1;
    const id = modalSeq;
    modalStack.push(id);
    const onKey = (event: KeyboardEvent) => {
      // Only the top-most modal reacts to Escape.
      if (event.key === 'Escape' && modalStack[modalStack.length - 1] === id) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const at = modalStack.indexOf(id);
      if (at >= 0) modalStack.splice(at, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div
      className="overlay"
      onPointerDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={cx('sheet', `sheet-${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={titleId} inert={inert}>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** Standard sheet header: title block + close button. */
export function SheetHeader({
  eyebrow,
  title,
  titleId,
  onClose,
  onBack,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
  onClose?: () => void;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="sheet-head">
      {onBack && (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
          <IconChevronLeft size={20} />
        </button>
      )}
      <div className="sheet-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 id={titleId}>{title}</h2>
      </div>
      {actions}
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          <IconX size={19} />
        </button>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* In-app confirm dialog (replaces window.confirm).                    */
/* Native confirm() steals keyboard focus from the Electron renderer   */
/* on Windows until the window is re-activated, so never use it.       */
/* ------------------------------------------------------------------ */

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

let confirmQueue: ConfirmRequest[] = [];
const confirmListeners = new Set<() => void>();
let confirmSeq = 0;

function emitConfirm() {
  for (const listener of confirmListeners) listener();
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmSeq += 1;
    confirmQueue = [...confirmQueue, { ...options, id: confirmSeq, resolve }];
    emitConfirm();
  });
}

export function ConfirmHost() {
  const queue = useSyncExternalStore(
    (cb) => { confirmListeners.add(cb); return () => { confirmListeners.delete(cb); }; },
    () => confirmQueue,
    () => confirmQueue,
  );
  const current = queue[0];
  if (!current) return null;

  const settle = (ok: boolean) => {
    current.resolve(ok);
    confirmQueue = confirmQueue.filter((item) => item.id !== current.id);
    emitConfirm();
  };

  return (
    <Modal size="sm" onClose={() => settle(false)} className="confirm-sheet" titleId="confirm-dialog-title">
      <div className="confirm">
        <div className={cx('confirm-icon', current.danger && 'danger')}>
          <IconAlert size={22} />
        </div>
        <h3 id="confirm-dialog-title">{current.title}</h3>
        {current.message && <div className="confirm-message">{current.message}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={() => settle(false)}>
            {current.cancelText || '取消'}
          </button>
          <button
            type="button"
            className={cx('btn', current.danger ? 'btn-danger' : 'btn-primary')}
            onClick={() => settle(true)}
            autoFocus
          >
            {current.confirmText || '确定'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Small atoms                                                         */
/* ------------------------------------------------------------------ */

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
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Switch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={cx('switch', on && 'on')}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span />
    </button>
  );
}

/** A settings-style row: title + description on the left, control on the right. */
export function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <strong>{title}</strong>
        {desc && <small>{desc}</small>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  );
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
    <span className={`avatar ${className}`.trim()} style={style}>
      {src ? <img src={src} alt="管理员头像" /> : <span className="avatar-glyph">{glyph}</span>}
    </span>
  );
}

export function Toast({ text, kind }: { text: string; kind?: 'ok' | 'error' | 'info' }) {
  return (
    <div className={`toast toast-${kind || 'info'}`} role="status">
      <span className="toast-dot" />
      <span>{text}</span>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="typing"><span /><span /><span /></div>
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
  const images = photos.map((photo) => ({ src: photoUrl(photo.file), caption: photo.caption }));
  return <ImageLightbox images={images} startIndex={startIndex} onClose={onClose} />;
}

export function ImageLightbox({ images, startIndex, onClose }: {
  images: { src: string; caption?: string }[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const image = images[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + images.length) % images.length);
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % images.length);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, images.length]);

  if (!image) return null;

  return createPortal(
    <div className="lightbox" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="关闭">
        <IconX size={22} />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav left"
            onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
            aria-label="上一张"
          >
            <IconChevronLeft size={24} />
          </button>
          <button
            type="button"
            className="lightbox-nav right"
            onClick={() => setIndex((i) => (i + 1) % images.length)}
            aria-label="下一张"
          >
            <IconChevronRight size={24} />
          </button>
        </>
      )}
      <img className="lightbox-image" src={image.src} alt={image.caption || '照片'} />
      <div className="lightbox-caption">
        <span>{image.caption || '未命名照片'}</span>
        <span className="lightbox-count">{index + 1} / {images.length}</span>
      </div>
    </div>,
    document.body
  );
}
