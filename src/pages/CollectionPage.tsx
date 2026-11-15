import { useMemo, useState } from 'react';
import type { Character, Item, ItemStatus } from '../types';
import {
  formatDateCN, formatMoney, itemCover, pendingTail, photoUrl, statusLabel, totalSpent, typeLabel,
} from '../constants';
import { IconAlert, IconGallery, IconPencil, IconPlus, IconSearch, IconX } from '../icons';
import { EmptyState } from '../components/ui';
import { cx } from '../utils';

type SortKey = 'recent' | 'name' | 'price';

export function CollectionPage({
  items,
  characters,
  filter,
  onFilterChange,
  onAdd,
  onOpen,
  onEdit,
}: {
  items: Item[];
  characters: Character[];
  filter: ItemStatus | 'all';
  onFilterChange: (filter: ItemStatus | 'all') => void;
  onAdd: () => void;
  onOpen: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const counts = useMemo(() => ({
    all: items.length,
    owned: items.filter((i) => i.status === 'owned').length,
    pending: items.filter((i) => i.status === 'pending').length,
    watching: items.filter((i) => i.status === 'watching').length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!q) return true;
      const character = characters.find((c) => c.id === item.characterId);
      return `${item.name} ${item.series || ''} ${item.scale || ''} ${typeLabel(item.type)} ${character?.name || ''} ${character?.source || ''}`
        .toLowerCase()
        .includes(q);
    });
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (sort === 'price') list.sort((a, b) => (b.purchasePrice ?? b.originalPrice ?? 0) - (a.purchasePrice ?? a.originalPrice ?? 0));
    else list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return list;
  }, [items, characters, filter, search, sort]);

  const tabs: { value: ItemStatus | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'owned', label: '已拥有' },
    { value: 'pending', label: '待补款' },
    { value: 'watching', label: '观望中' },
  ];

  const tail = pendingTail(items);

  return (
    <div className="page collection">
      <header className="page-head">
        <div>
          <div className="eyebrow">THE COLLECTION</div>
          <h1>收藏室</h1>
          <p className="page-sub">
            {items.length
              ? `共 ${items.length} 件 · 累计投入 ${formatMoney(totalSpent(items))}${tail ? ` · 尾款待补 ${formatMoney(tail)}` : ''}`
              : '柜子还是空的。把她带进来，才会有故事。'}
          </p>
        </div>
        <button type="button" className="btn btn-primary hide-narrow" onClick={onAdd}>
          <IconPlus size={16} /> 添加周边
        </button>
      </header>

      <div className="toolbar">
        <div className="segmented scroll-x">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.value}
              className={cx(filter === tab.value && 'active', tab.value !== 'all' && `tone-${tab.value}`)}
              onClick={() => onFilterChange(tab.value)}
            >
              {tab.label}
              <span className="count">{counts[tab.value]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="search">
            <IconSearch size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜名字、角色、作品…" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="清空"><IconX size={14} /></button>
            )}
          </label>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序">
            <option value="recent">最近更新</option>
            <option value="name">按名称</option>
            <option value="price">按价格</option>
          </select>
        </div>
      </div>

      {!items.length ? (
        <EmptyState
          title="这里还空着"
          desc="先放一件周边进来吧。一张照片、一个名字，她就能开始记住你。"
          icon={<IconGallery size={30} />}
          action={<button type="button" className="btn btn-primary" onClick={onAdd}><IconPlus size={15} /> 添加第一件</button>}
        />
      ) : !filtered.length ? (
        <EmptyState
          title="没有找到"
          desc="换个筛选或关键词试试。"
          icon={<IconSearch size={28} />}
        />
      ) : (
        <div className="grid">
          {filtered.map((item) => {
            const cover = itemCover(item);
            const needsFull = item.status === 'owned' && item.type === 'figure' && !(item.photos || []).some((p) => p.shot === 'full');
            const character = characters.find((c) => c.id === item.characterId);
            const sub = character
              ? `${character.name}${character.source ? ` · ${character.source}` : ''}`
              : [item.series, item.scale].filter(Boolean).join(' · ') || `${item.photos.length} 张照片`;
            return (
              <article
                className={cx('card-item', `tone-${item.status}`)}
                key={item.id}
                onClick={() => onOpen(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item); }}
              >
                <div className="card-cover">
                  {cover ? (
                    <img src={photoUrl(cover, true)} alt={item.name} loading="lazy" />
                  ) : (
                    <div className="card-cover-empty"><IconGallery size={26} /></div>
                  )}
                  <span className={cx('pill', `tone-${item.status}`)}>{statusLabel(item.status)}</span>
                  {needsFull && <span className="pill pill-warn"><IconAlert size={11} /> 缺全身照</span>}
                  <button
                    type="button"
                    className="card-edit"
                    onClick={(event) => { event.stopPropagation(); onEdit(item); }}
                    title="编辑"
                    aria-label="编辑"
                  >
                    <IconPencil size={14} />
                  </button>
                </div>
                <div className="card-body">
                  <div className="card-type">{typeLabel(item.type)}{item.scale ? ` · ${item.scale}` : ''}</div>
                  <h3>{item.name}</h3>
                  <div className="card-sub">{sub}</div>
                  <div className="card-foot">
                    <span className="card-price">
                      {item.status === 'pending'
                        ? `尾款 ${formatMoney(item.balance)}`
                        : formatMoney(item.purchasePrice ?? item.originalPrice)}
                    </span>
                    {item.dueDate && item.status === 'pending' && (
                      <span className="card-due">{formatDateCN(item.dueDate).replace(/^\d+年/, '')}</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
