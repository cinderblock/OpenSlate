import { useAddress } from "../lib/address";
import { formatLocalDate } from "../lib/dates";
import { ONLINE_LOOKUPS, type OnlineLookup, useLookupConsent } from "../lib/lookups";
import { Switch } from "./ui/Switch";

/**
 * Settings: which address lookups may receive an address (each is opted in
 * to where it's used, under Where you vote; this is where to see and revoke
 * them), and the address this browser remembers.
 */
export function AddressLookupsPanel() {
  const { consents, grant, revoke } = useLookupConsent();
  const [address, setAddress] = useAddress();

  return (
    <section className="panel">
      <h2>Address lookups</h2>
      <p className="hint">
        Finding your districts on the map or from your location happens on this device. Typing an
        address sends it to the service you pick, and only once you've allowed that service.
      </p>
      <div className="card">
        <ul className="position-list">
          {(Object.keys(ONLINE_LOOKUPS) as OnlineLookup[]).map((key) => {
            const info = ONLINE_LOOKUPS[key];
            const since = consents[key];
            return (
              <li key={key}>
                <Switch isSelected={!!since} onChange={(on) => (on ? grant(key) : revoke(key))}>
                  <strong>{info.name}</strong>
                </Switch>
                <p className="hint">
                  {since ? `Allowed since ${formatLocalDate(since)}. ` : "Not allowed. "}
                  Sends the address to {info.recipient}.{" "}
                  <a href={info.policyUrl} target="_blank" rel="noreferrer">
                    Privacy policy
                  </a>
                </p>
              </li>
            );
          })}
        </ul>
        <p className="hint">
          {address ? (
            <>
              This browser remembers the address <strong>{address}</strong> for next time.{" "}
              <button type="button" className="link" onClick={() => setAddress("")}>
                Forget it
              </button>
            </>
          ) : (
            "No address is remembered in this browser."
          )}
        </p>
      </div>
    </section>
  );
}
