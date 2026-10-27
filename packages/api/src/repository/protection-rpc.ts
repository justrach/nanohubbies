/** New Worker code can temporarily reach an older Durable Object during a
 * global rollout. Keep existing browser reads available; never downgrade a
 * revision-checked edit to an unconditional legacy writer. */
export function missingProtectionMethod(error:unknown,method:"protectionConfiguration"|"configureProtection") {
  return error instanceof Error&&error.message.includes(`does not implement the method "${method}"`);
}
export const protectionUpdating=()=>Response.json({error:"Protection administration is updating; inspect the rules again shortly"},{status:503,headers:{"Retry-After":"5","Cache-Control":"private, no-store"}});
