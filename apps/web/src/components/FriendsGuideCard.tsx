import { deserializeIdentity } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { shownElection } from "../lib/ballotAgent";
import { listingOf } from "../lib/ballotCheck";
import { collateRaces, electionsOf } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import {
  earlierGuides,
  guidePrompt,
  guideSlate,
  readGuideReply,
  signSavedGuide,
} from "../lib/friendsGuide";
import { useActiveIdentity } from "../lib/identities";
import { isAreaSet } from "../lib/jurisdictions";
import {
  localToday,
  removeFriendGuide,
  setRemoved,
  useArea,
  useDecodedSlates,
  useFollows,
  useMyElection,
} from "../lib/myVote";
import { sourceIdOf } from "../lib/sources";
import { track } from "../lib/usage";
import { SigningAs } from "./SigningAs";
import { STANCE_LABEL } from "./stanceOptions";
import { TextArea, TextField } from "./ui/TextField";

/**
 * A guide that isn't a slate yet: any AI chat can read it, whatever its format,
 * with a message that holds this voter's ballot. See lib/friendsGuide.ts.
 */
export function FriendsGuideCard() {
  const { slates } = useDecodedSlates();
  const [follows] = useFollows();
  const [area] = useArea();
  const [chosenElection] = useMyElection();
  const { active: identity, all: myIdentities } = useActiveIdentity();
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const elections = useMemo(() => electionsOf(slates, follows), [slates, follows]);
  const election = shownElection(elections, chosenElection, localToday());

  async function copyChatMessage() {
    if (!election) return;
    const races = collateRaces(slates, { follows, election, area, includeUnfollowed: true });
    await navigator.clipboard.writeText(guidePrompt(races, election));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Every race of the election, not just this area's: the area may have changed
  // since the message was copied, and a code only ever names its own race.
  const read = useMemo(() => {
    if (!reply.trim() || !election) return undefined;
    const races = collateRaces(slates, { follows, election, includeUnfollowed: true });
    return readGuideReply(reply, races, election);
  }, [reply, slates, follows, election]);
  const parsed = read && !("error" in read) ? read : undefined;
  const friend = (name ?? parsed?.friend ?? "").trim();
  const unsigned = useMemo(() => slates.filter((slate) => slate.local), [slates]);

  function add() {
    if (!parsed || !friend || !election || !identity) return;
    const token = guideSlate(
      friend,
      parsed.picks,
      listingOf(slates),
      election,
      deserializeIdentity(identity),
    );
    // A corrected reply replaces the guide it fixes, not the friend's other sources.
    const ownKeys = new Set(myIdentities.map((id) => id.publicKey));
    const earlier = earlierGuides(slates, friend, election, ownKeys);
    slatesCollection.insert({ token, importedAt: new Date().toISOString() });
    for (const slate of earlier) {
      if (slate.local) removeFriendGuide(slate.token);
      else if (slate.token !== token) slatesCollection.delete(slate.token);
    }
    setRemoved(sourceIdOf({ issuer: { key: "" }, attribution: { of: { name: friend } } }), false);
    track({ name: "slate.import", dims: { source: "paste" } });
    setAdded(
      `${earlier.length > 0 ? "Updated" : "Added"} ${friend}'s guide: ${parsed.picks.length} pick${parsed.picks.length === 1 ? "" : "s"}. They're on My ballot now, as your report of what the guide says.`,
    );
    setReply("");
    setName(null);
  }

  function signUnsigned() {
    if (!identity) return;
    const id = deserializeIdentity(identity);
    for (const guide of unsigned) {
      slatesCollection.insert({
        token: signSavedGuide(guide.payload, id),
        importedAt: guide.importedAt,
      });
      removeFriendGuide(guide.token);
    }
  }

  return (
    <div className="card">
      <h3>Have a friend's voter guide?</h3>
      <p className="hint">
        A spreadsheet, PDF, doc or photo isn't a slate yet, but any AI, such as ChatGPT, Claude or
        Gemini, can read it for you.
      </p>
      {!isAreaSet(area) || !election ? (
        <p className="hint">
          First <Link to="/">set up My ballot</Link> with where you vote: the message for the chat
          holds your ballot, so it can match the guide to your races.
        </p>
      ) : (
        <>
          <p className="hint">
            <strong>1.</strong> Copy this message, which holds your {formatElectionDate(election)}{" "}
            ballot, and send it to the chat with the guide. Whatever you share goes to that service,
            not to OpenSlate.
          </p>
          <div className="row">
            <button type="button" onClick={copyChatMessage}>
              {copied ? "Copied!" : "Copy message for the chat"}
            </button>
          </div>
          <p className="hint">
            <strong>2.</strong> Paste its reply here, and check the picks against the guide before
            you add them: this is the chat's reading of it. You sign the result as your report of
            what the guide says. Your friend doesn't sign anything, and it stays here unless you
            share it.
          </p>
          <TextArea
            label="The chat's reply"
            rows={4}
            maxRows={10}
            value={reply}
            onChange={(text) => {
              setReply(text);
              setAdded(null);
            }}
          />
          {read && "error" in read && <p className="error">{read.error}</p>}
          {(parsed || unsigned.length > 0) && <SigningAs />}
          {unsigned.length > 0 && (
            <>
              <p className="hint">
                {unsigned.length === 1
                  ? `${unsigned[0]?.source.name}'s guide isn't signed yet.`
                  : `${unsigned.length} guides you added aren't signed yet.`}{" "}
                Sign them as your report of what they say.
              </p>
              <div className="row">
                <button type="button" onClick={signUnsigned} disabled={!identity}>
                  Sign {unsigned.length === 1 ? "it" : "them"}
                </button>
              </div>
            </>
          )}
          {parsed && (
            <>
              <TextField label="Whose guide is it?" value={friend} onChange={setName} />
              {parsed.picks.length > 0 && (
                <ul className="position-list">
                  {parsed.picks.map(({ race, position }) => (
                    <li key={`${race.key}|${position.choice}`}>
                      <span className={`stance stance-${position.stance}`}>
                        {position.label ?? STANCE_LABEL[position.stance]}
                      </span>
                      <span className="position-subject">
                        {race.subject.title} → {position.choice}
                        {position.rank ? ` (rank ${position.rank})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {parsed.problems.map((problem) => (
                <p key={problem} className="warning">
                  Left out: {problem}
                </p>
              ))}
              {parsed.leftOut.length > 0 && (
                <>
                  <p className="hint">The chat left these out:</p>
                  <ul>
                    {parsed.leftOut.map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  onClick={add}
                  disabled={!friend || !identity || parsed.picks.length === 0}
                >
                  Sign and add {parsed.picks.length} pick{parsed.picks.length === 1 ? "" : "s"}
                </button>
              </div>
            </>
          )}
          {added && <p className="hint">{added}</p>}
        </>
      )}
    </div>
  );
}
