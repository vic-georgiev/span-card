import { describe, it, expect } from "vitest";
import { formatPowerUnit, formatPowerSigned, formatWatts, formatPowerHTML, formatCircuitPowerHTML, formatCircuitCurrentHTML } from "../src/helpers/format.js";

describe("formatPowerUnit", () => {
  it("returns W for values under 1000", () => {
    expect(formatPowerUnit(500)).toBe("W");
    expect(formatPowerUnit(0)).toBe("W");
    expect(formatPowerUnit(999)).toBe("W");
  });

  it("returns kW for values >= 1000", () => {
    expect(formatPowerUnit(1000)).toBe("kW");
    expect(formatPowerUnit(11500)).toBe("kW");
  });

  it("handles negative values", () => {
    expect(formatPowerUnit(-500)).toBe("W");
    expect(formatPowerUnit(-1000)).toBe("kW");
  });
});

describe("formatPowerSigned", () => {
  it("formats positive values without sign", () => {
    expect(formatPowerSigned(500)).toBe("500");
    expect(formatPowerSigned(1500)).toBe("1.50");
  });

  it("formats negative values with minus sign", () => {
    expect(formatPowerSigned(-500)).toBe("-500");
    expect(formatPowerSigned(-1500)).toBe("-1.50");
  });

  it("formats zero", () => {
    expect(formatPowerSigned(0)).toBe("0");
  });

  it("formats small values with one decimal", () => {
    expect(formatPowerSigned(5)).toBe("5.0");
  });
});

describe("formatWatts", () => {
  it("shows whole watts below 1 kW and kW with two decimals from there", () => {
    expect(formatWatts(728)).toBe("728");
    expect(formatWatts(1234)).toBe("1.23");
  });

  it("keeps one decimal below 10 W, so a 1 W load is visible", () => {
    expect(formatWatts(1)).toBe("1.0");
  });

  it("handles negative values using absolute value", () => {
    expect(formatWatts(-1500)).toBe("1.50");
  });

  it("handles zero", () => {
    expect(formatWatts(0)).toBe("0");
  });
});

describe("formatPowerHTML", () => {
  it("draws a reading with its unit", () => {
    expect(formatPowerHTML(1500)).toBe('<strong>1.50</strong> <span class="power-unit">kW</span>');
    expect(formatPowerHTML(0)).toBe('<strong>0</strong> <span class="power-unit">W</span>');
  });

  it("draws an unknown reading as unknown, without a unit", () => {
    expect(formatPowerHTML(null)).toBe("<strong>--</strong>");
  });
});

describe("formatCircuitPowerHTML and formatCircuitCurrentHTML", () => {
  it("draw a reading with its unit", () => {
    expect(formatCircuitPowerHTML(-250)).toBe('<strong>-250</strong><span class="power-unit">W</span>');
    expect(formatCircuitCurrentHTML(4.2)).toBe('<strong>4.2</strong><span class="power-unit">A</span>');
  });

  it("draw an unknown reading as unknown, without a unit", () => {
    expect(formatCircuitPowerHTML(null)).toBe("<strong>--</strong>");
    expect(formatCircuitCurrentHTML(null)).toBe("<strong>--</strong>");
  });
});
