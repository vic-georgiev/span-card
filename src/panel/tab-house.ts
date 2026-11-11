import { DashboardTab } from "./tab-dashboard.js";
import { escapeHtml } from "../helpers/sanitize.js";
import { formatPowerHTML } from "../helpers/format.js";
import { readNumber, sumReadings } from "../helpers/read-number.js";
import { t, tf } from "../i18n.js";
import type { ErrorStore } from "../core/error-store.js";
import type { HomeAssistant, CardConfig } from "../types.js";

/** What feeds a panel, as the integration stores it. */
export interface HouseFeed {
  type: "own_supply" | "lugs" | "branch";
  upstream?: string;
  circuit?: string;
}

/** Name a panel by its title and model, so two panels both titled "Span Panel" tell apart. */
export function panelLabel(panel: Pick<HousePanel, "title" | "model">): string {
  const model = panel.model?.replace(/_/g, " ");
  return model && !panel.title.includes(model) ? `${panel.title} · ${model}` : panel.title;
}

/** One panel of the house, as `span_panel/house` answers it, in display order. */
export interface HousePanel {
  serial: string;
  title: string;
  /** The panel's model ("MAIN_40"), which tells apart two panels of one title. */
  model?: string | null;
  /** What supplies a root panel, where the panel itself says so. */
  supply?: { type: "battery"; name: string } | null;
  entry_id: string;
  device_id: string | null;
  depth: number;
  feed: HouseFeed;
  children: string[];
  main_feed_power: string | null;
  feedthrough_power: string | null;
  feed_check: string | null;
}

export interface House {
  panels: HousePanel[];
  /** The root panels' main feeds: their sum is what the house draws. */
  house_power_entities: string[];
}

/**
 * The house, when the integration can describe one and it has more than one
 * panel; null otherwise, which leaves the By Panel tab showing one panel as
 * before. An integration without the command answers an error, not a house.
 */
export async function fetchHouse(hass: HomeAssistant): Promise<House | null> {
  try {
    const house = await hass.callWS<House>({ type: "span_panel/house" });
    const drawable = house.panels.filter(panel => panel.device_id);
    return drawable.length > 1 ? { ...house, panels: drawable } : null;
  } catch {
    return null;
  }
}

const HOUSE_STYLES = `
  .house-summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 4px 0 16px;
    border-bottom: 1px solid var(--divider-color);
    margin-bottom: 16px;
  }
  .house-summary .house-title { font-size: 1.4em; font-weight: 600; }
  .house-summary .house-power { font-size: 1.4em; }
  .house-summary .house-sync { color: var(--secondary-text-color); font-size: 0.9em; }
  .house-panel + .house-panel { margin-top: 28px; }
  .house-panel.fed { border-left: 3px solid var(--divider-color); padding-left: 16px; }
  .house-fed-from {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: baseline;
    color: var(--secondary-text-color);
    font-size: 0.9em;
    margin-bottom: 8px;
  }
  .house-fed-from .feed-check strong { color: var(--primary-text-color); }
  .feedthrough-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding: 12px 16px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    border: 1px dashed var(--divider-color);
  }
  .feedthrough-card .feedthrough-label { font-weight: 500; }
  .feedthrough-card .feedthrough-target { color: var(--secondary-text-color); font-size: 0.9em; }
`;

/**
 * The By Panel tab for a house of several panels: every panel in one view, in
 * the order power flows -- each panel with its own supply, then the panels it
 * feeds beneath it -- so there is nothing to switch between.
 *
 * Each panel is the ordinary dashboard for that panel, header and breakers,
 * rendered by its own `DashboardTab`. Around them this adds what only the house
 * knows: what the house draws (its root panels' main feeds, a fed panel already
 * inside), a feed-through card under a panel whose lugs feed another, and on a
 * fed panel the line saying what feeds it, with the feed check that compares
 * the upstream's figure with the fed panel's own.
 */
export class HouseTab {
  private _tabs: DashboardTab[] = [];
  private _container: HTMLElement | null = null;
  private _house: House | null = null;
  private _hass: HomeAssistant | null = null;
  private _errorStore: ErrorStore | null = null;

  set hass(hass: HomeAssistant | null) {
    this._hass = hass;
    for (const tab of this._tabs) tab.hass = hass;
    this._updateLive();
  }

  set errorStore(store: ErrorStore | null) {
    this._errorStore = store;
    for (const tab of this._tabs) tab.errorStore = store;
  }

  get active(): boolean {
    return this._house !== null;
  }

  async render(container: HTMLElement, hass: HomeAssistant, config: CardConfig, house: House): Promise<void> {
    this.stop();
    this._container = container;
    this._house = house;
    this._hass = hass;

    const byKey = new Map(house.panels.map(panel => [panel.serial, panel]));
    container.innerHTML = `
      <style>${HOUSE_STYLES}</style>
      <div class="house-summary">
        <span class="house-title">${escapeHtml(t("house.title"))}</span>
        <span class="house-power" data-house-power></span>
        <span class="house-sync" data-house-sync></span>
      </div>
    `;

    for (const panel of house.panels) {
      const section = document.createElement("section");
      section.className = panel.depth > 0 ? "house-panel fed" : "house-panel";
      section.style.marginLeft = panel.depth > 1 ? `${(panel.depth - 1) * 16}px` : "";
      if (panel.depth > 0) section.innerHTML = this._fedFromHTML(panel, byKey);
      else if (panel.supply) section.innerHTML = this._suppliedHTML(panel.supply.name);
      const content = document.createElement("div");
      section.appendChild(content);
      container.appendChild(section);

      const tab = new DashboardTab();
      tab.errorStore = this._errorStore;
      tab.hass = hass;
      this._tabs.push(tab);
      await tab.render(content, hass, panel.device_id ?? "", config, panel.entry_id);

      const fedByLugs = panel.children.map(key => byKey.get(key)).filter(child => child && child.feed.type === "lugs");
      if (panel.feedthrough_power && fedByLugs.length > 0) {
        const card = document.createElement("div");
        card.className = "feedthrough-card";
        const targets = fedByLugs.map(child => escapeHtml(panelLabel(child!))).join(", ");
        card.innerHTML = `
          <div>
            <div class="feedthrough-label">${escapeHtml(t("house.feedthrough"))}</div>
            <div class="feedthrough-target">${escapeHtml(t("house.feeds"))} ${targets}</div>
          </div>
          <div data-power-entity="${escapeHtml(panel.feedthrough_power)}"></div>
        `;
        section.appendChild(card);
      }
    }

    this._updateLive();
  }

  stop(): void {
    for (const tab of this._tabs) tab.stop();
    this._tabs = [];
    this._house = null;
    this._container = null;
  }

  private _fedFromHTML(panel: HousePanel, byKey: Map<string, HousePanel>): string {
    const upstream = byKey.get(panel.feed.upstream ?? "");
    const title = escapeHtml(upstream ? panelLabel(upstream) : (panel.feed.upstream ?? ""));
    const how = panel.feed.type === "lugs" ? t("house.via_lugs") : t("house.via_branch");
    const check = panel.feed_check ? `<span class="feed-check" data-check-entity="${escapeHtml(panel.feed_check)}"></span>` : "";
    return `<div class="house-fed-from"><span>${escapeHtml(tf("house.fed_from", { how }))} <strong>${title}</strong></span>${check}</div>`;
  }

  private _suppliedHTML(name: string): string {
    return `<div class="house-fed-from"><span>${escapeHtml(t("house.supplied_through"))} <strong>${escapeHtml(name)}</strong></span></div>`;
  }

  /** Refresh the figures this view owns; each panel's own dashboard refreshes itself. */
  private _updateLive(): void {
    const container = this._container;
    const house = this._house;
    const hass = this._hass;
    if (!container || !house || !hass) return;

    const total = sumReadings(house.house_power_entities.map(entityId => readNumber(hass.states[entityId])));
    const houseEl = container.querySelector("[data-house-power]");
    if (houseEl) houseEl.innerHTML = total.partial ? formatPowerHTML(null) : formatPowerHTML(total.total);

    // Where a clock shows the panels at one instant, how far behind live that
    // is; otherwise how far apart the two panels' latest readings were taken.
    const syncEl = container.querySelector("[data-house-sync]");
    if (syncEl) syncEl.textContent = syncText(house.panels.map(panel => (panel.feed_check ? hass.states[panel.feed_check]?.attributes : undefined)));

    for (const el of container.querySelectorAll<HTMLElement>("[data-power-entity]")) {
      el.innerHTML = formatPowerHTML(readNumber(hass.states[el.dataset.powerEntity ?? ""]));
    }

    for (const el of container.querySelectorAll<HTMLElement>("[data-check-entity]")) {
      const state = hass.states[el.dataset.checkEntity ?? ""];
      const difference = readNumber(state);
      const upstreamW = Number(state?.attributes?.upstream_w);
      const panelW = Number(state?.attributes?.this_panel_w);
      // Present when the integration matched the two panels by SPAN's frame time.
      const averageW = Number(state?.attributes?.average_difference_w ?? Number.NaN);
      const parts = [
        Number.isFinite(upstreamW) ? `${t("house.check_upstream")} ${formatPowerHTML(upstreamW)}` : null,
        Number.isFinite(panelW) ? `${t("house.check_panel")} ${formatPowerHTML(panelW)}` : null,
        `${t("house.check_difference")} ${formatPowerHTML(difference)}`,
        Number.isFinite(averageW) ? `${t("house.check_average")} ${formatPowerHTML(averageW)}` : null,
      ];
      el.innerHTML = parts.filter(Boolean).join(" · ");
    }
  }
}

/** The house's sync line, from the feed checks' attributes. */
export function syncText(checks: ReadonlyArray<Record<string, unknown> | undefined>): string {
  const first = (key: string): number | undefined => checks.map(attributes => Number(attributes?.[key] ?? Number.NaN)).find(Number.isFinite);
  const lag = first("house_clock_lag_s");
  if (lag !== undefined) return tf("house.synced", { lag: Math.max(0, lag).toFixed(1) });
  const gap = first("readings_apart_s");
  return gap !== undefined ? tf("house.readings_apart", { gap: gap.toFixed(1) }) : "";
}
