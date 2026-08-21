import assert from "node:assert/strict";
import test from "node:test";

import { getUserLanguage, setUserLanguage } from "../src/user-preferences.js";
import type { D1PreparedStatementLike, D1ResultLike, Env } from "../src/types.js";

class Statement implements D1PreparedStatementLike {
  values: unknown[] = [];

  constructor(readonly sql: string, private readonly language: string | null) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.language ? ({ language: this.language } as T) : null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, results: [] };
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return { success: true, meta: { changes: 1 } };
  }
}

function database(language: string | null) {
  const statements: Statement[] = [];
  return {
    statements,
    prepare(sql: string) {
      const statement = new Statement(sql, language);
      statements.push(statement);
      return statement;
    },
    async batch<T = Record<string, unknown>>() {
      return [] as D1ResultLike<T>[];
    },
  };
}

test("reads only supported saved languages for one Telegram user", async () => {
  const db = database("ru");
  const language = await getUserLanguage({ HISTORY_DB: db } as unknown as Env, 123);
  assert.equal(language, "ru");
  assert.match(db.statements[0]!.sql, /WHERE telegram_user_id = \?/);
  assert.deepEqual(db.statements[0]!.values, ["123"]);

  const invalid = database("en");
  assert.equal(await getUserLanguage({ HISTORY_DB: invalid } as unknown as Env, 123), null);
});

test("upserts the selected language", async () => {
  const db = database(null);
  await setUserLanguage({ HISTORY_DB: db } as unknown as Env, 123, "uk");
  assert.match(db.statements[0]!.sql, /ON CONFLICT \(telegram_user_id\)/);
  assert.equal(db.statements[0]!.values[0], "123");
  assert.equal(db.statements[0]!.values[1], "uk");
});
