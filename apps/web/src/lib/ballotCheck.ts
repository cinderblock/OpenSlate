import {
  type BallotListing,
  ballotListing,
  type ChoiceResolution,
  isBallotListing,
  type Position,
  resolveChoice,
  type Subject,
} from "@openslate/core";
import { type DecodedSlate, electionOf } from "./collate";

/**
 * The import translator (SPEC §3.11). Endorsers name candidates their own
 * way: "Don Wagner" for the ballot's "Donald P. (Don) Wagner". Every
 * imported slate's choices are resolved against the imported ballot
 * listings, and a choice that is plainly a listed one is shown under the
 * listing's spelling and id, so the race shows one candidate, not two. The
 * signed payload isn't touched: this rewrites the decoded copy, in memory.
 *
 * Whatever can't be placed stays as written and is reported (`checks`), so
 * the page can say "not on the ballot" and offer to report it.
 */

export interface ChoiceCheck {
  resolution: ChoiceResolution;
  /** The slate's own spelling, when the choice is shown under the listing's. */
  written?: string;
}

/** The ballot listings among the imported slates. */
export function listingOf(slates: DecodedSlate[]): BallotListing {
  return ballotListing(slates.filter((s) => isBallotListing(s.payload)).map((s) => s.payload));
}

/**
 * Show each resolvable choice under the listing's spelling, and attach a
 * check to every position of every slate that isn't itself a listing.
 */
export function translateSlates(slates: DecodedSlate[]): DecodedSlate[] {
  const listing = listingOf(slates);
  if (listing.races.size === 0) return slates;
  return slates.map((slate) => {
    if (isBallotListing(slate.payload)) return slate;
    const checks: ChoiceCheck[] = [];
    let changed = false;
    const positions = slate.payload.positions.map((position) => {
      const resolution = resolveChoice(listing, position, slate.payload);
      if (resolution.status !== "listed") {
        checks.push({ resolution });
        return position;
      }
      const { choice } = resolution;
      const translated: Position = {
        ...position,
        choice: choice.name,
        ...(choice.id ? { choice_id: choice.id } : {}),
      };
      // A printed name is the printed candidate, whatever the endorser said.
      if (choice.writeIn) translated.write_in = true;
      else delete translated.write_in;
      const written = position.choice !== choice.name ? position.choice : undefined;
      checks.push(written ? { resolution, written } : { resolution });
      if (
        written ||
        translated.choice_id !== position.choice_id ||
        translated.write_in !== position.write_in
      )
        changed = true;
      return translated;
    });
    return {
      ...slate,
      ...(changed ? { payload: { ...slate.payload, positions } } : {}),
      checks,
    };
  });
}

/** A problem worth showing: something an endorser named that the ballot doesn't have. */
export interface BallotProblem {
  sourceId: string;
  sourceName: string;
  subject: Subject;
  election?: string;
  /** As the slate wrote it; absent for a race that isn't listed. */
  choice?: string;
  kind: "race-unlisted" | "unlisted" | "write-in";
  /** The listed name it resembles. */
  suggestion?: string;
}

/** Every problem in some translated slates, in slate order. */
export function ballotProblems(slates: DecodedSlate[]): BallotProblem[] {
  const out: BallotProblem[] = [];
  for (const slate of slates) {
    slate.checks?.forEach((check, i) => {
      const { status } = check.resolution;
      if (status !== "race-unlisted" && status !== "unlisted" && status !== "write-in") return;
      const position = slate.payload.positions[i];
      if (!position) return;
      const suggestion =
        "suggestion" in check.resolution ? check.resolution.suggestion?.name : undefined;
      out.push({
        sourceId: slate.source.id,
        sourceName: slate.source.name,
        subject: position.subject,
        ...(electionOf(position.subject, slate.payload)
          ? { election: electionOf(position.subject, slate.payload) }
          : {}),
        ...(position.choice !== undefined && status !== "race-unlisted"
          ? { choice: position.choice }
          : {}),
        kind: status,
        ...(suggestion ? { suggestion } : {}),
      });
    });
  }
  return out;
}

/** One line per problem, for a feedback report. */
export function describeProblem(problem: BallotProblem): string {
  const where = `"${problem.subject.title}"${problem.subject.jurisdiction ? ` (${problem.subject.jurisdiction})` : ""}`;
  if (problem.kind === "race-unlisted")
    return `${problem.sourceName}: race ${where} isn't on the official ballot list`;
  const hint = problem.suggestion ? `; maybe "${problem.suggestion}"?` : "";
  if (problem.kind === "write-in")
    return `${problem.sourceName}: write-in "${problem.choice}" in ${where} isn't a certified write-in candidate${hint}`;
  return `${problem.sourceName}: "${problem.choice}" in ${where} isn't on the official ballot list${hint}`;
}

/** The text of a "Wrong information" report about some problems. */
export function problemReport(problems: BallotProblem[]): string {
  return [
    "These endorsements name candidates or races that aren't on the official ballot list OpenSlate has:",
    "",
    ...problems.map((p) => `- ${describeProblem(p)}`),
  ].join("\n");
}

/**
 * A position the user is about to sign, carrying the listing's spelling and
 * id for its choice (SPEC §3.11: publishers SHOULD copy them), and the
 * listing's say on whether it's a write-in.
 */
export function withBallotIds(
  position: Position,
  listing: BallotListing,
  election: string | undefined,
): Position {
  if (position.choice === undefined) return position;
  const resolution = resolveChoice(listing, position, { context: { election } });
  if (resolution.status !== "listed") return position;
  const { choice } = resolution;
  const out: Position = {
    ...position,
    choice: choice.name,
    ...(choice.id ? { choice_id: choice.id } : {}),
  };
  if (choice.writeIn) out.write_in = true;
  else delete out.write_in;
  return out;
}
