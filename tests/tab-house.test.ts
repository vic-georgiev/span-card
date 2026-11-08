import { describe, it, expect } from "vitest";
import { fetchHouse, type House, type HousePanel } from "../src/panel/tab-house.js";
import type { HomeAssistant } from "../src/types.js";

function panel(serial: string, depth: number, overrides: Partial<HousePanel> = {}): HousePanel {
  return {
    serial,
    title: `SPAN ${serial}`,
    entry_id: `entry-${serial}`,
    device_id: `device-${serial}`,
    depth,
    feed: depth === 0 ? { type: "own_supply" } : { type: "lugs", upstream: "40" },
    children: [],
    main_feed_power: `sensor.${serial}_power`,
    feedthrough_power: null,
    feed_check: null,
    ...overrides,
  };
}

function hassAnswering(answer: () => Promise<unknown>): HomeAssistant {
  return { callWS: answer } as unknown as HomeAssistant;
}

describe("fetchHouse", () => {
  const house: House = {
    panels: [panel("40", 0, { children: ["16"] }), panel("16", 1)],
    house_power_entities: ["sensor.40_power"],
  };

  it("answers the house when it has more than one panel", async () => {
    expect(await fetchHouse(hassAnswering(() => Promise.resolve(house)))).toEqual(house);
  });

  it("leaves a one-panel install on its ordinary view", async () => {
    const single: House = { panels: [panel("40", 0)], house_power_entities: [] };
    expect(await fetchHouse(hassAnswering(() => Promise.resolve(single)))).toBeNull();
  });

  it("does not count a panel it could not draw", async () => {
    const orphan: House = { panels: [panel("40", 0), panel("16", 1, { device_id: null })], house_power_entities: [] };
    expect(await fetchHouse(hassAnswering(() => Promise.resolve(orphan)))).toBeNull();
  });

  it("treats an integration without the command as no house", async () => {
    expect(await fetchHouse(hassAnswering(() => Promise.reject(new Error("unknown_command"))))).toBeNull();
  });
});
