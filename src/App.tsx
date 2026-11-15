import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, Character, Config, FreeChatState, Item, ItemStatus, RitualState, UpdateInfo } from './types';
import { TitleBar, Sidebar, MobileBar, TabBar, NAV_ITEMS, type View } from './components/Chrome';
import { HomePage } from './pages/HomePage';
import { CollectionPage } from './pages/CollectionPage';
import { CalendarPage } from './pages/CalendarPage';
import { MemoryPage } from './pages/MemoryPage';
import { RitualPage } from './pages/RitualPage';
import { ChatPage } from './pages/ChatPage';
import { SettingsModal } from './components/SettingsModal';
import { ItemEditor } from './components/ItemEditor';
import { ItemDetail } from './components/ItemDetail';
import { ConfirmHost, Spinner, Toast, confirmDialog, useNarrow } from './components/ui';
import { cleanError, cx, type ItemChange } from './utils';
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
  const narrow = useNarrow();
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>('home');
  const [config, setConfig] = useState<Config | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [todayState, setTodayState] = useState<RitualState | null>(null);
  const [freeChat, setFreeChat] = useState<FreeChatState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('api');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [ritualEntry, setRitualEntry] = useState<RitualState | null>(null);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [ritualAutoOpen, setRitualAutoOpen] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<ItemStatus | 'all'>('all');
  const [memoryItemId, setMemoryItemId] = useState<string | null>(null);
  const [calendarFocusDay, setCalendarFocusDay] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [maximized, setMaximized] = useState(false);
  const viewRef = useRef<View>('home');
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | null>(null);
  const updateNotified = useRef(false);

  const isAndroid = appInfo?.platform === 'android';

  const showToast = useCallback((text: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refreshData = useCallback(async () => {
    const [nextItems, nextState, nextCharacters] = await Promise.all([
      window.hf.items.list(),
      window.hf.ritual.state(),
      window.hf.characters.list(),
    ]);
    setItems(nextItems);
    setTodayState(nextState);
    setCharacters(nextCharacters);
  }, []);

  const refreshFreeChat = useCallback(async () => {
    try {
      const chat = await window.hf.chat.freeState();
      setFreeChat(chat);
    } catch {}
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [info, cfg, itemList, state, chatState, characterList] = await Promise.all([
          window.hf.app.info(),
          window.hf.config.get(),
          window.hf.items.list(),
          window.hf.ritual.state(),
          window.hf.chat.freeState(),
          window.hf.characters.list(),
        ]);
        if (!alive) return;
        setAppInfo(info);
        setConfig(cfg);
        setItems(itemList);
        setTodayState(state);
        setFreeChat(chatState);
        setCharacters(characterList);
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
        return;
      }
      if (event.channel === 'freechat' && (event.type === 'chat:done' || event.type === 'free:threads')) {
        void refreshFreeChat();
        return;
      }
      if (event.type === 'free:proactive') {
        void refreshFreeChat();
        if (viewRef.current !== 'chat') showToast('管理员来找你了。', 'info');
        return;
      }
      if (event.type === 'free:focus') {
        if (typeof event.threadId === 'string' && event.threadId) setRequestedThreadId(event.threadId);
        setView('chat');
        void refreshFreeChat();
      }
    });
    return off;
  }, [showToast, refreshFreeChat]);

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

  const handleSaved = async (saved: Item, meta: { mode: 'create' | 'update'; changes: ItemChange[] }) => {
    setEditor(null);
    await refreshData();
    try {
      const result = await window.hf.chat.itemIntro({ itemId: saved.id, mode: meta.mode, changes: meta.changes });
      if (result?.threadId) {
        setRequestedThreadId(result.threadId);
        setView('chat');
        await refreshFreeChat();
        showToast(meta.mode === 'create' ? '管理员想跟你聊聊新收的这位。' : '管理员注意到资料变了。', 'ok');
      }
    } catch (err) {
      showToast(cleanError(err), 'error');
    }
  };

  const deleteItem = async (item: Item) => {
    const ok = await confirmDialog({
      title: `删除「${item.name}」？`,
      message: '照片会一起消失，但已经归档的对话记忆会保留。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
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
      if (!state.exists) {
        showToast('今天还没有开始上贡。', 'info');
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

  const openChat = (threadId?: string | null) => {
    setRequestedThreadId(threadId || null);
    setView('chat');
    void refreshFreeChat();
  };

  const navigate = (next: View) => {
    if (next === 'memory') setMemoryItemId(null);
    if (next === 'chat') { setRequestedThreadId(null); void refreshFreeChat(); }
    if (next === 'calendar') setCalendarFocusDay(null);
    setView(next);
  };

  const detailItem = detailItemId ? items.find((item) => item.id === detailItemId) || null : null;
  const ritualActive = Boolean(todayState?.status === 'in_progress' && todayState.exists);
  const lastChat = freeChat?.lastMessage || null;
  let chatUnread = false;
  try {
    chatUnread = view !== 'chat' && Boolean(
      lastChat?.role === 'assistant' && lastChat.ts > Number(localStorage.getItem('hf.freechatReadAt') || 0)
    );
  } catch {}

  if (!booted) {
    return (
      <div className="boot">
        <div className="boot-mark"><IconBloom size={30} /></div>
        <div className="boot-name">HentaiFigure</div>
        <div className="boot-sub">正在打开收藏室…</div>
        <Spinner size={20} />
      </div>
    );
  }

  const immersive = view === 'ritual' || view === 'chat';
  const pageTitle = NAV_ITEMS.find((n) => n.view === view)?.label || 'HentaiFigure';

  return (
    <div className={cx('app', narrow ? 'is-narrow' : 'is-wide', isAndroid && 'is-android')}>
      {!isAndroid && !narrow && (
        <TitleBar
          updateAvailable={Boolean(updateInfo?.available)}
          onUpdateClick={() => openSettings('update')}
          maximized={maximized}
        />
      )}
      {narrow && !immersive && (
        <MobileBar
          title={view === 'home' ? 'HentaiFigure' : pageTitle}
          onAdd={() => void openAdd()}
          onSettings={() => openSettings('api')}
          updateAvailable={Boolean(updateInfo?.available)}
          onUpdateClick={() => openSettings('update')}
        />
      )}

      <div className="app-body">
        {!narrow && (
          <Sidebar
            view={view}
            onChange={navigate}
            ritualActive={ritualActive}
            chatUnread={chatUnread}
            onAdd={() => void openAdd()}
            onSettings={() => openSettings('api')}
            version={appInfo?.version}
          />
        )}

        <main className={cx('app-main', `view-${view}`)}>
          {view === 'home' && (
            <HomePage
              items={items}
              todayState={todayState}
              config={config}
              updateInfo={updateInfo}
              freeChat={freeChat}
              chatUnread={chatUnread}
              onAdd={() => void openAdd()}
              onStart={() => void startRitual()}
              onResume={() => void resumeRitual()}
              onViewToday={viewToday}
              onOpenSettings={() => openSettings('api')}
              onGoCollection={goCollection}
              onOpenItem={(item) => setDetailItemId(item.id)}
              onUpdateClick={() => openSettings('update')}
              onOpenChat={() => openChat(null)}
            />
          )}

          {view === 'collection' && (
            <CollectionPage
              items={items}
              characters={characters}
              filter={collectionFilter}
              onFilterChange={setCollectionFilter}
              onAdd={() => void openAdd()}
              onOpen={(item) => setDetailItemId(item.id)}
              onEdit={openEdit}
            />
          )}

          {view === 'calendar' && (
            <CalendarPage focusDay={calendarFocusDay} onToast={showToast} />
          )}

          {view === 'memory' && (
            <MemoryPage initialItemId={memoryItemId} onToast={showToast} />
          )}

          {view === 'chat' && (
            <ChatPage
              config={config}
              items={items}
              characters={characters}
              requestedThreadId={requestedThreadId}
              apiKeySet={Boolean(config?.apiKeySet)}
              narrow={narrow}
              onOpenSettings={() => openSettings('api')}
              onOpenMemory={() => { setMemoryItemId(null); setView('memory'); }}
              onOpenItem={(item) => setDetailItemId(item.id)}
              onBack={() => setView('home')}
              onStateChanged={refreshFreeChat}
              onThreadSelected={() => setRequestedThreadId(null)}
              toast={showToast}
            />
          )}

          {view === 'ritual' && ritualEntry && (
            <RitualPage
              initialState={ritualEntry}
              autoOpen={ritualAutoOpen}
              config={config}
              apiKeySet={Boolean(config?.apiKeySet)}
              narrow={narrow}
              onExit={() => { setView('home'); void refreshData(); }}
              onRefreshData={refreshData}
              onOpenSettings={() => openSettings('api')}
              onViewToday={viewToday}
              toast={showToast}
            />
          )}
        </main>
      </div>

      {narrow && view !== 'ritual' && (
        <TabBar view={view} onChange={navigate} ritualActive={ritualActive} chatUnread={chatUnread} />
      )}

      {settingsOpen && config && (
        <SettingsModal
          config={config}
          appInfo={appInfo}
          updateInfo={updateInfo}
          initialTab={settingsTab}
          narrow={narrow}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setConfig(next);
            if (next.apiKeySet) refreshData().catch(() => {});
            refreshFreeChat().catch(() => {});
          }}
          toast={showToast}
        />
      )}

      {editor && (
        <ItemEditor
          item={editor.item}
          draftId={editor.draftId}
          initialStatus={editor.presetStatus}
          characters={characters}
          items={items}
          isAndroid={isAndroid}
          onCharactersChanged={setCharacters}
          onClose={() => void closeEditor()}
          onSaved={(saved, meta) => void handleSaved(saved, meta)}
          toast={showToast}
        />
      )}

      {detailItem && (
        <ItemDetail
          item={detailItem}
          characters={characters}
          relatedItems={items}
          onClose={() => setDetailItemId(null)}
          onEdit={() => openEdit(detailItem)}
          onDelete={() => void deleteItem(detailItem)}
          onViewMemory={() => openMemoryForItem(detailItem)}
        />
      )}

      <ConfirmHost />
      {toast && <Toast key={toast.id} text={toast.text} kind={toast.kind} />}
    </div>
  );
}
