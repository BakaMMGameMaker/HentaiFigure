import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Character, Item, ItemChange, ItemStatus, ItemType, Photo } from '../types';
import {
  STATUS_META, TYPE_OPTIONS, formatMoney, photoUrl, shotLabel, sortPhotos,
} from '../constants';
import { cleanError, cx, describeItemChanges, toNumberOrNull } from '../utils';
import { Modal, SheetHeader, Spinner, confirmDialog } from './ui';
import { PhotoEditor } from './PhotoEditor';
import {
  IconCamera, IconCheck, IconChevronDown, IconChevronUp, IconPlus, IconSearch, IconTrash, IconUpload,
} from '../icons';

type SaveAction = 'save' | 'notify' | 'reintroduce';
export type ItemIntro = { mode: 'create' | 'update'; changes: ItemChange[] };

type Props = {
  item?: Item | null;
  draftId: string;
  initialStatus?: ItemStatus;
  characters: Character[];
  items: Item[];
  isAndroid?: boolean;
  onCharactersChanged: (characters: Character[]) => void;
  onClose: () => void;
  onSaved: (item: Item, intro?: ItemIntro) => void;
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
  const [saving, setSaving] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [photoDialog, setPhotoDialog] = useState<{ startIndex: number | null } | null>(null);
  const [error, setError] = useState('');
  const [confirmingPhoto, setConfirmingPhoto] = useState(false);
  const [localCharacters, setLocalCharacters] = useState<Character[]>(characters || []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [characterForm, setCharacterForm] = useState<CharacterForm | null>(null);
  const [characterBusy, setCharacterBusy] = useState(false);
  const [characterError, setCharacterError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const characterTriggerRef = useRef<HTMLButtonElement>(null);
  const characterReturnFocus = useRef<HTMLButtonElement>(null);
  const photoReturnFocus = useRef<HTMLButtonElement>(null);
  const photoUploadRef = useRef<HTMLButtonElement>(null);
  const saveGroupRef = useRef<HTMLDivElement>(null);
  const saveToggleRef = useRef<HTMLButtonElement>(null);
  const characterDialogOpen = characterForm !== null;
  const photoDialogOpen = photoDialog !== null;
  const busy = saving || characterBusy || confirmingPhoto;
  const close = () => { if (!busy) onClose(); };

  useEffect(() => { setLocalCharacters(characters || []); }, [characters]);
  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);
  useEffect(() => {
    if (!characterDialogOpen) {
      characterReturnFocus.current?.focus({ preventScroll: true });
      characterReturnFocus.current = null;
    }
  }, [characterDialogOpen]);
  useEffect(() => {
    if (!photoDialogOpen && photoReturnFocus.current) {
      const opener = photoReturnFocus.current;
      (opener.isConnected ? opener : photoUploadRef.current)?.focus({ preventScroll: true });
      photoReturnFocus.current = null;
    }
  }, [photoDialogOpen]);
  useEffect(() => {
    if (!saveMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !saveGroupRef.current?.contains(event.target)) {
        setSaveMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [saveMenuOpen]);

  const closeSaveMenu = () => {
    setSaveMenuOpen(false);
    saveToggleRef.current?.focus({ preventScroll: true });
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const selectedCharacter = localCharacters.find((c) => c.id === form.characterId) || null;
  const sortedPhotos = sortPhotos(photos);
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

  const openCharacterForm = (character?: Character, opener = characterTriggerRef.current) => {
    if (busy) return;
    characterReturnFocus.current = opener;
    setCharacterError('');
    setCharacterForm(character
      ? { id: character.id, name: character.name, source: character.source || '', description: character.description || '' }
      : { ...EMPTY_CHARACTER_FORM });
    setPickerOpen(false);
  };

  const closeCharacterForm = () => {
    if (characterBusy) return;
    setCharacterForm(null);
  };

  const submitCharacter = async () => {
    if (!characterForm || characterBusy) return;
    if (!characterForm.name.trim()) {
      setCharacterError('角色名不能为空。');
      return;
    }
    setCharacterBusy(true);
    setCharacterError('');
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
      selectCharacter(saved.id);
      setCharacterForm(null);
      toast(characterForm.id ? '角色档案已更新。' : '角色档案已建立。', 'ok');
    } catch (err) {
      setCharacterError(cleanError(err));
    } finally {
      setCharacterBusy(false);
    }
  };

  const openPhotoDialog = (opener: HTMLButtonElement, startIndex: number | null) => {
    if (busy) return;
    setError('');
    photoReturnFocus.current = opener;
    setPhotoDialog({ startIndex });
  };

  const removePhoto = async (photo: Photo) => {
    if (busy) return;
    if (photos.length <= 1) {
      setError('至少要保留一张照片。');
      return;
    }
    if (form.status === 'owned' && form.type === 'figure' && photo.shot === 'full' && photos.filter((p) => p.shot === 'full').length <= 1) {
      setError('已拥有的手办至少要保留一张全身照。');
      return;
    }
    setConfirmingPhoto(true);
    const confirmed = await confirmDialog({
      title: '删除这张照片？',
      message: '保存周边后会删除这张照片。',
      confirmText: '删除照片',
      danger: true,
    });
    setConfirmingPhoto(false);
    if (confirmed) {
      setError('');
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    }
  };

  const submit = async (action: SaveAction) => {
    if (busy) return;
    if (saveMenuOpen) closeSaveMenu();
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
    setSaving(true);
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
      const mode = isNew || action === 'reintroduce' ? 'create' : 'update';
      const changes = action === 'notify' && mode === 'update'
        ? describeItemChanges(item || null, saved, localCharacters)
        : [];
      toast(isNew ? '她住进收藏室了。' : '已经重新记好了。', 'ok');
      onSaved(saved, action === 'save' ? undefined : { mode, changes });
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="xl"
      onClose={saveMenuOpen ? closeSaveMenu : close}
      closeOnBackdrop={false}
      className="editor-sheet"
      titleId="item-editor-title"
      inert={characterDialogOpen || photoDialogOpen}
    >
      <SheetHeader
        eyebrow={isNew ? 'NEW FIGURE' : 'EDIT FIGURE'}
        title={isNew ? '把新的她带进来' : '重新记一记她'}
        titleId="item-editor-title"
        onClose={close}
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
              <div className="field">
                <span className="field-label">
                  <span id="item-character-label">角色</span>
                  <em>关联角色档案</em>
                </span>
                <div className="char-picker">
                  <button
                    ref={characterTriggerRef}
                    type="button"
                    className={cx('char-trigger', pickerOpen && 'open')}
                    aria-labelledby="item-character-label item-character-value"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((v) => !v)}
                  >
                    {selectedCharacter ? (
                      <span className="char-trigger-val" id="item-character-value">
                        <span className="char-badge" aria-hidden="true">{selectedCharacter.name.slice(0, 1)}</span>
                        <span className="char-trigger-text">
                          <strong>{selectedCharacter.name}</strong>
                          <small>{selectedCharacter.source || '未填作品'}</small>
                        </span>
                      </span>
                    ) : (
                      <span className="char-trigger-empty" id="item-character-value">选择角色，或新增一个</span>
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
                          aria-label="搜索角色或作品"
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
                      <button type="button" className="char-add" aria-haspopup="dialog" onClick={() => openCharacterForm()} disabled={busy}>
                        <IconPlus size={13} /> 新增角色
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Field label="规格">
                <input className="input" value={form.scale} onChange={(e) => set('scale', e.target.value)} placeholder="1/7、约 240mm" />
              </Field>
            </div>

            {selectedCharacter && (
              <div className="callout">
                <div className="char-row">
                  <span className="char-badge lg">{selectedCharacter.name.slice(0, 1)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{selectedCharacter.name}</strong>
                    <small>{selectedCharacter.source ? `出自《${selectedCharacter.source}》` : '还没填作品名'}</small>
                  </div>
                  <button
                    type="button"
                    className="link"
                    aria-haspopup="dialog"
                    onClick={(event) => openCharacterForm(selectedCharacter, event.currentTarget)}
                    disabled={busy}
                  >
                    编辑角色
                  </button>
                </div>
                <p className={cx('char-desc', !selectedCharacter.description && 'muted')}>
                  {selectedCharacter.description || '还没有角色背景。写几句这个角色的设定，管理员对她的印象会更清楚。'}
                </p>
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
          <div className="photos-toolbar">
            <div className="photos-head">
              <div>
                <div className="block-title">照片</div>
                <p className="muted small">
                  {form.status === 'owned' && form.type === 'figure'
                    ? '至少保留一张全身照。'
                    : '至少保留一张照片。'}
                </p>
              </div>
              <span className={cx('pill', needsFull && 'pill-warn')}>{photos.length} 张</span>
            </div>

            <button
              type="button"
              className="btn btn-soft photo-upload"
              ref={photoUploadRef}
              aria-haspopup="dialog"
              onClick={(event) => openPhotoDialog(event.currentTarget, null)}
              disabled={busy}
            >
              <IconUpload size={16} /> 上传照片
            </button>
          </div>

          <div className="photo-list">
            {sortedPhotos.map((photo, index) => (
              <div className="photo-thumb" key={photo.id}>
                <button
                  type="button"
                  className="photo-preview"
                  disabled={busy}
                  aria-haspopup="dialog"
                  aria-label={`编辑第 ${index + 1} 张照片 · ${photo.caption || shotLabel(photo.shot)}`}
                  onClick={(event) => openPhotoDialog(event.currentTarget, index)}
                >
                  <img src={photoUrl(photo.thumbFile, true, photo.file)} alt="" loading="lazy" />
                </button>
                <button
                  type="button"
                  className="photo-del"
                  disabled={busy}
                  onClick={() => void removePhoto(photo)}
                  title="删除这张"
                  aria-label={`删除第 ${index + 1} 张照片`}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>

          {photos.length === 0 && (
            <div className="photo-empty">
              <IconCamera size={24} />
              <span>还没有照片</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="sheet-foot">
        <div className="sheet-error" role="alert">{error}</div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>取消</button>
          <div
            className="editor-save"
            ref={saveGroupRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSaveMenuOpen(false);
            }}
          >
            <button
              type="button"
              className="btn btn-primary editor-save-main"
              onClick={() => void submit('notify')}
              disabled={busy || !photos.length}
              aria-label="保存并告知管理员"
              title="保存并告知管理员"
            >
              {saving && <Spinner size={15} />}
              保存
            </button>
            <button
              type="button"
              className="btn btn-primary editor-save-toggle"
              ref={saveToggleRef}
              onClick={() => setSaveMenuOpen((open) => !open)}
              disabled={busy || !photos.length}
              aria-label="更多保存选项"
              aria-expanded={saveMenuOpen}
              aria-controls={saveMenuOpen ? 'item-save-options' : undefined}
            >
              <IconChevronUp size={15} />
            </button>
            {saveMenuOpen && (
              <div className="editor-save-options" id="item-save-options" role="group" aria-label="保存选项">
                <button type="button" onClick={() => void submit('save')}>保存但不告知管理员</button>
                {!isNew && (
                  <button type="button" onClick={() => void submit('reintroduce')}>重新入库</button>
                )}
              </div>
            )}
          </div>
        </div>
      </footer>

      {photoDialog && (
        <PhotoEditor
          itemId={draftId}
          photos={photos}
          startIndex={photoDialog.startIndex}
          defaultToFull={needsFull}
          isAndroid={isAndroid}
          onClose={() => setPhotoDialog(null)}
          onSave={(next) => {
            setPhotos(next);
            setPhotoDialog(null);
          }}
        />
      )}

      {characterForm && (
        <Modal size="sm" className="character-sheet" titleId="character-dialog-title" onClose={closeCharacterForm} closeOnBackdrop={false}>
          <SheetHeader
            title={characterForm.id ? '编辑角色档案' : '新增角色档案'}
            titleId="character-dialog-title"
            onClose={closeCharacterForm}
          />
          <form
            className="character-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCharacter();
            }}
          >
            <div className="sheet-body character-fields">
              <Field label="角色名" hint="必填">
                <input
                  className="input"
                  value={characterForm.name}
                  onChange={(event) => setCharacterForm({ ...characterForm, name: event.target.value })}
                  placeholder="初音未来"
                  maxLength={80}
                  aria-required="true"
                  readOnly={characterBusy}
                  autoFocus
                />
              </Field>
              <Field label="出自作品">
                <input
                  className="input"
                  value={characterForm.source}
                  onChange={(event) => setCharacterForm({ ...characterForm, source: event.target.value })}
                  placeholder="VOCALOID、原神、赛马娘…"
                  maxLength={120}
                  readOnly={characterBusy}
                />
              </Field>
              <Field label="角色背景">
                <textarea
                  className="input textarea"
                  rows={3}
                  value={characterForm.description}
                  onChange={(event) => setCharacterForm({ ...characterForm, description: event.target.value })}
                  maxLength={4000}
                  readOnly={characterBusy}
                />
              </Field>
              <div className="sheet-error" role="alert">{characterError}</div>
            </div>
            <footer className="sheet-foot">
              <div className="sheet-actions">
                <button type="button" className="btn btn-ghost" onClick={closeCharacterForm} disabled={characterBusy}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={characterBusy}>
                  {characterBusy && <Spinner size={13} />}
                  保存角色
                </button>
              </div>
            </footer>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
