import { useEffect, useState } from "react";

/**
 * Tiny localStorage-backed string preference. Used for small user-controlled
 * settings (address, selected election) that don't justify the IndexedDB-backed
 * TanStack DB collection plumbing. Address is forwarded to the server's ballot
 * proxy on demand but never persisted server-side.
 */
function usePersistedString(key: string): [string, (next: string) => void] {
  const [value, set] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      // private mode etc. — silently ignore; the in-memory value still works.
    }
  }, [key, value]);
  return [value, set];
}

export const useAddress = (): [string, (next: string) => void] =>
  usePersistedString("openslate.address.v1");

export const useElectionId = (): [string, (next: string) => void] =>
  usePersistedString("openslate.electionId.v1");

export const useActiveIdentityKey = (): [string, (next: string) => void] =>
  usePersistedString("openslate.activeIdentityKey.v1");
