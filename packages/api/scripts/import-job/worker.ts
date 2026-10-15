/** Isolated import recovery fixture; never deployed. */
import api from "../../src/index";
import { Sequencer as BaseSequencer } from "../../src/sequencer";
import { sessionCookie, settings } from "../../src/auth";
export * from "../../src/index";
export class Sequencer extends BaseSequencer {
  override appendImport(
    id: string,
    batch: number,
    files: { path: string; text: string }[],
  ) {
    const result = super.appendImport(id, batch, files);
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS fixture_reply (id INTEGER PRIMARY KEY)",
    );
    if (!sql.exec("SELECT id FROM fixture_reply").toArray().length) {
      sql.exec("INSERT INTO fixture_reply VALUES (1)");
      throw new Error("fixture lost append reply");
    }
    return result;
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/fixture/session") {
      const user = {
        id: url.searchParams.get("id") ?? "alice",
        name: "Fixture",
        email: null,
        provider: "dev" as const,
      };
      return Response.json(
        {},
        {
          headers: {
            "Set-Cookie": await sessionCookie(user, settings(env, url), url),
          },
        },
      );
    }
    return api.fetch(request, env);
  },
};
