export interface VaultScope {
  repository: string;
  environment: string;
  actor: string;
}
export interface SecretReference {
  repository: string;
  environment: string;
  name: string;
}
export interface CloudflareSecret {
  get(): Promise<string>;
}
export const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export const validName = (name: string) =>
  typeof name === "string" && /^[A-Z_][A-Z0-9_]{0,127}$/.test(name);
export function scopeKey(s: VaultScope) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(s.repository) ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(s.environment) ||
    !s.actor ||
    s.actor.length > 256
  )
    throw Error("Invalid vault scope");
  return `${s.repository}/${s.environment}`;
}
export function references(env: Record<string, unknown>, scope: VaultScope) {
  scopeKey(scope);
  const raw = JSON.parse(
    typeof env.CLOUDFLARE_SECRET_SCOPES === "string"
      ? env.CLOUDFLARE_SECRET_SCOPES
      : "{}",
  ) as Record<string, SecretReference>;
  return Object.entries(raw)
    .filter(
      ([binding, ref]) =>
        /^[A-Z_][A-Z0-9_]{0,127}$/.test(binding) &&
        ref?.repository === scope.repository &&
        ref.environment === scope.environment &&
        validName(ref.name) &&
        typeof (env[binding] as CloudflareSecret)?.get === "function",
    )
    .map(([binding, ref]) => ({ binding, name: ref.name }));
}
export function bindingFor(
  env: Record<string, unknown>,
  scope: VaultScope,
  name: string,
  binding: string,
): CloudflareSecret {
  if (
    !references(env, scope).some(
      (r) => r.name === name && r.binding === binding,
    )
  )
    throw Error(
      "Cloudflare secret binding unavailable in this repository and environment",
    );
  return env[binding] as CloudflareSecret;
}
