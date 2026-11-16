function snapshotRequest(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => {
    if (key !== 'image_url' || typeof value?.url !== 'string' || !value.url.startsWith('data:image/')) return value;
    const comma = value.url.indexOf(',');
    return { ...value, url: `${value.url.slice(0, comma + 1)}[图片数据，${value.url.length - comma - 1} 字符]` };
  }));
}

export class FreeChatLog {
  active = null;

  constructor(store, onUpdate) {
    this.store = store;
    this.onUpdate = onUpdate;
  }

  async list(threadId) {
    const runs = await this.store.listFreeChatLogs(threadId);
    return runs.sort((a, b) => b.startedAt - a.startedAt).map((run) => (
      run.status === 'running' && run.id !== this.active?.id ? { ...run, status: 'stopped' } : run
    ));
  }

  start(threadId) {
    const run = { id: this.store.newId('log'), startedAt: Date.now(), status: 'running', rounds: [] };
    this.active = run;
    const publish = async () => {
      try {
        await this.store.saveFreeChatLog(threadId, run);
        this.onUpdate(threadId);
      } catch {
        console.warn('保存对话日志失败。');
      }
    };
    void publish();

    return {
      request(payload) {
        const round = { request: snapshotRequest(payload), calls: [] };
        run.rounds.push(round);
        void publish();
        return round;
      },
      finish: async (status, error) => {
        if (run.status !== 'running') return;
        run.status = status;
        if (error) run.error = error;
        this.active = null;
        await publish();
      },
    };
  }
}
