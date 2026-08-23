import assert from "node:assert/strict";
import test from "node:test";

import { isPartnerActivated, recordPartnerActivation } from "../src/partner-activation.js";
import type { D1PreparedStatementLike, D1ResultLike, Env } from "../src/types.js";

class Statement implements D1PreparedStatementLike {
  values: unknown[] = [];

  constructor(readonly sql: string, private readonly activeId: string | null) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.activeId === this.values[0]
      ? ({ telegram_user_id: this.activeId } as T)
      : null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, results: [] };
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, meta: { changes: 1 } };
  }
}

function database(activeId: string | null) {
  const statements: Statement[] = [];
  return {
    statements,
    prepare(sql: string) {
      const statement = new Statement(sql, activeId);
      statements.push(statement);
      return statement;
    },
    async batch<T = Record<string, unknown>>() {
      return [] as D1ResultLike<T>[];
    },
  };
}

test("records a real Telegram /start activation", async () => {
  const db = database(null);
  await recordPartnerActivation({ HISTORY_DB: db } as unknown as Env, 123);
  assert.match(db.statements[0]!.sql, /ON CONFLICT \(telegram_user_id\)/);
  assert.equal(db.statements[0]!.values[0], "123");
});

test("checks activation by the same Telegram user id", async () => {
  const active = database("123");
  const missing = database("999");
  assert.equal(await isPartnerActivated({ HISTORY_DB: active } as unknown as Env, 123), true);
  assert.equal(await isPartnerActivated({ HISTORY_DB: missing } as unknown as Env, 123), false);
});
