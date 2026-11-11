import { describe, it, expect } from "vitest";
import { circuitDetails } from "../src/core/side-panel.js";
import type { Circuit } from "../src/types.js";

/** A circuit's Details: the breaker and what it serves, as the panel publishes them. */

function circuit(overrides: Partial<Circuit>): Circuit {
  return { name: "Kitchen / Outlets", tabs: [9], entities: {}, ...overrides };
}

const rows = (c: Circuit): Record<string, string> => Object.fromEntries(circuitDetails(c).map(row => [row.label, row.value]));

describe("a circuit's details", () => {
  it("names its spaces, breaker, protection, voltage, role, PowerUp rank and last switch", () => {
    expect(
      rows(
        circuit({
          tabs: [48, 46],
          breaker_rating_a: 30,
          protection_functions: ["OVERCURRENT", "ARC_FAULT"],
          voltage: 240,
          feeds_role: "STORAGE",
          powerup_managed: true,
          powerup_rank: 37,
          relay_requester: "LOAD_SHED",
        })
      )
    ).toEqual({
      Spaces: "46 / 48",
      Breaker: "30 A · 2-pole",
      Protection: "Overcurrent, Arc fault (AFCI)",
      Voltage: "240 V",
      Feeds: "A battery",
      PowerUp: "Managed · rank 37",
      "Last switched by": "Load shedding",
    });
  });

  it("leaves out what the panel does not say", () => {
    expect(rows(circuit({ tabs: [9], relay_requester: "UNKNOWN", powerup_managed: null }))).toEqual({ Spaces: "9" });
  });

  it("says when PowerUp does not manage the circuit", () => {
    expect(rows(circuit({ powerup_managed: false }))["PowerUp"]).toBe("Not managed");
  });

  it("reads a value it has no words for as words", () => {
    expect(rows(circuit({ relay_requester: "MID_CONTROL_DER" }))["Last switched by"]).toBe("mid control der");
  });
});
