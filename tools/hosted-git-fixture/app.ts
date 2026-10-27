/** Opt-in hosted acceptance only. Never referenced by production configuration. */
import app from "../../apps/web/worker";
import { hostedApp } from "./backend";
export * from "../../apps/web/worker";
export default hostedApp(app);
