export function isInternalMemoryMonitorEnabled(): boolean {
  return /^true$/i.test(String(process.env.INTERNAL_MEMORY_MONITOR_ENABLED ?? "").trim());
}
