type DailyChatSettings = { dailyChatTime: string; dailyChatEnabled: boolean };

export function dailyChatScheduleChanged(config: DailyChatSettings, patch: Partial<DailyChatSettings>): boolean;
export function isDailyChatDue(now: number, time: string, scheduleChangedAt: number): boolean;
