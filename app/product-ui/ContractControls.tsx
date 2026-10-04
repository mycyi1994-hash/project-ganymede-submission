"use client";

import { useEffect, useState } from "react";
import { FUND_DEPLOYMENT, fundRpc } from "@/lib/xstocks/fund";
import { KNOWN_ADDRESSES, readControls, type ContractControl } from "@/lib/xstocks/permissions";
import { Icon } from "./Icons";

// Who can do what to each USTX contract, read by this browser from X Layer Testnet, so a customer
// does not have to take the page's word for it.

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const addressUrl = (address: string) => `${FUND_DEPLOYMENT.explorerUrl}/address/${address}`;

function Holder({ holder }: { holder: string | null }) {
  if (!holder) return <>None</>;
  return <a className="gmd-inline-tx" href={addressUrl(holder)} target="_blank" rel="noreferrer">{KNOWN_ADDRESSES[holder] ?? short(holder)}<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a>;
}

export default function ContractControls() {
  const [controls, setControls] = useState<ContractControl[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readControls(fundRpc({ signal: controller.signal })).then(setControls).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const paused = controls?.filter(control => control.paused).map(control => control.name) ?? [];
  return <section className="gmd-proof-history gmd-controls" id="proof-controls" aria-labelledby="controls-title">
    <header className="gmd-section-heading"><h2 id="controls-title">Who controls the contracts</h2><span>{failed ? "X Layer Testnet could not be read" : controls ? "Read from X Layer Testnet by your browser" : "Reading X Layer Testnet…"}</span></header>
    <p className="gmd-caption">No one can issue USTX except by investing at the recorded NAV, and no one can move a holder’s USTX. {controls && (paused.length ? `Paused now: ${paused.join(", ")}.` : "Nothing is paused now.")}</p>
    <div className="gmd-data-table-scroll"><table className="gmd-table"><thead><tr><th>Contract</th><th>Roles</th><th>Status</th><th>What the roles can and cannot do</th></tr></thead><tbody>
      {(controls ?? []).map(control => <tr key={control.address}>
        <th scope="row"><a className="gmd-inline-tx" href={addressUrl(control.address)} target="_blank" rel="noreferrer">{control.name}<Icon name="external" size={12} /><span className="gmd-sr-only"> (opens in a new tab)</span></a></th>
        <td>{control.roles.length ? control.roles.map(role => <div key={role.label}>{role.label}: <Holder holder={role.holder} /></div>) : "No administrator"}</td>
        <td>{!control.pausable ? "Cannot be paused" : control.paused === null ? "Not read" : control.paused ? <b>Paused</b> : "Active"}</td>
        <td><p>{control.can}</p><p><b>Cannot:</b> {control.cannot}</p></td>
      </tr>)}
    </tbody></table>{!controls && <p className="gmd-caption">{failed ? "Reload the page in a moment, or read each contract on OKX Explorer." : "Loading…"}</p>}</div>
  </section>;
}
