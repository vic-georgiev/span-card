import { describe, it, expect, vi, afterEach } from "vitest";
import type { CardConfig, HomeAssistant, PanelTopology } from "../src/types.js";

vi.mock("../src/card/card-discovery.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/card/card-discovery.js")>()),
  discoverTopology: vi.fn(),
}));

import { discoverTopology } from "../src/card/card-discovery.js";
import { HouseTab, type House } from "../src/panel/tab-house.js";
import "../src/core/side-panel.js";

/**
 * A house of two panels: the MAIN 16 on the MAIN 40's feed-through lugs. One
 * view, the 40 first, its lugs card naming the 16, then the 16 with the line
 * saying what feeds it and the feed check's figures.
 */

const mockDiscover = vi.mocked(discoverTopology);

function topology(name: string, circuits: Record<string, { name: string; tabs: number[] }>, panelSize: number): PanelTopology {
  return {
    device_name: name,
    circuits: Object.fromEntries(Object.entries(circuits).map(([id, c]) => [id, { ...c, entities: {} }])),
    panel_size: panelSize,
    first_space: 9,
    panel_entities: {},
  } as unknown as PanelTopology;
}

const TOPOLOGIES: Record<string, PanelTopology> = {
  "device-40": topology("SPAN MAIN 40", { k: { name: "Kitchen", tabs: [9] }, b: { name: "Battery", tabs: [46, 48] } }, 48),
  "device-16": topology("SPAN MAIN 16", { g: { name: "Garage", tabs: [10] } }, 24),
};

const HOUSE: House = {
  panels: [
    {
      serial: "40",
      title: "SPAN MAIN 40",
      entry_id: "entry-40",
      device_id: "device-40",
      depth: 0,
      feed: { type: "own_supply" },
      children: ["16"],
      main_feed_power: "sensor.main_40_power",
      feedthrough_power: "sensor.main_40_feedthrough_power",
      feed_check: null,
    },
    {
      serial: "16",
      title: "SPAN MAIN 16",
      entry_id: "entry-16",
      device_id: "device-16",
      depth: 1,
      feed: { type: "lugs", upstream: "40" },
      children: [],
      main_feed_power: "sensor.main_16_power",
      feedthrough_power: null,
      feed_check: "sensor.main_16_feed_check",
    },
  ],
  house_power_entities: ["sensor.main_40_power"],
};

function state(entity_id: string, value: string, attributes: Record<string, unknown> = {}) {
  return { entity_id, state: value, attributes, last_changed: "", last_updated: "" };
}

function hass(): HomeAssistant {
  return {
    states: {
      "sensor.main_40_power": state("sensor.main_40_power", "3000"),
      "sensor.main_16_power": state("sensor.main_16_power", "405"),
      "sensor.main_40_feedthrough_power": state("sensor.main_40_feedthrough_power", "412"),
      "sensor.main_16_feed_check": state("sensor.main_16_feed_check", "7", {
        upstream_w: 412,
        this_panel_w: 405,
        average_difference_w: 3.2,
        house_clock_lag_s: 0.42,
      }),
    },
    services: {},
    language: "en",
    callWS: async (msg: Record<string, unknown>) => (msg.type === "call_service" ? { response: { global_horizon: "5m", circuits: {}, sub_devices: {} } } : {}),
    callService: async () => undefined,
  } as unknown as HomeAssistant;
}

const tabs: HouseTab[] = [];
afterEach(() => {
  for (const tab of tabs.splice(0)) tab.stop();
  mockDiscover.mockReset();
});

describe("the house view", () => {
  async function render(): Promise<HTMLElement> {
    mockDiscover.mockImplementation(async (_hass, deviceId) => {
      const topo = TOPOLOGIES[deviceId ?? ""]!;
      return { topology: topo, panelDevice: null, panelSize: topo.panel_size! };
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const tab = new HouseTab();
    tabs.push(tab);
    await tab.render(container, hass(), {} as CardConfig, HOUSE);
    return container;
  }

  it("shows what the house draws, counting the fed panel once", async () => {
    const container = await render();
    expect(container.querySelector("[data-house-power]")?.textContent).toMatch(/3,000\s*W/);
  });

  it("says the panels are shown in sync, and how far behind live", async () => {
    const container = await render();
    expect(container.querySelector("[data-house-sync]")?.textContent).toBe("Panels in sync · 0.4 s behind live");
  });

  it("draws every panel in one view, upstream first", async () => {
    const container = await render();
    const sections = [...container.querySelectorAll("section.house-panel")];
    expect(sections).toHaveLength(2);
    expect(sections[0]!.classList.contains("fed")).toBe(false);
    expect(sections[1]!.classList.contains("fed")).toBe(true);
    expect(sections[0]!.textContent).toContain("Kitchen");
    expect(sections[1]!.textContent).toContain("Garage");
  });

  it("puts a feed-through card under the 40 naming the 16, with the lugs' power", async () => {
    const container = await render();
    const card = container.querySelector("section.house-panel .feedthrough-card");
    expect(card?.textContent).toContain("Feed-through lugs");
    expect(card?.textContent).toContain("SPAN MAIN 16");
    expect(card?.textContent).toContain("412");
  });

  it("says what feeds the 16, with both sides of the feed check", async () => {
    const container = await render();
    const line = container.querySelectorAll("section.house-panel")[1]!.querySelector(".house-fed-from");
    expect(line?.textContent).toContain("feed-through lugs of");
    expect(line?.textContent).toContain("SPAN MAIN 40");
    expect(line?.textContent).toMatch(/At the lugs\s*412.*At this panel\s*405.*Difference\s*7.*1-min average\s*3\.2/s);
  });

  it("starts each panel's grid at its first space, with no main-breaker rows", async () => {
    const container = await render();
    const firstLabels = [...container.querySelectorAll(".panel-grid")].map(grid => grid.querySelector(".tab-label.tab-left")?.textContent);
    expect(firstLabels).toEqual(["9", "9"]);
  });
});
