import type { Subject } from "@openslate/core";

export interface Candidate {
  name: string;
  party?: string;
}

export interface BallotContest {
  subject: Subject;
  candidates: Candidate[];
  /** "Vote for up to N" — how many selections are allowed on this contest. */
  voteFor?: number;
}

export interface BallotSource {
  /** Resolve an address (+ optional election) to ballot contests with candidates. */
  lookup(address: string, electionId?: string): Promise<BallotContest[]>;
}

export interface Election {
  id: string;
  name: string;
  electionDay: string;
  ocdDivisionId?: string;
}

export interface ElectionsSource {
  list(): Promise<Election[]>;
}

interface CivicConfig {
  apiKey: string;
  base: string;
}

function readCivicConfig(): CivicConfig | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  const base = process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com/civicinfo/v2";
  return { apiKey, base };
}

export function createElectionsSource(): ElectionsSource | null {
  const config = readCivicConfig();
  if (!config) return null;
  return {
    async list(): Promise<Election[]> {
      const url = new URL(`${config.base}/elections`);
      url.searchParams.set("key", config.apiKey);
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `elections source responded ${response.status}: ${extractGoogleError(body)}`,
        );
      }
      const data = (await response.json()) as { elections?: Election[] };
      return data.elections ?? [];
    },
  };
}

/**
 * Google Civic Information API adapter (`voterInfoQuery`) — a stateless proxy that
 * surfaces Voting Information Project data. Reads GOOGLE_API_KEY (a Google
 * Cloud API key) and optionally GOOGLE_API_BASE. The address is forwarded
 * upstream and is never stored or logged. Returns `null` when no key is configured,
 * so the app degrades gracefully to manual subject entry.
 *
 * NOTE: this is an OPTIONAL, self-host-only convenience and is NOT the same as the
 * Voting Information Tool customizer (a client-side widget). Using this proxy means
 * running a central server, which is opt-in — the default app is fully client-side.
 * Swap this adapter (or just `normalize`) for another source; that's the point of
 * the BallotSource interface.
 */
export function createBallotSource(): BallotSource | null {
  const config = readCivicConfig();
  if (!config) return null;

  return {
    async lookup(address: string, electionId?: string): Promise<BallotContest[]> {
      const url = new URL(`${config.base}/voterinfo`);
      url.searchParams.set("address", address);
      url.searchParams.set("key", config.apiKey);
      if (electionId) url.searchParams.set("electionId", electionId);

      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = extractGoogleError(body);
        throw new Error(`ballot source responded ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      return normalize((await response.json()) as VipVoterInfo);
    },
  };
}

interface VipContest {
  type?: string;
  office?: string;
  referendumTitle?: string;
  district?: { name?: string; id?: string; scope?: string };
  candidates?: Array<{ name?: string; party?: string }>;
  numberElected?: number;
  numberVotingFor?: number;
  referendumBallotResponses?: string[];
}

interface VipVoterInfo {
  contests?: VipContest[];
  election?: { id?: string; name?: string; electionDay?: string };
}

// Civic Info contests carry no stable per-contest id, so we synthesize a
// deterministic one from the election id, district, and office/title. Anyone
// normalizing the same contest (with the same electionId) derives the same id,
// which is what lets endorsements from different issuers line up on one race.
function normalize(data: VipVoterInfo): BallotContest[] {
  const electionId = data.election?.id ?? "";
  const electionDay = data.election?.electionDay ?? data.election?.id;

  return (data.contests ?? []).map((contest, index): BallotContest => {
    const label = contest.office ?? contest.referendumTitle ?? `Contest ${index + 1}`;
    const district = contest.district?.id ?? contest.district?.name ?? "";
    const subject: Subject = {
      title: label,
      id: `vip:${[electionId, district, slug(label)].filter(Boolean).join(":")}`,
      kind: contest.type === "Referendum" ? "measure" : "race",
    };
    if (contest.district?.name) subject.jurisdiction = contest.district.name;
    if (electionDay) subject.election = electionDay;

    const candidates: Candidate[] = (contest.candidates ?? [])
      .filter(
        (c): c is { name: string; party?: string } =>
          typeof c.name === "string" && c.name.length > 0,
      )
      .map((c) => (c.party ? { name: c.name, party: c.party } : { name: c.name }));

    // For referendums, surface the ballot responses ("Yes"/"No"/etc.) as choices so
    // the user can stance each one just like a race's candidates.
    const responses: Candidate[] = (contest.referendumBallotResponses ?? [])
      .filter((r): r is string => typeof r === "string" && r.length > 0)
      .map((r) => ({ name: r }));

    const finalChoices = candidates.length > 0 ? candidates : responses;

    const result: BallotContest = { subject, candidates: finalChoices };
    if (typeof contest.numberVotingFor === "number" && contest.numberVotingFor > 0) {
      result.voteFor = contest.numberVotingFor;
    }
    return result;
  });
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Pull the human-readable reason out of Google's error JSON, falling back to a
// truncated raw body so the picker can show something actionable.
function extractGoogleError(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    const reasons = parsed.error?.errors?.map((e) => e.reason ?? e.message).filter(Boolean) ?? [];
    const summary = parsed.error?.message ?? "";
    return [summary, reasons.join(", ")].filter(Boolean).join(" — ") || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
