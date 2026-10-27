/** This entrypoint is never referenced by production configuration. */
import app, * as actual from "../../apps/web/worker";
import { hostedApp } from "../hosted-git-fixture/backend";
import { recoveryObject } from "./objects";
import { control } from "./control";

export const Sequencer = recoveryObject(actual.Sequencer);
export const Agent = recoveryObject(actual.Agent);
export const Room = recoveryObject(actual.Room);
export const Driver = recoveryObject(actual.Driver);
export const Hub = recoveryObject(actual.Hub);
export const ImportJob = recoveryObject(actual.ImportJob);
export const Account = recoveryObject(actual.Account);
export const Lane = recoveryObject(actual.Lane);
export const Packer = recoveryObject(actual.Packer);

export default hostedApp({
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/__fixture/recovery")
      return control(request, env);
    return app.fetch(request as Parameters<typeof app.fetch>[0], env, ctx);
  },
});
