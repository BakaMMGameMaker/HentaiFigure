import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { photoUrl, SHOT_OPTIONS, sortPhotos } from '../constants';
import { IconChevronLeft, IconChevronRight, IconUpload } from '../icons';
import type { Photo, Shot } from '../types';
import { cleanError, cx } from '../utils';
import { Modal, SheetHeader, Spinner } from './ui';

export function PhotoEditor({
  itemId, photos, startIndex, defaultToFull, isAndroid, onClose, onSave,
}: {
  itemId: string;
  photos: Photo[];
  startIndex: number | null;
  defaultToFull: boolean;
  isAndroid?: boolean;
  onClose: () => void;
  onSave: (photos: Photo[]) => void;
}) {
  const editing = startIndex !== null;
  const [index, setIndex] = useState(startIndex ?? 0);
  const [added, setAdded] = useState<Photo[]>([]);
  const [edits, setEdits] = useState(new Map<string, Photo>());
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const album = editing ? sortPhotos(photos) : added;
  const original = album[index];
  const current = (original && edits.get(original.id)) ?? original;
  const changes = editing ? [...edits.values()] : added;
  const missingCaptions = changes.filter((photo) => !photo.caption?.trim()).length;
  const canSave = Boolean(current?.file && current.caption?.trim() && !missingCaptions && !loading);
  const close = () => { if (!loading) onClose(); };

  const updatePhoto = (photo: Photo) => {
    if (editing) setEdits((prev) => new Map(prev).set(original.id, photo));
    else setAdded((prev) => prev.map((entry) => entry.id === photo.id ? photo : entry));
  };

  const importPhotos = async (select: () => Promise<Photo[]>) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const imported = await select();
      if (!imported.length) return;
      if (editing && current) {
        updatePhoto({
          ...imported[0],
          shot: current.shot,
          caption: current.caption,
          createdAt: current.createdAt,
        });
      } else {
        const needsFull = defaultToFull && !added.some((photo) => photo.shot === 'full');
        setIndex(added.length);
        setAdded([...added, ...imported.map((photo, i): Photo => ({
          ...photo,
          shot: needsFull && i === 0 ? 'full' : 'promo',
        }))]);
      }
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (!files.length || loading) return;
    if (editing && files.length !== 1) {
      setError('一次只能拖入一张图片来替换原图。');
      return;
    }
    void importPhotos(async () => {
      const api = window.hf.photos;
      if (api.addFiles) return api.addFiles(files);
      const paths = files.map((file) => api.pathForFile(file)).filter(Boolean);
      if (!paths.length) throw new Error('无法读取拖入的文件，请点击选择图片。');
      const imported = await api.addPaths(itemId, paths);
      if (!imported.length) throw new Error('没有可用的图片，请选择支持的图片格式（单张最多 60MB）。');
      return imported;
    });
  };

  const move = (offset: number) => {
    if (loading || album.length < 2) return;
    setError('');
    setIndex((value) => (value + offset + album.length) % album.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  const selectLabel = editing ? '替换图片' : current ? '继续选图' : '选择图片';

  return (
    <Modal className="photo-editor-sheet" titleId="photo-editor-title" onClose={close} closeOnBackdrop={false}>
      <SheetHeader
        title={editing ? '编辑照片' : '上传照片'}
        titleId="photo-editor-title"
        onClose={close}
        actions={album.length > 1 && <span className="muted small" aria-live="polite">{index + 1} / {album.length}</span>}
      />
      <form
        className="photo-editor-form"
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          const trimCaption = (photo: Photo) => ({ ...photo, caption: photo.caption?.trim() });
          if (editing) {
            onSave(photos.map((photo) => {
              const updated = edits.get(photo.id);
              return updated ? trimCaption(updated) : photo;
            }));
          } else {
            onSave([...photos, ...added.map(trimCaption)]);
          }
        }}
      >
        <div className="sheet-body photo-editor-fields">
          <div
            className={cx('photo-dropzone', current?.file && 'has-photo', dragOver && 'drag-over')}
            onDragOver={(event) => {
              event.preventDefault();
              if (!loading) setDragOver(true);
            }}
            onDragLeave={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
            }}
            onDrop={onDrop}
          >
            <button
              type="button"
              className="photo-dropzone-picker"
              onClick={() => void importPhotos(() => window.hf.photos.add(itemId, !editing))}
              aria-disabled={loading}
              autoFocus
            >
              {current?.file && <img src={photoUrl(current.file)} alt="" draggable={false} />}
              <span className="photo-dropzone-label">
                <span>{loading ? <Spinner size={16} /> : <IconUpload size={17} />} {loading ? '正在读取图片…' : selectLabel}</span>
                {!current && !loading && !isAndroid && <small>或把图片拖到这里</small>}
              </span>
            </button>
            {album.length > 1 && (
              <>
                <button type="button" className="icon-btn photo-editor-prev" aria-label="上一张" onClick={() => move(-1)} disabled={loading}>
                  <IconChevronLeft size={22} />
                </button>
                <button type="button" className="icon-btn photo-editor-next" aria-label="下一张" onClick={() => move(1)} disabled={loading}>
                  <IconChevronRight size={22} />
                </button>
              </>
            )}
          </div>
          <label className="field">
            <span className="field-label">部位</span>
            <select
              className="select"
              value={current?.shot ?? (defaultToFull ? 'full' : 'promo')}
              disabled={!current || loading}
              onChange={(event) => updatePhoto({ ...current, shot: event.target.value as Shot })}
            >
              {SHOT_OPTIONS.filter(({ value }) => value !== 'other' || original?.shot === 'other').map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">备注</span>
            <input
              className="input"
              value={current?.caption ?? ''}
              placeholder="一句话描述你的想法，必填"
              maxLength={60}
              required
              disabled={!current || loading}
              onChange={(event) => updatePhoto({ ...current, caption: event.target.value })}
            />
          </label>
          {error && <div className="sheet-error" role="alert">{error}</div>}
        </div>
        <footer className="sheet-foot">
          <span className="muted small" aria-live="polite">
            {album.length > 1 && missingCaptions > 0 && `还有 ${missingCaptions} 张照片待填写备注`}
          </span>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={loading}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>{editing ? '保存' : '添加'}</button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
