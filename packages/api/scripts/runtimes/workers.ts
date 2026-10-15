// "cloudflare:workers" outside the Workers runtime: only the Durable Object
// base class, which keeps the object's state and bindings.
export class DurableObject<E = unknown> {
  ctx: unknown;
  env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
