import { useMemo, useState } from 'react';
import type { Item, ItemStatus } from '../types';
import {
  STATUS_META, formatMoney, itemCover, pendingTail, photoUrl, statusLabel, totalSpent, typeLabel,
} from '../constants';
import { formatDateCN } from '../constants';
import {
  IconAlert, IconChevronRight, IconGallery, IconPencil, IconPlus, IconSearch, IconWallet,
} from '../icons';
import { EmptyState, Chip } from '../components/ui';

export function CollectionPage({
  items,
  filter,
  onFilterChange,
  onAdd,
  onOpen,
  onEdit,
}: {
  items: Item[];
  filter: ItemStatus | 'all';
  onFilterChange: (filter: ItemStatus | 'all') => void;
  onAdd: () => void;
  onOpen: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  const [search, setSearch] = useState('');

  const counts = useMemo(() => ({
    all: items.length,
    owned: items.filter((i) => i.status === 'owned').length,
    pending: items.filter((i) => i.status === 'pending').length,
    watching: items.filter((i) => i.status === 'watching').length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!q) return true;
      return `${item.name} ${item.series || ''} ${item.scale || ''} ${typeLabel(item.type)}`.toLowerCase().includes(q);
    });
  }, [items, filter, search]);

  const tabs: { value: ItemStatus | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'owned', label: '已拥有' },
    { value: 'pending', label: '待补款' },
    { value: 'watching', label: '观望中' },
  ];

  return (
    <div className="page collection-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">THE COLLECTION</div>
          <h1>收藏室</h1>
          <p className="page-sub">
            {items.length
              ? `共 ${items.length} 件周边 · 累计投入 ${formatMoney(totalSpent(items))}${pendingTail(items) ? ` · 还在等 ${formatMoney(pendingTail(items))} 的尾款` : ''}`
              : '柜子还是空的。把她带进来，才会有故事。'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}><IconPlus size={16} /> 添加周边</button>
      </header>

      <div className="collection-toolbar">
        <div className="filter-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={`filter-tab ${filter === tab.value ? 'active' : ''}`}
              onClick={() => onFilterChange(tab.value)}
            >
              {tab.label}
              <span>{counts[tab.value]}</span>
            </button>
          ))}
        </div>
        <div className="search-box">
          <IconSearch size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜名字、作品、规格…" />
          {search && <button onClick={() => setSearch('')} aria-label="清空">×</button>}
        </div>
      </div>

      {!items.length ? (
        <EmptyState
          title="这里还空着"
          desc="先放一件周边进来吧。一张照片、一个名字，她就能开始记住你。"
          icon={<IconGallery size={34} />}
          action={<button className="btn btn-primary" onClick={onAdd}><IconPlus size={15} /> 添加第一件</button>}
        />
      ) : !filtered.length ? (
        <EmptyState
          title="这个筛选项下什么都没有"
          desc="换个筛选，或者把新的她带进来。"
          icon={<IconSearch size={30} />}
        />
      ) : (
        <div className="item-grid">
          {filtered.map((item) => {
            const cover = itemCover(item);
            const needsFull = item.status === 'owned' && item.type === 'figure' && !(item.photos || []).some((p) => p.shot === 'full');
            return (
              <article className={`item-card status-${item.status}`} key={item.id} onClick={() => onOpen(item)}>
                <div className="item-cover">
                  {cover ? (
                    <img src={photoUrl(cover, true)} alt={item.name} loading="lazy" />
                  ) : (
                    <div className="item-cover-empty"><IconGallery size={26} /></div>
                  )}
                  <span className="item-status">{statusLabel(item.status)}</span>
                  {needsFull && <span className="item-warning"><IconAlert size={12} /> 缺全身照</span>}
                  <button
                    className="item-edit"
                    onClick={(event) => { event.stopPropagation(); onEdit(item); }}
                    title="编辑"
                    aria-label="编辑"
                  >
                    <IconPencil size={15} />
                  </button>
                </div>
                <div className="item-body">
                  <div className="item-type">{typeLabel(item.type)}</div>
                  <h3>{item.name}</h3>
                  <div className="item-sub">
                    {[item.series, item.scale].filter(Boolean).join(' · ') || `${item.photos.length} 张照片`}
                  </div>
                  <div className="item-meta">
                    <span className="item-price">
                      <IconWallet size={13} />
                      {item.status === 'pending'
                        ? `尾款 ${formatMoney(item.balance)}`
                        : formatMoney(item.purchasePrice ?? item.originalPrice)}
                    </span>
                    {item.dueDate ? (
                      <span className="item-due">{formatDateCN(item.dueDate)}</span>
                    ) : (
                      <span className="item-more">查看 <IconChevronRight size={12} /></span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="collection-summary">
          {(['owned', 'pending', 'watching'] as ItemStatus[]).map((status) => (
            <div key={status} className={`summary-pill status-${status}`}>
              <Chip tone={status}>{STATUS_META[status].label}</Chip>
              <b>{counts[status]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

