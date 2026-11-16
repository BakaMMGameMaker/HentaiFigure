import type { FreeChatLogRound, FreeChatLogRun } from '../../src/types';

export class FreeChatLog {
  constructor(store: {
    newId(prefix: string): string;
    listFreeChatLogs(threadId: string): FreeChatLogRun[] | Promise<FreeChatLogRun[]>;
    saveFreeChatLog(threadId: string, run: FreeChatLogRun): void | Promise<void>;
  }, onUpdate: (threadId: string) => void);
  list(threadId: string): Promise<FreeChatLogRun[]>;
  start(threadId: string): {
    request(payload: Record<string, unknown>): FreeChatLogRound;
    finish(status: Exclude<FreeChatLogRun['status'], 'running'>, error?: string): Promise<void>;
  };
}
