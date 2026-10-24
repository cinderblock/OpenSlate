import type { Subject } from "./schema";

/**
 * Google's Civic Information API (Voting Information Project data): the list
 * of elections, and the contests on an address's ballot. One adapter for every
 * way OpenSlate reaches it: a browser with the user's own key, the public relay
 * (apps/poll-cache), and a self-hosted apps/server. Each builds requests with
 * `civicUrl` and reads answers with `readCivic`, so all three give the same
 * result. See plans/google-civic-two-ways.md.
 *
 * Google's terms: keys stay confidential (a user's own key lives only in their
 * browser; a relay's only in its secrets), and answers aren't cached longer
 * than Google's cache headers allow.
 */

export const CIVIC_API_BASE = "https://civicinfo.googleapis.com/civicinfo/v2";

export interface CivicElection {
  id: string;
  name: string;
  /** "YYYY-MM-DD". */
  electionDay: string;
  ocdDivisionId?: string;
}

export interface CivicChoice {
  name: string;
  party?: string;
}

export interface CivicContest {
  subject: Subject;
  /** Candidates, or a measure's ballot responses ("Yes", "No"). */
  candidates: CivicChoice[];
  /** "Vote for up to N": how many selections the contest allows. */
  voteFor?: number;
  /**
   * The electoral district as Civic Info reports it: `scope` is one of its
   * fixed values (`congressional`, `stateUpper`, `stateLower`, `citywide`, …)
   * and `id` is the district number relative to that scope ("34").
   */
  district?: { name?: string; scope?: string; id?: string };
}

/** The contests on one address's ballot. */
export interface CivicBallot {
  contests: CivicContest[];
  /** Two-letter state of the normalized address, lowercased ("ca"). */
  state?: string;
}

/** A Civic API request URL. The key goes in the query string, as Google requires. */
export function civicUrl(
  path: "elections" | "voterinfo",
  key: string,
  params: Record<string, string> = {},
  base: string = CIVIC_API_BASE,
): URL {
  const url = new URL(`${base}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  return url;
}

/** A failed Civic API answer: the HTTP status and Google's own reason. */
export class CivicError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CivicError";
  }
}

/** The JSON of a Civic API answer, or a `CivicError` carrying Google's reason. */
export async function readCivic(response: Response): Promise<unknown> {
  if (!response.ok) {
    const reason = civicErrorMessage(await response.text().catch(() => ""));
    throw new CivicError(
      response.status,
      `Google answered ${response.status}${reason ? `: ${reason}` : ""}`,
    );
  }
  return response.json();
}

/** The `elections` answer, trimmed to what OpenSlate reads, by date. */
export function parseCivicElections(json: unknown): CivicElection[] {
  const raw = (json as { elections?: unknown })?.elections;
  if (!Array.isArray(raw)) return [];
  const out: CivicElection[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    const { id, name, electionDay, ocdDivisionId } = e;
    if (typeof id !== "string" || typeof electionDay !== "string") continue;
    out.push({
      id,
      name: typeof name === "string" ? name : `Election ${id}`,
      electionDay,
      ...(typeof ocdDivisionId === "string" ? { ocdDivisionId } : {}),
    });
  }
  return out.sort((a, b) => a.electionDay.localeCompare(b.electionDay));
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

/** The parts of a `voterinfo` answer OpenSlate reads. */
export interface VipVoterInfo {
  contests?: VipContest[];
  election?: { id?: string; name?: string; electionDay?: string };
  normalizedInput?: { state?: string };
}

/**
 * A `voterinfo` answer → the ballot OpenSlate uses. Civic Info contests carry
 * no stable per-contest id, so each gets a deterministic one from the election
 * id, district and office or title: anyone normalizing the same contest derives
 * the same id, which lets endorsements from different issuers line up.
 */
export function normalizeVoterInfo(data: VipVoterInfo): CivicBallot {
  const state = data.normalizedInput?.state?.trim().toLowerCase();
  return {
    contests: normalizeContests(data),
    ...(state ? { state } : {}),
  };
}

function normalizeContests(data: VipVoterInfo): CivicContest[] {
  const electionId = data.election?.id ?? "";
  const electionDay = data.election?.electionDay ?? data.election?.id;

  return (data.contests ?? []).map((contest, index): CivicContest => {
    const label = contest.office ?? contest.referendumTitle ?? `Contest ${index + 1}`;
    const district = contest.district?.id ?? contest.district?.name ?? "";
    const subject: Subject = {
      title: label,
      id: `vip:${[electionId, district, slug(label)].filter(Boolean).join(":")}`,
      kind: contest.type === "Referendum" ? "measure" : "race",
    };
    if (contest.district?.name) subject.jurisdiction = contest.district.name;
    if (electionDay) subject.election = electionDay;

    const candidates: CivicChoice[] = (contest.candidates ?? [])
      .filter(
        (c): c is { name: string; party?: string } =>
          typeof c.name === "string" && c.name.length > 0,
      )
      .map((c) => (c.party ? { name: c.name, party: c.party } : { name: c.name }));

    // For referendums, the ballot responses ("Yes"/"No"/etc.) are the choices,
    // so each can be given a stance like a race's candidates.
    const responses: CivicChoice[] = (contest.referendumBallotResponses ?? [])
      .filter((r): r is string => typeof r === "string" && r.length > 0)
      .map((r) => ({ name: r }));

    const result: CivicContest = {
      subject,
      candidates: candidates.length > 0 ? candidates : responses,
    };
    if (typeof contest.numberVotingFor === "number" && contest.numberVotingFor > 0) {
      result.voteFor = contest.numberVotingFor;
    }
    if (contest.district) {
      const { name, scope, id } = contest.district;
      result.district = {
        ...(name ? { name } : {}),
        ...(scope ? { scope } : {}),
        ...(id ? { id } : {}),
      };
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

/**
 * The human-readable reason in Google's error JSON, else the raw body cut
 * short, so the UI can show something actionable ("API key not valid").
 */
export function civicErrorMessage(body: string): string {
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
