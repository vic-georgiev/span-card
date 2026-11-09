import type { PanelTopology } from "../types.js";

/** Longest circuit name the integration sends to the panel. */
export const MAX_CIRCUIT_NAME_LENGTH = 64;

/**
 * The device id to rename this panel's circuits through, or undefined when the
 * panel's connection cannot write names (only SPAN's cloud can today).
 */
export function renameDeviceFor(topology: PanelTopology | null | undefined): string | undefined {
  if (!topology?.can_rename) return undefined;
  return topology.panel_device_id ?? topology.device_id ?? undefined;
}
