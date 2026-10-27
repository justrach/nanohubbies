import type { ReviewSnapshot, RunnerSource } from "@swarm/api/review";
import { field } from "./shared";

type Policy = NonNullable<ReviewSnapshot["policies"]>[number];
export function CheckSources({names,sources,pins,onChange,disabled}:{names:string[];sources:RunnerSource[];pins:NonNullable<Policy["checkSources"]>;onChange:(pins:NonNullable<Policy["checkSources"]>)=>void;disabled:boolean}) {
  if (!names.length) return null;
  return <fieldset className="space-y-3 border-t border-line pt-4">
    <legend className="text-sm font-medium text-ink">Expected check sources</legend>
    <p className="text-xs leading-5 text-muted">Pin each check to a trusted runner registration. A sandbox pool can share one registration. Matching protection rules must agree on the source.</p>
    {names.map(name=>{
      const pin=pins.find(pin=>pin.name===name),source=sources.find(source=>source.id===pin?.runner);
      return <label key={name} className="block min-w-0 space-y-1 text-xs text-muted">
        <span className="block break-all"><code>{name}</code> source</span>
        <select className={field} aria-label={`Expected source for ${name}`} disabled={disabled} value={pin?.runner??""} onChange={event=>onChange([...pins.filter(pin=>pin.name!==name),...(event.target.value?[{name,runner:event.target.value}]:[])])}>
          <option value="">Any trusted runner</option>
          {pin&&!source&&<option value={pin.runner}>Unavailable source · {pin.runner}</option>}
          {sources.filter(source=>!source.revoked||source.id===pin?.runner).map(source=><option key={source.id} value={source.id}>{source.name}{source.revoked?" · revoked":""} · {source.id.slice(0,8)}</option>)}
        </select>
        {pin&&(!source||source.revoked)&&<span className="block leading-5">This source cannot satisfy the check. Ask the repository owner to configure an active runner, then update this pin.</span>}
      </label>;
    })}
    {!sources.some(source=>!source.revoked)&&<p className="text-xs leading-5 text-muted">No active runner registrations. The repository owner can configure runners on the Actions page.</p>}
  </fieldset>;
}
