import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/core/side-panel.js";
import { exportRange } from "../src/helpers/history-export.js";
import type { HomeAssistant, PanelTopology } from "../src/types.js";

type SidePanel = HTMLElement & { hass: HomeAssistant; open(config: unknown): void };

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

function openPanel(callWS: HomeAssistant["callWS"], canExport: boolean): SidePanel {
  const panel = document.createElement("span-side-panel") as SidePanel;
  document.body.appendChild(panel);
  mounted.push(panel);
  panel.hass = { states: {}, services: {}, language: "en", callService: async () => undefined, callWS } as unknown as HomeAssistant;
  const topology = { can_export_history: canExport, device_id: "dev-16", circuits: {} } as unknown as PanelTopology;
  panel.open({ panelMode: true, topology, graphSettings: null, configEntryId: "entry-16" });
  return panel;
}

describe("exportRange", () => {
  const now = new Date(2026, 10, 9, 17, 0);

  it("covers local midnight through the end of the last day", () => {
    const range = exportRange("2026-11-01", "2026-11-07", now)!;
    expect(new Date(range.start).getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(new Date(range.end!).getTime()).toBe(new Date(2026, 10, 8).getTime());
  });

  it("leaves the end open when the last day is not over", () => {
    expect(exportRange("2026-11-01", "2026-11-09", now)!.end).toBeUndefined();
  });

  it("refuses backwards, future and unreadable ranges", () => {
    expect(exportRange("2026-11-07", "2026-11-01", now)).toBeNull();
    expect(exportRange("2026-12-01", "2026-12-02", now)).toBeNull();
    expect(exportRange("", "2026-11-02", now)).toBeNull();
  });
});

describe("the history export section", () => {
  it("is absent when the panel cannot export", () => {
    const panel = openPanel(async () => ({}) as never, false);
    expect(panel.shadowRoot!.querySelector(".history-export")).toBeNull();
  });

  it("asks for this panel's range and reports the rows", async () => {
    const callWS = vi.fn(async () => ({
      exports: [{ panel: "XC-16", title: "MAIN 16", file: "a.csv", rows: 168, url: "/api/span_panel/history/a.csv?authSig=x", totals_kwh: {} }],
    })) as unknown as HomeAssistant["callWS"];
    const panel = openPanel(callWS, true);
    const root = panel.shadowRoot!;
    root.querySelector<HTMLInputElement>(".export-from")!.value = "2026-11-01";
    root.querySelector<HTMLInputElement>(".export-to")!.value = "2026-11-07";
    root.querySelector<HTMLButtonElement>(".export-button")!.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callWS).toHaveBeenCalledWith(expect.objectContaining({ type: "span_panel/export_history", resolution: "hour", config_entry_id: "entry-16" }));
    expect(root.querySelector(".export-status")!.textContent).toBe("Downloaded 168 rows");
  });

  it("shows why an export failed", async () => {
    const callWS = vi.fn(async () => {
      throw new Error("window too long");
    }) as unknown as HomeAssistant["callWS"];
    const panel = openPanel(callWS, true);
    panel.shadowRoot!.querySelector<HTMLButtonElement>(".export-button")!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(panel.shadowRoot!.querySelector(".export-status")!.textContent).toContain("window too long");
  });
});
