import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, Config, Item, ItemStatus, RitualState, UpdateInfo } from './types';
import { TitleBar, Dock, type View } from './components/Chrome';
import { HomePage } from './pages/HomePage';
import { CollectionPage } from './pages/CollectionPage';
import { CalendarPage } from './pages/CalendarPage';
import { MemoryPage } from './pages/MemoryPage';
import { RitualPage } from './pages/RitualPage';
import { SettingsModal } from './components/SettingsModal';
import { ItemEditor } from './components/ItemEditor';
import { ItemDetail } from './components/ItemDetail';
import { Spinner, Toast } from './components/ui';
import { cleanError } from './utils';
import { todayKey } from './constants';
import { IconBloom } from './icons';

type ToastState = { id: number; text: string; kind: 'ok' | 'error' | 'info' } | null;
type EditorState = {
  draftId: string;
  item: Item | null;
  isNew: boolean;
  presetStatus?: ItemStatus;
};

export default function App() {
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>('home');
  const [config, setConfig] = useState<Config | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [todayState, setTodayState] = useState<RitualState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('api');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [ritualEntry, setRitualEntry] = useState<RitualState | null>(null);
  const [ritualAutoOpen, setRitualAutoOpen] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<ItemStatus | 'all'>('all');
  const [memoryItemId, setMemoryItemId] = useState<string | null>(null);
  const [calendarFocusDay, setCalendarFocusDay] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | null>(null);
  const updateNotified = useRef(false);

  const showToast = useCallback((text: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refreshData = useCallback(async () => {
    const [nextItems, nextState] = await Promise.all([
      window.hf.items.list(),
      window.hf.ritual.state(),
    ]);
    setItems(nextItems);
    setTodayState(nextState);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [info, cfg, itemList, state] = await Promise.all([
          window.hf.app.info(),
          window.hf.config.get(),
          window.hf.items.list(),
          window.hf.ritual.state(),
        ]);
        if (!alive) return;
        setAppInfo(info);
        setConfig(cfg);
        setItems(itemList);
        setTodayState(state);
        setUpdateInfo(info.updateInfo || null);
        setMaximized(Boolean(info.isMaximized));
      } catch (err) {
        if (alive) showToast(`初始化失败：${cleanError(err)}`, 'error');
      } finally {
        if (alive) setBooted(true);
      }
    })();
    return () => {
      alive = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [showToast]);

  useEffect(() => {
    const off = window.hf.onEvent((event) => {
      if (event.type === 'window:state') {
        setMaximized(Boolean(event.maximized));
        return;
      }
      if (event.type === 'update:info' || event.type === 'update:available') {
        const info = event.info as UpdateInfo | undefined;
        if (info) setUpdateInfo(info);
        if (event.type === 'update:available' && info?.available && !updateNotified.current) {
          updateNotified.current = true;
          showToast(`发现新版本 v${info.latestVersion}`, 'info');
        }
      }
    });
    return off;
  }, [showToast]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const openSettings = (tab = 'api') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const openAdd = async (presetStatus?: ItemStatus) => {
    try {
      const draftId = await window.hf.items.newId();
      setEditor({ draftId, item: null, isNew: true, presetStatus });
    } catch (err) {
      showToast(cleanError(err), 'error');
    }
  };

  const openEdit = (item: Item) => {
    setDetailItemId(null);
    setEditor({ draftId: item.id, item, isNew: false });
  };

  const closeEditor = async () => {
    if (editor?.isNew) {
      try { await window.hf.items.discardDraft(editor.draftId); } catch {}
    }
    setEditor(null);
  };

  const handleSaved = async () => {
    setEditor(null);
    await refreshData();
  };

  const deleteItem = async (item: Item) => {
    if (!window.confirm(`真的要把「${item.name}」从收藏室里删掉吗？照片和她的记忆会一起消失。`)) return;
    try {
      await window.hf.items.remove(item.id);
      setDetailItemId(null);
      await refreshData();
      showToast('已经从收藏室里移除了。', 'info');
    } catch (err) {
      showToast(cleanError(err), 'error');
    }
  };

  const startRitual = async () => {
    try {
      const result = await window.hf.ritual.start();
      if (result.empty) {
        showToast(result.message || '今天没有可以上贡的周边。', 'info');
        return;
      }
      setTodayState(result.state);
      setRitualEntry(result.state);
      setRitualAutoOpen(true);
      setView('ritual');
    } catch (err) {
      showToast(cleanError(err), 'error');
    }
  };

  const resumeRitual = async () => {
    try {
      const state = await window.hf.ritual.state();
      if (!state.exists || state.status === 'complete') {
        if (state.status === 'complete') {
          setTodayState(state);
          setRitualEntry(state);
          setRitualAutoOpen(false);
          setView('ritual');
        } else {
          showToast('今天还没有开始上贡。', 'info');
        }
        return;
      }
      setTodayState(state);
      setRitualEntry(state);
      setRitualAutoOpen(false);
      setView('ritual');
    } catch (err) {
      showToast(cleanError(err), 'error');
    }
  };

  const viewToday = () => {
    setCalendarFocusDay(todayKey());
    setView('calendar');
  };

  const openMemoryForItem = (item: Item) => {
    setMemoryItemId(item.id);
    setDetailItemId(null);
    setView('memory');
  };

  const goCollection = (status?: ItemStatus) => {
    setCollectionFilter(status || 'all');
    setView('collection');
  };

  const detailItem = detailItemId ? items.find((item) => item.id === detailItemId) || null : null;

  if (!booted) {
    return (
      <div className="boot-screen">
        <div className="boot-mark"><IconBloom size={36} /></div>
        <div className="boot-name">HentaiFigure</div>
        <div className="boot-sub">正在打开收藏室…</div>
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar
        onAdd={() => void openAdd()}
        onSettings={() => openSettings('api')}
        updateAvailable={Boolean(updateInfo?.available)}
        onUpdateClick={() => openSettings('update')}
        maximized={maximized}
      />

      <main className="app-main">
        {view === 'home' && (
          <HomePage
            items={items}
            todayState={todayState}
            config={config}
            appInfo={appInfo}
            updateInfo={updateInfo}
            onAdd={() => void openAdd()}
            onStart={() => void startRitual()}
            onResume={() => void resumeRitual()}
            onViewToday={viewToday}
            onOpenSettings={() => openSettings('api')}
            onGoCollection={goCollection}
            onUpdateClick={() => openSettings('update')}
          />
        )}

        {view === 'collection' && (
          <CollectionPage
            items={items}
            filter={collectionFilter}
            onFilterChange={setCollectionFilter}
            onAdd={() => void openAdd()}
            onOpen={(item) => setDetailItemId(item.id)}
            onEdit={openEdit}
          />
        )}

        {view === 'calendar' && (
          <CalendarPage
            focusDay={calendarFocusDay}
            onToast={showToast}
          />
        )}

        {view === 'memory' && (
          <MemoryPage
            initialItemId={memoryItemId}
            onToast={showToast}
          />
        )}

        {view === 'ritual' && ritualEntry && (
          <RitualPage
            initialState={ritualEntry}
            autoOpen={ritualAutoOpen}
            apiKeySet={Boolean(config?.apiKeySet)}
            onExit={() => { setView('home'); void refreshData(); }}
            onRefreshData={refreshData}
            onOpenSettings={() => openSettings('api')}
            onViewToday={viewToday}
            toast={showToast}
          />
        )}
      </main>

      <Dock
        view={view}
        ritualActive={Boolean(todayState?.status === 'in_progress' && todayState.exists)}
        onChange={(next) => {
          if (next === 'memory') setMemoryItemId(null);
          setView(next);
        }}
      />

      {settingsOpen && config && (
        <SettingsModal
          config={config}
          appInfo={appInfo}
          updateInfo={updateInfo}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setConfig(next);
            if (next.apiKeySet) refreshData().catch(() => {});
          }}
          toast={showToast}
        />
      )}

      {editor && (
        <ItemEditor
          item={editor.item}
          draftId={editor.draftId}
          initialStatus={editor.presetStatus}
          onClose={() => void closeEditor()}
          onSaved={() => void handleSaved()}
          toast={showToast}
        />
      )}

      {detailItem && (
        <ItemDetail
          item={detailItem}
          onClose={() => setDetailItemId(null)}
          onEdit={() => openEdit(detailItem)}
          onDelete={() => void deleteItem(detailItem)}
          onViewMemory={() => openMemoryForItem(detailItem)}
        />
      )}

      {toast && <Toast key={toast.id} text={toast.text} kind={toast.kind} />}
    </div>
  );
}

