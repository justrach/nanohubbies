/** This entrypoint is never referenced by production configuration. */
import app, * as actual from "../../apps/web/worker";
import { hostedApp } from "../hosted-git-fixture/backend";
import { recoveryObject } from "./objects";
import { control } from "./control";
import { repositoryRoute } from "./repository-control";

export const Sequencer = recoveryObject(actual.Sequencer, "SEQUENCER");
export const Agent = recoveryObject(actual.Agent, "AGENT");
export const Room = recoveryObject(actual.Room, "ROOM");
export const Driver = recoveryObject(actual.Driver, "DRIVER");
export const Hub = recoveryObject(actual.Hub, "HUB");
export const ImportJob = recoveryObject(actual.ImportJob, "IMPORT_JOB");
export const Account = recoveryObject(actual.Account, "ACCOUNT");
export const Lane = recoveryObject(actual.Lane, "LANE");
export const Packer = recoveryObject(actual.Packer, "PACKER");

export default hostedApp({
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const repository = await repositoryRoute(request, env, ctx, app);
    if (repository) return repository;
    if (new URL(request.url).pathname === "/__fixture/recovery")
      return control(request, env);
    return app.fetch(request as Parameters<typeof app.fetch>[0], env, ctx);
  },
});
