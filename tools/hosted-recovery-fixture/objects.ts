/** Native recovery instrumentation for disposable fixtures only. */
export interface RecoveryEnv {
  HOSTED_BACKEND_KEY?: string;
  HOSTED_FIXTURE_EXPIRES?: string;
  HOSTED_REPO_RECOVERY?: string;
  OBJECTS?: R2Bucket;
}
type Constructor = new (...args: any[]) => object;
const bookmark = /^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/;

export function recoveryObject<T extends Constructor>(
  Base: T,
  binding?: string,
) {
  return class extends Base {
    #state: DurableObjectState;
    #environment: RecoveryEnv;
    constructor(...args: any[]) {
      super(...args);
      this.#state = args[0];
      this.#environment = args[1];
      if (binding && this.#environment.HOSTED_REPO_RECOVERY === "1") {
        const entry = { binding, id: this.#state.id.toString() };
        // Registration completes before RPC delivery, including instances created
        // by internal application RPCs. The controller retains this outside R2.
        this.#state.blockConcurrencyWhile(async () => {
          await this.#environment.OBJECTS!.put(
            "__fixture/inventory/" + binding + "/" + entry.id,
            JSON.stringify(entry),
          );
        });
      }
    }
    #authorize(key: string) {
      const expected = this.#environment.HOSTED_BACKEND_KEY;
      const deadline = Number(this.#environment.HOSTED_FIXTURE_EXPIRES);
      if (
        !/^[a-f0-9]{64}$/.test(expected ?? "") ||
        key !== expected ||
        !Number.isSafeInteger(deadline) ||
        deadline <= Date.now()
      )
        throw Error("Fixture recovery access denied");
    }
    async fixtureRecoveryWrite(key: string, value: string) {
      this.#authorize(key);
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        throw Error("Invalid fixture marker");
      this.#state.storage.transactionSync(() => {
        this.#state.storage.sql.exec(
          "CREATE TABLE IF NOT EXISTS fixture_recovery_marker (marker TEXT PRIMARY KEY, payload BLOB, note TEXT, large_integer INTEGER)",
        );
        this.#state.storage.sql.exec("DELETE FROM fixture_recovery_marker");
        this.#state.storage.sql.exec(
          "INSERT INTO fixture_recovery_marker VALUES (?, ?, ?, CAST('9223372036854775807' AS INTEGER))",
          value,
          Uint8Array.of(0, 255, 17).buffer,
          value + "\0検証🚀",
        );
        this.#state.storage.kv.put("fixture-recovery-marker", {
          value,
          bytes: Uint8Array.of(0, 255, 17),
        });
      });
      await this.#state.storage.sync();
      return this.fixtureRecoveryRead(key);
    }
    async fixtureRecoveryRead(key: string) {
      this.#authorize(key);
      const exists =
        this.#state.storage.sql
          .exec<{
            name: string;
          }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_recovery_marker'",
          )
          .toArray().length === 1;
      const sql = exists
        ? this.#state.storage.sql
            .exec(
              "SELECT marker, hex(payload) AS payload, hex(note) AS note, CAST(large_integer AS TEXT) AS large_integer FROM fixture_recovery_marker",
            )
            .toArray()
        : [];
      const kv = this.#state.storage.kv.get<{
        value: string;
        bytes: Uint8Array;
      }>("fixture-recovery-marker");
      return {
        id: this.#state.id.toString(),
        sql,
        kv: kv ? { value: kv.value, bytes: Array.from(kv.bytes) } : null,
        alarm: await this.#state.storage.getAlarm(),
      };
    }
    async fixtureRecoveryCheckpoint(key: string) {
      this.#authorize(key);
      await this.#state.storage.sync();
      const point = await this.#state.storage.getCurrentBookmark();
      if (!bookmark.test(point))
        throw Error("Unexpected provider recovery bookmark");
      return { id: this.#state.id.toString(), bookmark: point };
    }
    async fixtureRecoveryInspect(key: string) {
      this.#authorize(key);
      const tables = this.#state.storage.sql
        .exec<{
          name: string;
        }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__cf_kv' AND name NOT GLOB '_cf_*' ORDER BY name")
        .toArray();
      const names = new Set(tables.map((row) => row.name));
      const pending = names.has("pending")
        ? this.#state.storage.sql
            .exec<{ n: number }>("SELECT COUNT(*) AS n FROM pending")
            .one().n
        : 0;
      const imported = names.has("import_state")
        ? this.#state.storage.sql
            .exec<{ body: string }>("SELECT body FROM import_state WHERE id=1")
            .toArray()[0]
        : undefined;
      return {
        id: this.#state.id.toString(),
        alarm: await this.#state.storage.getAlarm(),
        webSockets: this.#state.getWebSockets().length,
        tables,
        pending,
        importPhase: imported ? JSON.parse(imported.body).status.phase : null,
      };
    }
    async fixtureRecoveryLose(key: string) {
      this.#authorize(key);
      await this.#state.storage.deleteAlarm();
      await this.#state.storage.deleteAll();
      await this.#state.storage.sync();
      return this.fixtureRecoveryRead(key);
    }
    async fixtureRecoverySchedule(key: string, point: string) {
      this.#authorize(key);
      if (typeof point !== "string" || !bookmark.test(point))
        throw Error("Invalid recovery bookmark");
      return {
        undoBookmark:
          await this.#state.storage.onNextSessionRestoreBookmark(point),
      };
    }
    fixtureRecoveryRestart(key: string): never {
      this.#authorize(key);
      this.#state.abort("Disposable recovery fixture restart");
      throw Error("Provider restart did not abort");
    }
  };
}
