import type { FreeChatLogRound, FreeChatLogRun } from '../../src/types';

export class FreeChatLog {
  constructor(onUpdate: (threadId: string) => void);
  list(threadId: string): FreeChatLogRun[];
  remove(threadId: string): void;
  start(threadId: string): {
    request(payload: Record<string, unknown>): FreeChatLogRound;
    finish(status: Exclude<FreeChatLogRun['status'], 'running'>, error?: string): void;
  };
}
