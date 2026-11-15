import type { ChatThread, Phase, Session } from '../../src/types';

type ChatTool = { type: string; function: { name: string; description: string; parameters: object } };
type MemoryContext = {
  getItemName: (id?: string | null) => string | undefined;
  phaseLabel: (phase: Phase) => string;
  dateKey: (date: Date) => string;
};

export const MEMORY_LOOKUP_TOOLS: ChatTool[];
export const LIST_COLLECTION: ChatTool;
export function searchMemory(options: MemoryContext & { sessions: Session[]; threads: ChatThread[]; args: { query?: unknown; offset?: unknown; limit?: unknown } }): object;
export function readMemory(options: MemoryContext & { session?: Session | null; thread?: ChatThread | null; userName: string; args: { offset?: unknown } }): object;
export function collectionPage<T>(items: T[], query: unknown, offset: unknown, getSearchFields: (item: T) => unknown[]): {
  page: T[];
  total: number;
  nextOffset: number | null;
};
