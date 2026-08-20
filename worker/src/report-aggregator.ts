import { sha256Prefix } from "./index-client.js";
import { orderedEvents } from "./presentation.js";
import type {
  IndexManifest,
  ExternalVehicleHistory,
  VehicleCandidate,
  VehicleMatch,
  VehicleReportData,
  WantedCheck,
} from "./types.js";
import type { ProviderRefreshResult } from "./external-providers.js";

export async function candidateId(vehicleKey: string): Promise<string> {
  return sha256Prefix(vehicleKey, 12);
}

export async function reportReference(match: VehicleMatch): Promise<string> {
  const plate = match.vehicle.p ?? "N";
  return `${plate}.${await candidateId(match.key)}`;
}

export function referenceParts(reference: string): { plate: string | null; candidateId: string } | null {
  const match = /^([A-Z0-9]{1,12})\.([0-9a-f]{12})$/.exec(reference);
  if (!match?.[1] || !match[2]) return null;
  return { plate: match[1] === "N" ? null : match[1], candidateId: match[2] };
}

export async function buildVehicleCandidates(matches: VehicleMatch[]): Promise<VehicleCandidate[]> {
  return Promise.all(matches.map(async (match) => {
    const events = orderedEvents(match.vehicle.e ?? []);
    const dates = events.map((event) => event[0]).filter((value): value is string => Boolean(value));
    return {
      candidateId: await candidateId(match.key),
      vehicleKey: match.key,
      vin: match.vehicle.v,
      plate: match.vehicle.p,
      brand: match.vehicle.b,
      model: match.vehicle.m,
      year: match.vehicle.y,
      color: match.vehicle.c,
      fuel: match.vehicle.f,
      engineCapacity: match.vehicle.ec,
      bodyType: match.vehicle.bt,
      vehicleType: match.vehicle.k,
      firstSeenAt: dates[0] ?? null,
      lastSeenAt: dates.at(-1) ?? null,
      registrationsCount: events.length,
      confidence: match.vehicle.v ? "HIGH" : match.key.startsWith("F:") || match.key.startsWith("S:") ? "MEDIUM" : "LOW",
    };
  }));
}

export class VehicleReportAggregator {
  static async build(
    match: VehicleMatch,
    manifest: IndexManifest,
    wanted: WantedCheck,
    configuredHistoryStartYear = 2013,
    external: ExternalVehicleHistory | null = null,
    providerStatus: ProviderRefreshResult = {
      autoRia: "not_configured",
      auctions: "not_configured",
      checkedAt: new Date().toISOString(),
    },
    bidfaxBaseUrl = "https://bidfax.co/",
  ): Promise<VehicleReportData> {
    const availability = (
      connection: ProviderRefreshResult["autoRia"],
      count: number,
    ): "available" | "empty" | "not_connected" | "unavailable" => {
      if (connection === "not_configured") return "not_connected";
      if (connection === "unavailable") return "unavailable";
      return count ? "available" : "empty";
    };
    const vin = match.vehicle.v;
    return {
      schemaVersion: 1,
      reference: await reportReference(match),
      collectedAt: new Date().toISOString(),
      match,
      wanted,
      insurance: {
        status: "unavailable",
        source: "MTSBU",
        checkUrl: "https://policy.mtsbu.ua/Search/Main/",
      },
      externalHistory: {
        auctions: availability(providerStatus.auctions, external?.auctions.length ?? 0),
        marketplace: availability(providerStatus.autoRia, external?.marketplace.length ?? 0),
        odometer: !external?.storageAvailable
          ? "not_connected"
          : external.mileage.length ? "available" : "empty",
        data: external,
        bidfaxUrl: vin ? bidfaxBaseUrl : null,
      },
      source: {
        label: manifest.source_label,
        url: manifest.source_url,
        updatedAt: manifest.dataset_updated_at ?? null,
        historyStartYear: manifest.history_start_year ?? configuredHistoryStartYear,
        maxEventsPerVehicle: manifest.max_events_per_vehicle,
      },
    };
  }
}
