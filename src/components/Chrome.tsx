import type { ReactNode } from 'react';
import {
  IconBloom, IconMinus, IconPlus, IconSettings, IconSquare, IconX,
  IconHome, IconGallery, IconCalendar, IconBook, IconChat,
} from '../icons';

export function TitleBar({
  onAdd,
  onSettings,
  updateAvailable,
  onUpdateClick,
  maximized,
}: {
  onAdd: () => void;
  onSettings: () => void;
  updateAvailable: boolean;
  onUpdateClick: () => void;
  maximized: boolean;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <button className="add-button" onClick={onAdd} title="添加周边">
          <IconPlus size={16} />
          <span>添加</span>
        </button>
      </div>
      <div className="titlebar-brand">
        <span className="titlebar-mark"><IconBloom size={19} /></span>
        <span className="titlebar-name">HentaiFigure</span>
        <span className="titlebar-tag">收藏室</span>
      </div>
      <div className="titlebar-right">
        {updateAvailable && (
          <button className="titlebar-update" onClick={onUpdateClick} title="发现新版本">
            <span className="titlebar-update-dot" />
            更新
          </button>
        )}
        <button className="titlebar-icon" onClick={onSettings} title="设置">
          <IconSettings size={17} />
        </button>
        <span className="titlebar-divider" />
        <button className="window-button" onClick={() => window.hf.window.minimize()} title="最小化">
          <IconMinus size={15} />
        </button>
        <button className="window-button" onClick={() => window.hf.window.toggleMaximize()} title={maximized ? '还原' : '最大化'}>
          <IconSquare size={12} />
        </button>
        <button className="window-button close" onClick={() => window.hf.window.close()} title="关闭">
          <IconX size={15} />
        </button>
      </div>
    </header>
  );
}

export type View = 'home' | 'collection' | 'calendar' | 'memory' | 'chat' | 'ritual';

const DOCK_ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  { view: 'home', label: '首页', icon: <IconHome size={18} /> },
  { view: 'collection', label: '收藏', icon: <IconGallery size={18} /> },
  { view: 'calendar', label: '日历', icon: <IconCalendar size={18} /> },
  { view: 'chat', label: '对话', icon: <IconChat size={18} /> },
  { view: 'memory', label: '记忆', icon: <IconBook size={18} /> },
];

export function Dock({
  view,
  onChange,
  ritualActive,
}: {
  view: View;
  onChange: (view: View) => void;
  ritualActive: boolean;
}) {
  return (
    <nav className="dock">
      {DOCK_ITEMS.map((item) => (
        <button
          key={item.view}
          className={`dock-item ${view === item.view ? 'active' : ''}`}
          onClick={() => onChange(item.view)}
        >
          <span className="dock-icon">
            {item.icon}
            {item.view === 'home' && ritualActive && <span className="dock-pulse" />}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

