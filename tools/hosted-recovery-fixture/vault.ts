/** Private disposable vault; the production Vault entrypoint does not import this. */
import {
  Vault as ActualVault,
  VaultService as ActualService,
} from "../../packages/vault/src/index";
import { recoveryObject } from "./objects";
export const Vault = recoveryObject(ActualVault, "VAULTS");
type FixtureVault = InstanceType<ReturnType<typeof recoveryObject>>;
export class VaultRecoveryService extends ActualService {
  async recovery(key: string, op: string, id: string, point?: string) {
    if (
      !/^[a-f0-9]{64}$/.test(String(this.env.HOSTED_BACKEND_KEY ?? "")) ||
      key !== this.env.HOSTED_BACKEND_KEY ||
      !Number.isSafeInteger(Number(this.env.HOSTED_FIXTURE_EXPIRES)) ||
      Number(this.env.HOSTED_FIXTURE_EXPIRES) <= Date.now()
    )
      throw Error("Fixture recovery access denied");
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid fixture object");
    const object = this.env.VAULTS.get(
      this.env.VAULTS.idFromString(id),
    ) as unknown as FixtureVault;
    switch (op) {
      case "inspect":
        return object.fixtureRecoveryInspect(key);
      case "checkpoint":
        return object.fixtureRecoveryCheckpoint(key);
      case "suspend-alarm":
        return object.fixtureRecoverySuspendAlarm(key);
      case "lose-inspect":
        await object.fixtureRecoveryLose(key);
        return object.fixtureRecoveryInspect(key);
      case "schedule":
        return object.fixtureRecoverySchedule(key, point!);
      case "restart":
        try {
          await object.fixtureRecoveryRestart(key);
        } catch {
          return { restartRequested: true };
        }
        throw Error("Provider restart did not abort");
      default:
        throw Error("Unknown fixture vault recovery operation");
    }
  }
}
export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
