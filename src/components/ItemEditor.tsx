import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Character, Item, ItemChange, ItemStatus, ItemType, Photo, Shot } from '../types';
import {
  SHOT_OPTIONS, STATUS_META, TYPE_OPTIONS, formatMoney, photoUrl, shotLabel,
} from '../constants';
import { cleanError, cx, describeItemChanges, toNumberOrNull } from '../utils';
import { Modal, SheetHeader, Spinner } from './ui';
import {
  IconAlert, IconCamera, IconCheck, IconChevronDown, IconPlus, IconSearch, IconTrash, IconUpload, IconX,
} from '../icons';

type Props = {
  item?: Item | null;
  draftId: string;
  initialStatus?: ItemStatus;
  characters: Character[];
  items: Item[];
  isAndroid?: boolean;
  onCharactersChanged: (characters: Character[]) => void;
  onClose: () => void;
  onSaved: (item: Item, meta: { mode: 'create' | 'update'; changes: ItemChange[] }) => void;
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void;
};

type FormState = {
  name: string;
  type: ItemType;
  status: ItemStatus;
  characterId: string;
  scale: string;
  originalPrice: string;
  purchasePrice: string;
  deposit: string;
  balance: string;
  detail: string;
  thought: string;
  dueDate: string;
};

type CharacterForm = {
  id: string;
  name: string;
  source: string;
  description: string;
};

const EMPTY_CHARACTER_FORM: CharacterForm = { id: '', name: '', source: '', description: '' };

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cx('field', wide && 'field-wide')}>
      <span className="field-label">
        <span>{label}</span>
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function ItemEditor({
  item,
  draftId,
  initialStatus,
  characters,
  items,
  isAndroid,
  onCharactersChanged,
  onClose,
  onSaved,
  toast,
}: Props) {
  const isNew = !item;
  const [form, setForm] = useState<FormState>({
    name: item?.name || '',
    type: item?.type || 'figure',
    status: item?.status || initialStatus || 'owned',
    characterId: item?.characterId || '',
    scale: item?.scale || '',
    originalPrice: item?.originalPrice == null ? '' : String(item.originalPrice),
    purchasePrice: item?.purchasePrice == null ? '' : String(item.purchasePrice),
    deposit: item?.deposit == null ? '' : String(item.deposit),
    balance: item?.balance == null ? '' : String(item.balance),
    detail: item?.detail || '',
    thought: item?.thought || item?.intro || '',
    dueDate: item?.dueDate || '',
  });
  const [photos, setPhotos] = useState<Photo[]>(item?.photos || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localCharacters, setLocalCharacters] = useState<Character[]>(characters || []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [characterForm, setCharacterForm] = useState<CharacterForm | null>(null);
  const [characterBusy, setCharacterBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocalCharacters(characters || []); }, [characters]);
  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const selectedCharacter = localCharacters.find((c) => c.id === form.characterId) || null;
  const hasFull = photos.some((p) => p.shot === 'full');
  const needsFull = form.status === 'owned' && form.type === 'figure' && !hasFull;
  const tailPreview = (() => {
    const purchase = Number(form.purchasePrice);
    const deposit = Number(form.deposit);
    if (!Number.isFinite(purchase) || !Number.isFinite(deposit) || form.purchasePrice === '' || form.deposit === '') return null;
    return Math.max(0, purchase - deposit);
  })();

  const filteredCharacters = localCharacters.filter((character) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${character.name} ${character.source || ''}`.toLowerCase().includes(q);
  });

  const countFor = (characterId: string) => items.filter((i) => i.characterId === characterId && i.id !== item?.id).length;

  const selectCharacter = (characterId: string) => {
    set('characterId', characterId);
    setPickerOpen(false);
    setQuery('');
  };

  const openCharacterForm = (character?: Character) => {
    setCharacterForm(character
      ? { id: character.id, name: character.name, source: character.source || '', description: character.description || '' }
      : { ...EMPTY_CHARACTER_FORM });
    setPickerOpen(false);
  };

  const submitCharacter = async () => {
    if (!characterForm) return;
    if (!characterForm.name.trim()) {
      setError('角色名不能为空。');
      return;
    }
    setCharacterBusy(true);
    setError('');
    try {
      const saved = await window.hf.characters.save({
        id: characterForm.id || undefined,
        name: characterForm.name.trim(),
        source: characterForm.source.trim(),
        description: characterForm.description.trim(),
      });
      const next = characterForm.id
        ? localCharacters.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...localCharacters];
      setLocalCharacters(next);
      onCharactersChanged(next);
      set('characterId', saved.id);
      setCharacterForm(null);
      toast(characterForm.id ? '角色档案已更新。' : '角色档案已建立。', 'ok');
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setCharacterBusy(false);
    }
  };

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
    if (form.status === 'owned' && form.type === 'figure' && photo.shot === 'full' && photos.filter((p) => p.shot === 'full').length <= 1) {
      setError('已拥有的手办至少要保留一张全身照。');
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
        characterId: form.characterId,
        scale: form.scale.trim(),
        originalPrice: toNumberOrNull(form.originalPrice),
        purchasePrice: toNumberOrNull(form.purchasePrice),
        deposit: toNumberOrNull(form.deposit),
        balance: toNumberOrNull(form.balance),
        detail: form.detail.trim(),
        thought: form.thought.trim(),
        dueDate: form.dueDate,
        photos,
      });
      const changes = describeItemChanges(item || null, saved, localCharacters);
      toast(isNew ? '她住进收藏室了。' : '已经重新记好了。', 'ok');
      onSaved(saved, { mode: isNew ? 'create' : 'update', changes });
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal size="xl" onClose={onClose} closeOnBackdrop={false} className="editor-sheet">
      <SheetHeader
        eyebrow={isNew ? 'NEW FIGURE' : 'EDIT FIGURE'}
        title={isNew ? '把新的她带进来' : '重新记一记她'}
        onClose={onClose}
      />

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
                    className={cx('status-card', form.status === status && 'active', `tone-${status}`)}
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
            <div className="chip-row">
              {TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cx('chip-btn', form.type === option.value && 'active')}
                  onClick={() => set('type', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="field-row">
              <Field label="角色" hint="关联角色档案">
                <div className="char-picker">
                  <button
                    type="button"
                    className={cx('char-trigger', pickerOpen && 'open')}
                    onClick={() => { setPickerOpen((v) => !v); setCharacterForm(null); }}
                  >
                    {selectedCharacter ? (
                      <span className="char-trigger-val">
                        <span className="char-badge">{selectedCharacter.name.slice(0, 1)}</span>
                        <span className="char-trigger-text">
                          <strong>{selectedCharacter.name}</strong>
                          <small>{selectedCharacter.source || '未填作品'}</small>
                        </span>
                      </span>
                    ) : (
                      <span className="char-trigger-empty">选择角色，或新增一个</span>
                    )}
                    <IconChevronDown size={14} className="char-trigger-arrow" />
                  </button>

                  {pickerOpen && (
                    <div className="char-menu">
                      <div className="char-search">
                        <IconSearch size={13} />
                        <input
                          ref={searchRef}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="搜索角色或作品"
                        />
                      </div>
                      <div className="char-options">
                        {filteredCharacters.map((character) => {
                          const count = countFor(character.id);
                          return (
                            <button
                              key={character.id}
                              type="button"
                              className={cx('char-option', form.characterId === character.id && 'active')}
                              onClick={() => selectCharacter(character.id)}
                            >
                              <span className="char-badge">{character.name.slice(0, 1)}</span>
                              <span className="char-option-text">
                                <strong>{character.name}</strong>
                                <small>
                                  {character.source || '未填作品'}
                                  {count > 0 ? ` · 已有 ${count} 款周边` : ''}
                                </small>
                              </span>
                              {form.characterId === character.id && <IconCheck size={13} />}
                            </button>
                          );
                        })}
                        {!filteredCharacters.length && (
                          <div className="char-empty">没有匹配的角色。</div>
                        )}
                      </div>
                      <button type="button" className="char-add" onClick={() => openCharacterForm()}>
                        <IconPlus size={13} /> 新增角色
                      </button>
                    </div>
                  )}
                </div>
              </Field>
              <Field label="规格">
                <input className="input" value={form.scale} onChange={(e) => set('scale', e.target.value)} placeholder="1/7、约 240mm" />
              </Field>
            </div>

            {selectedCharacter && !characterForm && (
              <div className="callout">
                <div className="char-row">
                  <span className="char-badge lg">{selectedCharacter.name.slice(0, 1)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{selectedCharacter.name}</strong>
                    <small>{selectedCharacter.source ? `出自《${selectedCharacter.source}》` : '还没填作品名'}</small>
                  </div>
                  <button type="button" className="link" onClick={() => openCharacterForm(selectedCharacter)}>
                    编辑角色
                  </button>
                </div>
                <p className={cx('char-desc', !selectedCharacter.description && 'muted')}>
                  {selectedCharacter.description || '还没有角色背景。写几句这个角色的设定，管理员对她的印象会更清楚。'}
                </p>
              </div>
            )}

            {characterForm && (
              <div className="char-form">
                <div className="char-form-head">
                  <strong>{characterForm.id ? '编辑角色档案' : '新增角色档案'}</strong>
                  <button type="button" className="icon-btn sm" onClick={() => setCharacterForm(null)} aria-label="收起">
                    <IconX size={14} />
                  </button>
                </div>
                <Field label="角色名" hint="必填">
                  <input
                    className="input"
                    value={characterForm.name}
                    onChange={(e) => setCharacterForm({ ...characterForm, name: e.target.value })}
                    placeholder="初音未来"
                    maxLength={80}
                  />
                </Field>
                <Field label="出自作品">
                  <input
                    className="input"
                    value={characterForm.source}
                    onChange={(e) => setCharacterForm({ ...characterForm, source: e.target.value })}
                    placeholder="VOCALOID、原神、赛马娘…"
                    maxLength={120}
                  />
                </Field>
                <Field label="角色背景" hint="管理员会读">
                  <textarea
                    className="input textarea"
                    rows={3}
                    value={characterForm.description}
                    onChange={(e) => setCharacterForm({ ...characterForm, description: e.target.value })}
                    placeholder="她是谁、什么设定、你为什么喜欢她。这段背景会让管理员更懂这款周边。"
                    maxLength={4000}
                  />
                </Field>
                <div className="char-form-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCharacterForm(null)} disabled={characterBusy}>
                    取消
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void submitCharacter()} disabled={characterBusy}>
                    {characterBusy ? <Spinner size={13} /> : <IconCheck size={14} />}
                    保存角色
                  </button>
                </div>
              </div>
            )}
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
                  <button type="button" className="link" onClick={() => set('balance', String(tailPreview))}>填入</button>
                </>
              ) : (
                '定金和购入价填上后，会自动帮你算尾款参考。'
              )}
            </div>
            {form.status === 'pending' && (
              <Field label="补款日期" hint="待补款">
                <input type="date" className="input" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
              </Field>
            )}
          </div>

          <div className="form-block">
            <div className="block-title">这款周边是什么</div>
            <Field label="商品详情" hint="管理员会从这里了解它">
              <textarea
                className="input textarea"
                rows={4}
                value={form.detail}
                onChange={(e) => set('detail', e.target.value)}
                placeholder="商品情报或基本介绍：哪家厂、哪个系列、尺寸材质、什么时间发售、有什么特别设计。让管理员知道这款周边究竟是什么。"
                maxLength={8000}
              />
            </Field>
          </div>

          <div className="form-block">
            <div className="block-title">最初的想法</div>
            <Field label="你的心路历程" hint="管理员会从这里找话题">
              <textarea
                className="input textarea"
                rows={4}
                value={form.thought}
                onChange={(e) => set('thought', e.target.value)}
                placeholder="第一眼看到她时你在想什么？哪里的细节让你心动、为什么非要买下或加进购物车？写下来，之后管理员会拿这些话来撩你。"
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
                  ? '全身照至少一张，其余部位可选。管理员会真的看图说话。'
                  : '宣传图、实物图都可以。她之后会照着这些图撩你。'}
              </p>
            </div>
            <span className={cx('pill', needsFull && 'pill-warn')}>{photos.length} 张</span>
          </div>

          {needsFull && (
            <div className="inline-alert">
              <IconAlert size={15} />
              已拥有的手办还差一张「全身照」。在下面的照片上选一下标签就行。
            </div>
          )}

          <button
            type="button"
            className={cx('dropzone', dragOver && 'drag-over', uploading && 'is-uploading')}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e as unknown as DragEvent<HTMLDivElement>)}
            onClick={() => void addViaDialog()}
          >
            {uploading ? <Spinner /> : <IconUpload size={20} />}
            <span>
              <strong>{uploading ? '正在收下照片…' : '上传照片'}</strong>
              <small>{isAndroid ? '点击从相册选择照片' : '点击选择，或把图片拖进来'}</small>
            </span>
            <IconCamera size={18} className="dropzone-cam" />
          </button>

          <div className="photo-list">
            {photos.map((photo, index) => (
              <div className="photo-card" key={photo.id}>
                <div className="photo-thumb">
                  <img src={photoUrl(photo.thumbFile, true, photo.file)} alt={photo.caption || shotLabel(photo.shot)} loading="lazy" />
                  <span className="photo-index">{String(index + 1).padStart(2, '0')}</span>
                  {photo.shot === 'full' && <span className="photo-full">全身</span>}
                  <button
                    type="button"
                    className="photo-del"
                    onClick={() => void removePhoto(photo)}
                    title="删除这张"
                    aria-label="删除这张"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
                <div className="photo-meta">
                  <select
                    value={photo.shot}
                    onChange={(e) => updatePhoto(photo.id, { shot: e.target.value as Shot })}
                    className="select select-sm"
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
                  <input
                    className="input input-sm"
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
              <IconCamera size={24} />
              <span>还没有照片。她需要至少一张，才能被看见。</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="sheet-foot">
        <div className="sheet-error">{error}</div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || uploading}>
            {busy ? <Spinner size={15} /> : <IconCheck size={16} />}
            {isNew ? '收进收藏室' : '保存'}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
