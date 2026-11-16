import type { ReactNode } from 'react';
import {
  IconMinus, IconPlus, IconSettings, IconSquare, IconX,
  IconHome, IconGallery, IconCalendar, IconBook, IconChat, IconDownload,
} from '../icons';
import { cx } from '../utils';

export type View = 'home' | 'collection' | 'calendar' | 'memory' | 'chat' | 'ritual';

export const NAV_ITEMS: { view: View; label: string; hint: string; icon: (size: number) => ReactNode }[] = [
  { view: 'home', label: '首页', hint: '今日份上贡', icon: (s) => <IconHome size={s} /> },
  { view: 'collection', label: '收藏', hint: '柜子里的她们', icon: (s) => <IconGallery size={s} /> },
  { view: 'chat', label: '对话', hint: '和管理员聊天', icon: (s) => <IconChat size={s} /> },
  { view: 'calendar', label: '日历', hint: '上贡的日子', icon: (s) => <IconCalendar size={s} /> },
  { view: 'memory', label: '记忆', hint: '封存的对话', icon: (s) => <IconBook size={s} /> },
];

/** Desktop-only frameless title bar (drag region + window buttons). */
export function TitleBar({
  updateAvailable,
  onUpdateClick,
  maximized,
}: {
  updateAvailable: boolean;
  onUpdateClick: () => void;
  maximized: boolean;
}) {
  return (
    <header className="titlebar">
      <span className="brand-name">HentaiFigure</span>
      <div className="titlebar-drag" />
      {updateAvailable && (
        <button type="button" className="titlebar-update" onClick={onUpdateClick}>
          <IconDownload size={13} /> 有新版本
        </button>
      )}
      <div className="window-controls">
        <button type="button" onClick={() => window.hf.window.minimize()} title="最小化" aria-label="最小化">
          <IconMinus size={15} />
        </button>
        <button type="button" onClick={() => window.hf.window.toggleMaximize()} title={maximized ? '还原' : '最大化'} aria-label="最大化">
          <IconSquare size={12} />
        </button>
        <button type="button" className="close" onClick={() => window.hf.window.close()} title="关闭" aria-label="关闭">
          <IconX size={15} />
        </button>
      </div>
    </header>
  );
}

/** Desktop navigation rail. */
export function Sidebar({
  view,
  onChange,
  ritualActive,
  chatUnread,
  onAdd,
  onSettings,
  version,
}: {
  view: View;
  onChange: (view: View) => void;
  ritualActive: boolean;
  chatUnread: boolean;
  onAdd: () => void;
  onSettings: () => void;
  version?: string;
}) {
  return (
    <nav className="sidebar" aria-label="主导航">
      <button type="button" className="sidebar-add" onClick={onAdd}>
        添加周边
      </button>
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = view === item.view || (item.view === 'home' && view === 'ritual');
          return (
            <button
              type="button"
              key={item.view}
              className={cx('nav-item', active && 'active')}
              onClick={() => onChange(item.view)}
            >
              <span className="nav-icon">
                {item.icon(19)}
                {item.view === 'home' && ritualActive && <span className="nav-dot" />}
                {item.view === 'chat' && chatUnread && <span className="nav-dot" />}
              </span>
              <span className="nav-text">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <button type="button" className="nav-item" onClick={onSettings}>
          <span className="nav-icon"><IconSettings size={19} /></span>
          <span className="nav-text"><strong>设置</strong><small>API · 管理员 · 数据</small></span>
        </button>
        {version && <div className="sidebar-version">v{version}</div>}
      </div>
    </nav>
  );
}

/** Mobile top bar. */
export function MobileBar({
  title,
  onAdd,
  onSettings,
  updateAvailable,
  onUpdateClick,
}: {
  title: string;
  onAdd: () => void;
  onSettings: () => void;
  updateAvailable: boolean;
  onUpdateClick: () => void;
}) {
  return (
    <header className="mobilebar">
      <span className="mobilebar-title">{title}</span>
      {updateAvailable && (
        <button type="button" className="titlebar-update" onClick={onUpdateClick}>
          <IconDownload size={13} /> 更新
        </button>
      )}
      <button type="button" className="icon-btn" onClick={onAdd} aria-label="添加周边">
        <IconPlus size={20} />
      </button>
      <button type="button" className="icon-btn" onClick={onSettings} aria-label="设置">
        <IconSettings size={19} />
      </button>
    </header>
  );
}

/** Mobile bottom tab bar (in normal flow — never overlays content). */
export function TabBar({
  view,
  onChange,
  ritualActive,
  chatUnread,
}: {
  view: View;
  onChange: (view: View) => void;
  ritualActive: boolean;
  chatUnread: boolean;
}) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {NAV_ITEMS.map((item) => (
        <button
          type="button"
          key={item.view}
          className={cx('tab', view === item.view && 'active')}
          onClick={() => onChange(item.view)}
        >
          <span className="tab-icon">
            {item.icon(21)}
            {item.view === 'home' && ritualActive && <span className="nav-dot" />}
            {item.view === 'chat' && chatUnread && <span className="nav-dot" />}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
