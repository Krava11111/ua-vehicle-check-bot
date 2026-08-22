import assert from "node:assert/strict";
import test from "node:test";

import {
  clearUserReports,
  getUserReport,
  listUserReports,
  rememberUserReport,
} from "../src/user-report-history.js";
import type {
  D1PreparedStatementLike,
  D1ResultLike,
  Env,
  VehicleReportData,
} from "../src/types.js";

class Statement implements D1PreparedStatementLike {
  values: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly rows: Array<Record<string, unknown>> = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, results: this.rows as T[] };
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, meta: { changes: 1 } };
  }
}

function database(rows: Array<Record<string, unknown>> = []) {
  const statements: Statement[] = [];
  return {
    statements,
    prepare(sql: string) {
      const statement = new Statement(sql, rows);
      statements.push(statement);
      return statement;
    },
    async batch<T = Record<string, unknown>>() {
      return [] as D1ResultLike<T>[];
    },
  };
}

function report(): VehicleReportData {
  return {
    schemaVersion: 1,
    reference: "AA1234BB.abcdef123456",
    collectedAt: "2026-08-20T12:00:00Z",
    match: {
      key: "WVWZZZ3CZHE123456",
      matchedBy: "VIN",
      candidates: 1,
      vehicle: {
        v: "WVWZZZ3CZHE123456", p: "AA1234BB", b: "VOLKSWAGEN", m: "PASSAT",
        y: 2017, c: "ЧОРНИЙ", k: "ЛЕГКОВИЙ", bt: "СЕДАН", pu: null,
        f: "БЕНЗИН", ec: 1984, ow: null, tw: null, e: [],
      },
    },
    wanted: { status: "clear", checkedAt: null, sourceUrl: null, matches: [] },
    insurance: { status: "unavailable", source: "MTSBU", checkUrl: "https://policy.mtsbu.ua/Search/Main/" },
    externalHistory: { auctions: "empty", marketplace: "empty", odometer: "empty", data: null, bidfaxUrl: null },
    source: { label: "МВС", url: "https://data.gov.ua", updatedAt: null, historyStartYear: 2013, maxEventsPerVehicle: 50 },
  };
}

test("stores one bounded history entry per user and vehicle", async () => {
  const db = database();
  const env = { HISTORY_DB: db } as unknown as Env;
  await rememberUserReport(env, 111, 222, report());
  assert.equal(db.statements.length, 2);
  assert.match(db.statements[0]!.sql, /ON CONFLICT \(telegram_user_id, vehicle_key\)/);
  assert.equal(db.statements[0]!.values[0], "111");
  assert.equal(db.statements[0]!.values[3], "WVWZZZ3CZHE123456");
  assert.match(db.statements[1]!.sql, /LIMIT 50/);
});

test("lists and opens only rows scoped to the requesting Telegram user", async () => {
  const row = {
    id: 7,
    report_reference: "AA1234BB.abcdef123456",
    vehicle_key: "WVWZZZ3CZHE123456",
    vin: "WVWZZZ3CZHE123456",
    plate: "AA1234BB",
    brand: "VOLKSWAGEN",
    model: "PASSAT",
    make_year: 2017,
    last_viewed_at: "2026-08-20T12:00:00Z",
    view_count: 2,
  };
  const db = database([row]);
  const env = { HISTORY_DB: db } as unknown as Env;
  const listed = await listUserReports(env, 111);
  const opened = await getUserReport(env, 111, 7);
  assert.equal(listed[0]?.id, 7);
  assert.equal(opened?.vin, "WVWZZZ3CZHE123456");
  assert.match(db.statements[0]!.sql, /WHERE telegram_user_id = \?/);
  assert.deepEqual(db.statements[0]!.values, ["111", 10]);
  assert.match(db.statements[1]!.sql, /WHERE id = \? AND telegram_user_id = \?/);
  assert.deepEqual(db.statements[1]!.values, [7, "111"]);
});

test("clears only the requesting user's rows", async () => {
  const db = database();
  const changed = await clearUserReports({ HISTORY_DB: db } as unknown as Env, 111);
  assert.equal(changed, 1);
  assert.match(db.statements[0]!.sql, /WHERE telegram_user_id = \?/);
  assert.deepEqual(db.statements[0]!.values, ["111"]);
});
