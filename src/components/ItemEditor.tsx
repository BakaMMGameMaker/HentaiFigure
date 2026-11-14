import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Item, ItemStatus, ItemType, Photo, Shot } from '../types';
import {
  SHOT_OPTIONS, STATUS_META, TYPE_OPTIONS, formatMoney, photoUrl, shotLabel,
} from '../constants';
import { cleanError, cx, toNumberOrNull } from '../utils';
import { Modal, Spinner } from './ui';
import {
  IconAlert, IconCamera, IconCheck, IconChevronDown, IconTrash, IconUpload, IconX,
} from '../icons';

type Props = {
  item?: Item | null;
  draftId: string;
  initialStatus?: ItemStatus;
  onClose: () => void;
  onSaved: (item: Item) => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
};

type FormState = {
  name: string;
  type: ItemType;
  status: ItemStatus;
  series: string;
  scale: string;
  originalPrice: string;
  purchasePrice: string;
  deposit: string;
  balance: string;
  intro: string;
  dueDate: string;
};

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cx('field', wide && 'field-wide')}>
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function ItemEditor({ item, draftId, initialStatus, onClose, onSaved, toast }: Props) {
  const isNew = !item;
  const [form, setForm] = useState<FormState>({
    name: item?.name || '',
    type: item?.type || 'figure',
    status: item?.status || initialStatus || 'owned',
    series: item?.series || '',
    scale: item?.scale || '',
    originalPrice: item?.originalPrice == null ? '' : String(item.originalPrice),
    purchasePrice: item?.purchasePrice == null ? '' : String(item.purchasePrice),
    deposit: item?.deposit == null ? '' : String(item.deposit),
    balance: item?.balance == null ? '' : String(item.balance),
    intro: item?.intro || '',
    dueDate: item?.dueDate || '',
  });
  const [photos, setPhotos] = useState<Photo[]>(item?.photos || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const hasFull = photos.some((p) => p.shot === 'full');
  const needsFull = form.status === 'owned' && form.type === 'figure' && !hasFull;
  const tailPreview = (() => {
    const purchase = Number(form.purchasePrice);
    const deposit = Number(form.deposit);
    if (!Number.isFinite(purchase) || !Number.isFinite(deposit) || form.purchasePrice === '' || form.deposit === '') return null;
    return Math.max(0, purchase - deposit);
  })();

  const groupPhotos = (added: Photo[]) => {
    if (!added.length) return added;
    if (form.status === 'owned' && form.type === 'figure' && !hasFull) {
      return added.map((p, index) => (index === 0 ? { ...p, shot: 'full' as Shot } : p));
    }
    return added;
  };

  const addViaDialog = async () => {
    if (uploading) return;
    setUploading(true);
    setError('');
    try {
      const added = await window.hf.photos.add(draftId);
      if (added.length) setPhotos((prev) => [...prev, ...groupPhotos(added)]);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    const paths = files.map((file) => window.hf.photos.pathForFile(file)).filter(Boolean);
    if (!paths.length) {
      setError('拖进来的文件读不到路径，换用「上传照片」试试。');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const added = await window.hf.photos.addPaths(draftId, paths);
      if (added.length) setPhotos((prev) => [...prev, ...groupPhotos(added)]);
      else toast('这些文件不是支持的图片格式', 'error');
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setUploading(false);
    }
  };

  const updatePhoto = (id: string, patch: Partial<Photo>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePhoto = async (photo: Photo) => {
    if (photos.length <= 1) {
      setError('至少要保留一张照片。');
      return;
    }
    if (form.status === 'owned' && photo.shot === 'full' && photos.filter((p) => p.shot === 'full').length <= 1) {
      setError('已拥有的周边至少要保留一张全身照。');
      return;
    }
    try {
      await window.hf.photos.remove(draftId, photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const submit = async () => {
    setError('');
    if (!form.name.trim()) {
      setError('先给她起个名字吧，比如「初音未来 睡莲 ver. 1/7」。');
      return;
    }
    if (!photos.length) {
      setError('至少要上传一张照片。');
      return;
    }
    if (form.status === 'owned' && form.type === 'figure' && !hasFull) {
      setError('已拥有的手办至少要有一张全身照：在上传的照片里把一张标成「全身照」。');
      return;
    }
    if (form.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) {
      setError('补款日期格式不对。');
      return;
    }
    setBusy(true);
    try {
      const saved = await window.hf.items.save({
        id: draftId,
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        series: form.series.trim(),
        scale: form.scale.trim(),
        originalPrice: toNumberOrNull(form.originalPrice),
        purchasePrice: toNumberOrNull(form.purchasePrice),
        deposit: toNumberOrNull(form.deposit),
        balance: toNumberOrNull(form.balance),
        intro: form.intro.trim(),
        dueDate: form.dueDate,
        photos,
      });
      toast(isNew ? '她住进收藏室了。' : '已经重新记好了。', 'ok');
      onSaved(saved);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal className="modal-editor" onClose={onClose} closeOnBackdrop={false}>
      <div className="editor">
        <header className="editor-head">
          <div>
            <div className="eyebrow">{isNew ? 'NEW FIGURE' : 'EDIT FIGURE'}</div>
            <h2>{isNew ? '把新的她带进来' : '重新记一记她'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <IconX size={20} />
          </button>
        </header>

        <div className="editor-body">
          <section className="editor-main">
            <div className="form-block">
              <div className="block-title">现在的状态</div>
              <div className="status-grid">
                {(Object.keys(STATUS_META) as ItemStatus[]).map((status) => {
                  const meta = STATUS_META[status];
                  return (
                    <button
                      key={status}
                      type="button"
                      className={cx('status-card', form.status === status && 'active', `status-${status}`)}
                      onClick={() => set('status', status)}
                    >
                      <span className="status-glyph">{meta.glyph}</span>
                      <span className="status-text">
                        <strong>{meta.label}</strong>
                        <small>{meta.desc}</small>
                      </span>
                      {form.status === status && <span className="status-check"><IconCheck size={14} /></span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-block">
              <div className="block-title">她是谁</div>
              <Field label="名称" hint="必填">
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="初音未来 睡莲 ver. 1/7 手办"
                  maxLength={120}
                  autoFocus
                />
              </Field>
              <div className="type-chips">
                {TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cx('type-chip', form.type === option.value && 'active')}
                    onClick={() => set('type', option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="field-row">
                <Field label="作品 / 角色">
                  <input className="input" value={form.series} onChange={(e) => set('series', e.target.value)} placeholder="VOCALOID / 初音未来" />
                </Field>
                <Field label="规格">
                  <input className="input" value={form.scale} onChange={(e) => set('scale', e.target.value)} placeholder="1/7、约 240mm" />
                </Field>
              </div>
            </div>

            <div className="form-block">
              <div className="block-title">价格</div>
              <div className="price-grid">
                <Field label="原始价格">
                  <div className="input-affix">
                    <span>¥</span>
                    <input type="number" min="0" step="0.01" value={form.originalPrice} onChange={(e) => set('originalPrice', e.target.value)} placeholder="0" />
                  </div>
                </Field>
                <Field label="购入价格">
                  <div className="input-affix">
                    <span>¥</span>
                    <input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} placeholder="0" />
                  </div>
                </Field>
                <Field label="定金" hint={form.status === 'pending' ? '已付' : undefined}>
                  <div className="input-affix">
                    <span>¥</span>
                    <input type="number" min="0" step="0.01" value={form.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="0" />
                  </div>
                </Field>
                <Field label="尾款">
                  <div className="input-affix">
                    <span>¥</span>
                    <input type="number" min="0" step="0.01" value={form.balance} onChange={(e) => set('balance', e.target.value)} placeholder="0" />
                  </div>
                </Field>
              </div>
              <div className="price-hint">
                {tailPreview !== null ? (
                  <>
                    按「购入价 − 定金」算，尾款参考 <b>{formatMoney(tailPreview)}</b>
                    <button type="button" className="text-button" onClick={() => set('balance', String(tailPreview))}>
                      填入
                    </button>
                  </>
                ) : (
                  '定金和购入价填上后，会自动帮你算尾款参考。'
                )}
              </div>
              {form.status === 'pending' && (
                <Field label="补款日期" hint="待补款">
                  <input type="date" className="input input-date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
                </Field>
              )}
            </div>

            <div className="form-block">
              <div className="block-title">最初的想法</div>
              <Field label="简介" hint="DeepSeek 会从这里找话题">
                <textarea
                  className="input textarea"
                  rows={5}
                  value={form.intro}
                  onChange={(e) => set('intro', e.target.value)}
                  placeholder="第一眼看到她时，你在想什么？哪里的细节让你心动？写下来，之后她会拿这些话来撩你。"
                  maxLength={8000}
                />
              </Field>
            </div>
          </section>

          <aside className="editor-photos">
            <div className="photos-head">
              <div>
                <div className="block-title">照片</div>
                <p className="muted small">
                  {form.status === 'owned' && form.type === 'figure'
                    ? '全身照至少一张，其余部位可选。她会真的看图说话。'
                    : '宣传图、实物图都可以。她之后会照着这些图撩你。'}
                </p>
              </div>
              <span className={cx('photo-count', needsFull && 'warn')}>{photos.length} 张</span>
            </div>

            {needsFull && (
              <div className="inline-alert">
                <IconAlert size={16} />
                已拥有的手办还差一张「全身照」。在下面的照片上选一下标签就行。
              </div>
            )}

            <div
              ref={dropRef}
              className={cx('dropzone', dragOver && 'drag-over', uploading && 'is-uploading')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={addViaDialog}
            >
              {uploading ? <Spinner /> : <IconUpload size={22} />}
              <div>
                <strong>{uploading ? '正在收下照片…' : '上传照片'}</strong>
                <span>点击选择，或把图片拖进来</span>
              </div>
              <IconCamera size={18} className="dropzone-camera" />
            </div>

            <div className="photo-list">
              {photos.map((photo, index) => (
                <div className="photo-card" key={photo.id}>
                  <div className="photo-thumb-wrap">
                    <img src={photoUrl(photo.thumbFile, true, photo.file)} alt={photo.caption || shotLabel(photo.shot)} loading="lazy" />
                    <span className="photo-index">{String(index + 1).padStart(2, '0')}</span>
                    {photo.shot === 'full' && <span className="photo-full-badge">全身</span>}
                    <button
                      type="button"
                      className="photo-delete"
                      onClick={() => removePhoto(photo)}
                      title="删除这张"
                      aria-label="删除这张"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                  <div className="photo-meta">
                    <div className="photo-select-wrap">
                      <select
                        value={photo.shot}
                        onChange={(e) => updatePhoto(photo.id, { shot: e.target.value as Shot })}
                        className="photo-select"
                      >
                        <optgroup label="基础">
                          {SHOT_OPTIONS.filter((o) => o.group === 'basic').map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="身体细节（已拥有）">
                          {SHOT_OPTIONS.filter((o) => o.group === 'part').map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </optgroup>
                      </select>
                      <IconChevronDown size={13} />
                    </div>
                    <input
                      className="photo-caption"
                      value={photo.caption || ''}
                      onChange={(e) => updatePhoto(photo.id, { caption: e.target.value })}
                      placeholder="备注，比如「开箱实拍」"
                      maxLength={60}
                    />
                  </div>
                </div>
              ))}
            </div>

            {photos.length === 0 && (
              <div className="photo-empty">
                <IconCamera size={26} />
                <span>还没有照片。她需要至少一张，才能被看见。</span>
              </div>
            )}
          </aside>
        </div>

        <footer className="editor-foot">
          <div className="editor-error">{error}</div>
          <div className="editor-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy || uploading}>
              {busy ? <Spinner size={15} /> : <IconCheck size={16} />}
              {isNew ? '收进收藏室' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

