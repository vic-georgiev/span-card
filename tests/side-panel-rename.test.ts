import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/core/side-panel.js";
import { renameDeviceFor } from "../src/helpers/circuit-rename.js";
import type { HomeAssistant, PanelTopology } from "../src/types.js";

type SidePanel = HTMLElement & { hass: HomeAssistant; open(config: unknown): void };
type CallWS = HomeAssistant["callWS"];

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

function mount(callWS: CallWS): SidePanel {
  const panel = document.createElement("span-side-panel") as SidePanel;
  document.body.appendChild(panel);
  mounted.push(panel);
  panel.hass = { states: {}, services: {}, language: "en", callService: async () => undefined, callWS } as unknown as HomeAssistant;
  return panel;
}

function openCircuit(panel: SidePanel, renameDeviceId?: string): void {
  panel.open({
    uuid: "21",
    name: "Kitchen",
    tabs: [9],
    entities: {},
    monitoringInfo: null,
    graphHorizonInfo: { horizon: "5m", has_override: false, globalHorizon: "5m" },
    renameDeviceId,
  });
}

function nameInput(panel: SidePanel): HTMLInputElement | null {
  return panel.shadowRoot!.querySelector<HTMLInputElement>("input.circuit-name");
}

async function commit(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("change"));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("renaming a circuit from the side panel", () => {
  it("offers no name field when the panel cannot rename", () => {
    const panel = mount(async () => ({}));
    openCircuit(panel);
    expect(nameInput(panel)).toBeNull();
  });

  it("sends the cleaned name and shows what the panel took", async () => {
    const callWS = vi.fn(async () => ({ name: "Kitchen outlets" })) as unknown as CallWS;
    const panel = mount(callWS);
    openCircuit(panel, "dev-40");
    const input = nameInput(panel)!;
    expect(input.value).toBe("Kitchen");

    await commit(input, "  Kitchen   outlets ");

    expect(callWS).toHaveBeenCalledWith({ type: "span_panel/rename_circuit", device_id: "dev-40", circuit_id: "21", name: "Kitchen outlets" });
    expect(input.value).toBe("Kitchen outlets");
    expect(input.classList.contains("saved")).toBe(true);
    expect(panel.shadowRoot!.querySelector(".title")!.textContent).toBe("Kitchen outlets");
  });

  it("sends nothing for an unchanged or empty name", async () => {
    const callWS = vi.fn(async () => ({})) as unknown as CallWS;
    const panel = mount(callWS);
    openCircuit(panel, "dev-40");
    const input = nameInput(panel)!;

    await commit(input, " Kitchen ");
    await commit(input, "   ");

    expect(callWS).not.toHaveBeenCalled();
    expect(input.value).toBe("Kitchen");
  });

  it("puts the old name back and marks the field when the panel refuses", async () => {
    const callWS = vi.fn(async () => {
      throw new Error("SPAN said no");
    }) as unknown as CallWS;
    const panel = mount(callWS);
    openCircuit(panel, "dev-40");
    const input = nameInput(panel)!;

    await commit(input, "Pantry");

    expect(input.value).toBe("Kitchen");
    expect(input.classList.contains("failed")).toBe(true);
    expect(input.title).toContain("SPAN said no");
  });

  it("makes every circuit's name editable in the panel's settings", async () => {
    const callWS = vi.fn(async () => ({ name: "Pool pump" })) as unknown as CallWS;
    const panel = mount(callWS);
    const topology = {
      can_rename: true,
      device_id: "dev-40",
      circuits: {
        "21": { name: "Kitchen", tabs: [9], entities: {} },
        "22": { name: "Disposal", tabs: [11], entities: {} },
      },
    } as unknown as PanelTopology;
    panel.open({ panelMode: true, topology, graphSettings: null });

    const inputs = [...panel.shadowRoot!.querySelectorAll<HTMLInputElement>("input.circuit-name")];
    expect(inputs.map(i => i.value)).toEqual(["Disposal", "Kitchen"]);

    await commit(inputs[0]!, "Pool pump");
    expect(callWS).toHaveBeenCalledWith(expect.objectContaining({ circuit_id: "22", name: "Pool pump" }));
    expect(topology.circuits["22"]!.name).toBe("Pool pump");
  });
});

describe("renameDeviceFor", () => {
  it("names the panel's current device only when it can rename", () => {
    expect(renameDeviceFor({ can_rename: true, device_id: "old", panel_device_id: "new", circuits: {} })).toBe("new");
    expect(renameDeviceFor({ can_rename: true, device_id: "only", circuits: {} })).toBe("only");
    expect(renameDeviceFor({ can_rename: false, device_id: "dev", circuits: {} })).toBeUndefined();
    expect(renameDeviceFor({ device_id: "dev", circuits: {} })).toBeUndefined();
    expect(renameDeviceFor(null)).toBeUndefined();
  });
});
