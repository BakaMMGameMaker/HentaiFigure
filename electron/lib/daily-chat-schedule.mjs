export function dailyChatScheduleChanged(config, patch) {
  return (patch.dailyChatTime !== undefined && patch.dailyChatTime !== config.dailyChatTime)
    || (patch.dailyChatEnabled !== undefined && patch.dailyChatEnabled !== config.dailyChatEnabled);
}

export function isDailyChatDue(now, time, scheduleChangedAt) {
  const [hours, minutes] = time.split(':').map(Number);
  const scheduledAt = new Date(now).setHours(hours, minutes, 0, 0);
  return scheduledAt <= now && scheduledAt >= scheduleChangedAt;
}
