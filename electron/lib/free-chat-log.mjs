const MAX_RUNS = 30;

function snapshotRequest(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => {
    if (key !== 'image_url' || typeof value?.url !== 'string' || !value.url.startsWith('data:image/')) return value;
    const comma = value.url.indexOf(',');
    return { ...value, url: `${value.url.slice(0, comma + 1)}[图片数据，${value.url.length - comma - 1} 字符]` };
  }));
}

export class FreeChatLog {
  runs = [];
  nextId = 0;

  constructor(onUpdate) {
    this.onUpdate = onUpdate;
  }

  list(threadId) {
    return this.runs.filter((run) => run.threadId === threadId);
  }

  remove(threadId) {
    this.runs = this.runs.filter((run) => run.threadId !== threadId);
  }

  start(threadId) {
    const run = { id: ++this.nextId, threadId, startedAt: Date.now(), status: 'running', rounds: [] };
    this.runs.unshift(run);
    if (this.runs.length > MAX_RUNS) this.runs.pop();
    const publish = () => this.onUpdate(threadId);
    publish();

    return {
      request(payload) {
        const round = { request: snapshotRequest(payload), calls: [] };
        run.rounds.push(round);
        publish();
        return round;
      },
      finish(status, error) {
        if (run.status !== 'running') return;
        run.status = status;
        if (error) run.error = error;
        publish();
      },
    };
  }
}
