import type { HomeAssistant } from "../types.js";
import { INTEGRATION_DOMAIN } from "../constants.js";

export const HISTORY_RESOLUTIONS = ["minute", "quarter_hour", "hour", "day", "month"] as const;
export type HistoryResolution = (typeof HISTORY_RESOLUTIONS)[number];

export interface HistoryExport {
  panel: string;
  title: string;
  file: string;
  rows: number;
  url: string;
  totals_kwh: Record<string, number>;
}

/** `YYYY-MM-DD` for a local date, the form a date input takes and gives. */
export function dateInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The range two date inputs mean: local midnight of the first day through the
 * end of the last day. An end that is not yet over is left out, which asks for
 * everything up to now. Returns null for unreadable or backwards dates.
 */
export function exportRange(startDay: string, endDay: string, now: Date = new Date()): { start: string; end?: string } | null {
  const parse = (day: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const start = parse(startDay);
  const last = parse(endDay);
  if (!start || !last || last < start || start >= now) return null;
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return end >= now ? { start: start.toISOString() } : { start: start.toISOString(), end: end.toISOString() };
}

/** Ask the integration to export, answering with one signed download per panel. */
export async function requestHistoryExport(
  hass: HomeAssistant,
  range: { start: string; end?: string },
  resolution: HistoryResolution,
  configEntryId?: string | null
): Promise<HistoryExport[]> {
  const msg: Record<string, unknown> = { type: `${INTEGRATION_DOMAIN}/export_history`, start: range.start, resolution };
  if (range.end) msg.end = range.end;
  if (configEntryId) msg.config_entry_id = configEntryId;
  const result = await hass.callWS<{ exports: HistoryExport[] }>(msg);
  return result.exports;
}

/** Start a browser download of one exported file. */
export function downloadExport(item: HistoryExport): void {
  const link = document.createElement("a");
  link.href = item.url;
  link.download = item.file;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
