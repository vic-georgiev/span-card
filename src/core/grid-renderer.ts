import { escapeHtml } from "../helpers/sanitize.js";
import { formatCircuitCurrentHTML, formatCircuitPowerHTML } from "../helpers/format.js";
import { t } from "../i18n.js";
import { tabToRow, tabToCol, classifyDualTab, measuresOutsidePanel, type PositionRange } from "../helpers/layout.js";
import { getChartMetric } from "../helpers/chart.js";
import { meterSlots } from "../helpers/shared-meters.js";
import { getCircuitMonitoringInfo } from "./monitoring-status.js";
import {
  circuitCurrentA,
  circuitPowerW,
  circuitUtilizationPct,
  getCircuitStateClasses,
  readsAsProducer,
  relayClosed,
  shedPriorityKey,
  switchPresence,
} from "./circuit-state.js";
import { buildSheddingIconHTML, buildTogglePillHTML } from "./circuit-controls.js";
import { formatPowerHTML } from "../helpers/format.js";
import { findBatteryLevelEntity } from "../helpers/entity-finder.js";
import { resolveSubDevicePower, stateWatts } from "../helpers/sub-device-power.js";
import type { PanelTopology, Circuit, HomeAssistant, CardConfig, MonitoringStatus, MonitoringPointInfo, ReservedBreaker } from "../types.js";

type SlotLayout = "single" | "row-span" | "col-span";

interface TabMapEntry {
  uuid: string;
  circuit: Circuit;
  members: readonly Circuit[];
  layout: SlotLayout;
}

interface ReservedEntry {
  breaker: ReservedBreaker;
  layout: SlotLayout;
}

function slotLayout(tabs: number[]): SlotLayout {
  return tabs.length === 1 ? "single" : (classifyDualTab(tabs) ?? "single");
}

/**
 * Build the full grid HTML for the panel breaker grid: one row per two positions
 * across `positions`, labelled with the positions' own numbers.
 */
export function buildGridHTML(
  topology: PanelTopology,
  positions: PositionRange,
  hass: HomeAssistant,
  config: CardConfig,
  monitoringStatus: MonitoringStatus | null
): string {
  const tabMap = new Map<number, TabMapEntry>();
  const occupiedTabs = new Set<number>();

  // Circuits that share a meter share a space, and are drawn there as one slot.
  for (const { uuid, circuit, members } of meterSlots(topology.circuits)) {
    // A meter outside the panel is drawn in the Meters strip, never in a breaker space.
    if (measuresOutsidePanel(circuit)) continue;
    const tabs = circuit.tabs;
    if (!tabs || tabs.length === 0) continue;
    const primaryTab = Math.min(...tabs);
    tabMap.set(primaryTab, { uuid, circuit, members, layout: slotLayout(tabs) });
    for (const tab of tabs) occupiedTabs.add(tab);
  }

  // Breakers SPAN API publishes nothing for, which the linked account reported:
  // drawn in their spaces so those do not read as empty.
  const reservedMap = new Map<number, ReservedEntry>();
  for (const breaker of topology.reserved ?? []) {
    if (breaker.tabs.length === 0 || breaker.tabs.some(tab => occupiedTabs.has(tab))) continue;
    reservedMap.set(Math.min(...breaker.tabs), { breaker, layout: slotLayout(breaker.tabs) });
    for (const tab of breaker.tabs) occupiedTabs.add(tab);
  }

  const rowsToSkipLeft = new Set<number>();
  const rowsToSkipRight = new Set<number>();

  const spans: [number, SlotLayout, number[]][] = [
    ...[...tabMap].map(([tab, entry]): [number, SlotLayout, number[]] => [tab, entry.layout, entry.circuit.tabs]),
    ...[...reservedMap].map(([tab, entry]): [number, SlotLayout, number[]] => [tab, entry.layout, entry.breaker.tabs]),
  ];
  for (const [primaryTab, layout, tabs] of spans) {
    if (layout === "col-span") {
      const secondaryTab = Math.max(...tabs);
      const secondaryRow = tabToRow(secondaryTab);
      const col = tabToCol(primaryTab);
      if (col === 0) rowsToSkipLeft.add(secondaryRow);
      else rowsToSkipRight.add(secondaryRow);
    }
  }

  function lookupMonitoring(entry: TabMapEntry): {
    monInfo: MonitoringPointInfo | null;
    sheddingPriority: string;
  } {
    const circuitEntityId = entry.circuit.entities?.current ?? entry.circuit.entities?.power;
    const monInfo = monitoringStatus ? getCircuitMonitoringInfo(monitoringStatus, circuitEntityId ?? "") : null;
    const sheddingPriority = shedPriorityKey(entry.circuit, hass);
    return { monInfo, sheddingPriority };
  }

  // A row the range starts or ends inside draws only its in-range side.
  const inRange = (tab: number): boolean => tab >= positions.first && tab <= positions.last;
  const firstRow = tabToRow(positions.first);
  const lastRow = tabToRow(positions.last);

  let gridHTML = "";
  for (let row = firstRow; row <= lastRow; row++) {
    const gridRow = row - firstRow + 1;
    const leftTab = row * 2 - 1;
    const rightTab = row * 2;
    const leftEntry = tabMap.get(leftTab);
    const rightEntry = tabMap.get(rightTab);
    const leftLabel = inRange(leftTab) ? `<div class="tab-label tab-left" style="grid-row: ${gridRow}; grid-column: 1;">${leftTab}</div>` : "";
    const rightLabel = inRange(rightTab) ? `<div class="tab-label tab-right" style="grid-row: ${gridRow}; grid-column: 5;">${rightTab}</div>` : "";

    gridHTML += leftLabel;

    const leftReserved = reservedMap.get(leftTab);
    const rightReserved = reservedMap.get(rightTab);
    if (leftReserved && leftReserved.layout === "row-span") {
      gridHTML += renderReservedSlot(leftReserved.breaker, topology, gridRow, "2 / 5", "row-span", hass);
      gridHTML += rightLabel;
      continue;
    }

    if (leftEntry && leftEntry.layout === "row-span") {
      const { monInfo, sheddingPriority } = lookupMonitoring(leftEntry);
      gridHTML += renderCircuitSlot(
        leftEntry.uuid,
        leftEntry.circuit,
        gridRow,
        "2 / 5",
        "row-span",
        hass,
        config,
        monInfo,
        sheddingPriority,
        leftEntry.members
      );
      gridHTML += rightLabel;
      continue;
    }

    if (!rowsToSkipLeft.has(row)) {
      if (leftEntry && (leftEntry.layout === "col-span" || leftEntry.layout === "single")) {
        const { monInfo, sheddingPriority } = lookupMonitoring(leftEntry);
        gridHTML += renderCircuitSlot(
          leftEntry.uuid,
          leftEntry.circuit,
          gridRow,
          "2",
          leftEntry.layout,
          hass,
          config,
          monInfo,
          sheddingPriority,
          leftEntry.members
        );
      } else if (leftReserved) {
        gridHTML += renderReservedSlot(leftReserved.breaker, topology, gridRow, "2", leftReserved.layout, hass);
      } else if (!occupiedTabs.has(leftTab) && inRange(leftTab)) {
        gridHTML += renderEmptySlot(gridRow, "2");
      }
    }

    if (!rowsToSkipRight.has(row)) {
      if (rightEntry && (rightEntry.layout === "col-span" || rightEntry.layout === "single")) {
        const { monInfo, sheddingPriority } = lookupMonitoring(rightEntry);
        gridHTML += renderCircuitSlot(
          rightEntry.uuid,
          rightEntry.circuit,
          gridRow,
          "4",
          rightEntry.layout,
          hass,
          config,
          monInfo,
          sheddingPriority,
          rightEntry.members
        );
      } else if (rightReserved) {
        gridHTML += renderReservedSlot(rightReserved.breaker, topology, gridRow, "4", rightReserved.layout, hass);
      } else if (!occupiedTabs.has(rightTab) && inRange(rightTab)) {
        gridHTML += renderEmptySlot(gridRow, "4");
      }
    }

    gridHTML += rightLabel;
  }
  return gridHTML;
}

/**
 * Render a single circuit breaker slot. With more than one member it is the slot
 * of circuits that share a meter: `circuit` is the one it reads and switches
 * through, and each member gives its name and rating.
 */
export function renderCircuitSlot(
  uuid: string,
  circuit: Circuit,
  row: number,
  col: string,
  layout: SlotLayout,
  hass: HomeAssistant,
  config: CardConfig,
  monitoringInfo: MonitoringPointInfo | null,
  sheddingPriority: string,
  members: readonly Circuit[] = [circuit],
  inline = false
): string {
  const powerW = circuitPowerW(circuit, hass);
  const isProducer = readsAsProducer(circuit, powerW);

  const isOn = relayClosed(circuit, hass);
  const presence = switchPresence(circuit, hass);

  const shared = members.length > 1;
  const breakerLabel = shared ? sharedRatingsLabel(members) : singleRatingLabel(circuit.breaker_rating_a);
  const name = escapeHtml(members.map(member => member.name || t("grid.unknown")).join(" · "));

  const showCurrent = getChartMetric(config).entityRole === "current";
  const valueHTML = showCurrent ? formatCircuitCurrentHTML(circuitCurrentA(circuit, hass)) : formatCircuitPowerHTML(powerW);

  const sheddingHTML = buildSheddingIconHTML(sheddingPriority || "unknown");

  // Gear icon
  const gearHTML = `<button class="gear-icon circuit-gear"
    data-uuid="${escapeHtml(uuid)}" style="color:#555;"
    title="${escapeHtml(t("grid.configure"))}">
    <span-icon icon="mdi:cog" style="--mdc-icon-size:16px;"></span-icon>
  </button>`;

  // Utilization — prefer monitoring data, fall back to live current / breaker rating
  let utilizationHTML = "";
  const utilizationPct = circuitUtilizationPct(circuit, hass, monitoringInfo);
  if (utilizationPct !== null) {
    const utilClass = utilizationPct >= 100 ? "utilization-alert" : utilizationPct >= 80 ? "utilization-warning" : "utilization-normal";
    utilizationHTML = `<span class="utilization ${utilClass}">${Math.round(utilizationPct)}%</span>`;
  }

  const stateClasses = getCircuitStateClasses(circuit, monitoringInfo, isOn, isProducer);

  const rowSpan = layout === "col-span" ? `${row} / span 2` : `${row}`;
  const layoutClass = inline ? "" : layout === "row-span" ? "circuit-row-span" : layout === "col-span" ? "circuit-col-span" : "";
  const gridStyle = inline ? "" : `style="grid-row: ${rowSpan}; grid-column: ${col};"`;

  return `
    <div class="circuit-slot ${stateClasses} ${layoutClass}"
         ${gridStyle}
         data-uuid="${escapeHtml(uuid)}">
      <div class="circuit-header">
        <div class="circuit-info">
          ${breakerLabel ? `<span class="breaker-badge">${breakerLabel}</span>` : ""}
          ${utilizationHTML}
          <span class="circuit-name">${name}</span>
        </div>
        <div class="circuit-controls">
          <span class="power-value">
            ${valueHTML}
          </span>
          ${buildTogglePillHTML(isOn, presence, shared && sharesRelay(members))}
        </div>
      </div>
      <div class="circuit-status">
        ${sheddingHTML}
        ${gearHTML}
      </div>
      <div class="chart-container"></div>
    </div>
  `;
}

function singleRatingLabel(amps: number | null | undefined): string {
  return amps ? `${Math.round(amps)}A` : "";
}

/** Each member's rating, as "15·10 A"; empty while any is unknown. */
function sharedRatingsLabel(members: readonly Circuit[]): string {
  if (members.some(member => !member.breaker_rating_a)) return "";
  return `${members.map(member => Math.round(member.breaker_rating_a!)).join("·")} A`;
}

/** Whether every member switches with the same relay, so one toggle switches them all. */
function sharesRelay(members: readonly Circuit[]): boolean {
  const relay = members[0]?.shared_relay_group;
  return !!relay && members.every(member => member.shared_relay_group === relay);
}

/** The battery's power and charge entities, where the integration placed a battery on the breaker. */
export function reservedBatteryEntities(breaker: ReservedBreaker, topology: PanelTopology): { power: string | null; soc: string | null } {
  const battery = breaker.battery_device_id ? topology.sub_devices?.[breaker.battery_device_id] : undefined;
  if (!battery) return { power: null, soc: null };
  return { power: resolveSubDevicePower(battery).headlineEid, soc: findBatteryLevelEntity(battery) };
}

/** The battery's charge as "NN%", or empty while unknown. */
export function socText(hass: HomeAssistant, entityId: string | null): string {
  const value = entityId ? Number(hass.states[entityId]?.state) : Number.NaN;
  return Number.isFinite(value) ? `${Math.round(value)}%` : "";
}

/**
 * Render a breaker SPAN API leaves out, in its spaces: named as SPAN names it,
 * with no switch, and with the battery's power and charge where the
 * integration says the battery is on it.
 */
export function renderReservedSlot(
  breaker: ReservedBreaker,
  topology: PanelTopology,
  row: number,
  col: string,
  layout: SlotLayout,
  hass: HomeAssistant
): string {
  const { power, soc } = reservedBatteryEntities(breaker, topology);
  const rowSpan = layout === "col-span" ? `${row} / span 2` : `${row}`;
  const layoutClass = layout === "row-span" ? "circuit-row-span" : layout === "col-span" ? "circuit-col-span" : "";
  const caption = t(breaker.battery_device_id ? "grid.reserved_battery" : "grid.reserved");
  const powerHTML = power ? formatPowerHTML(stateWatts(hass, power)) : "";
  return `
    <div class="circuit-slot circuit-reserved ${layoutClass}"
         style="grid-row: ${rowSpan}; grid-column: ${col};"
         data-reserved-tabs="${breaker.tabs.join("/")}"
         ${power ? `data-reserved-power="${escapeHtml(power)}"` : ""}
         ${soc ? `data-reserved-soc="${escapeHtml(soc)}"` : ""}>
      <div class="circuit-header">
        <div class="circuit-info">
          <span class="circuit-name">${escapeHtml(breaker.name || t("grid.unknown"))}</span>
        </div>
        <div class="circuit-controls">
          <span class="power-value">${powerHTML}</span>
        </div>
      </div>
      <div class="circuit-status">
        <span class="reserved-caption">${escapeHtml(caption)}</span>
        <span class="reserved-soc">${escapeHtml(socText(hass, soc))}</span>
      </div>
    </div>
  `;
}

/**
 * Render an empty breaker slot.
 */
export function renderEmptySlot(row: number, col: string): string {
  return `
    <div class="circuit-slot circuit-empty" style="grid-row: ${row}; grid-column: ${col};">
      <span class="empty-label">&mdash;</span>
    </div>
  `;
}
