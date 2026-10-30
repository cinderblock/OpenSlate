import type { CandidateInfo, Passage, Subject } from "@openslate/core";
import { Link, useLocation, useParams, useSearch } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAllRaces } from "../lib/allSlates";
import { type AttachedArticle, articleDate, articlesByRace } from "../lib/articles";
import { useBallotDraft } from "../lib/ballotDraft";
import { designation, isYesNo } from "../lib/ballotView";
import {
  type ChoiceGroup,
  collateRaces,
  type Race,
  type RacePosition,
  stanceTone,
} from "../lib/collate";
import { followedSubject } from "../lib/followedRaces";
import { type GuideForSubject, useGuideItem } from "../lib/guides";
import { localToday, useDecodedSlates, useFollows } from "../lib/myVote";
import {
  type ChoiceTally,
  filterPositions,
  isFiltering,
  NO_SLATE_FILTER,
  type SlateFilter,
  tallyRace,
} from "../lib/raceTally";
import { candidateLinks, type ResearchLink, raceLinks } from "../lib/researchLinks";
import { subjectFromKey, subjectKey } from "../lib/subjects";
import { AllSlatesFilters, AllSlatesLoading, CatalogNote, plural, SlateGroups } from "./AllSlates";
import { ChoiceBallotTags, RaceUnlistedNote } from "./BallotTags";
import { FollowButton } from "./FollowButton";
import { ForecastsPanel } from "./ForecastsPanel";
import { CandidateGuide, GuideDetails, GuideMeans, GuideOverview } from "./GuideContent";
import { PollsPanel } from "./PollsPanel";
import { PositionRow, STANCE_LABEL } from "./PositionRow";
import { ResultsPanel } from "./ResultsPanel";

/**
 * One race: every imported source's position on it, followed sources first,
 * plus my own picks, polls, forecasts and results. Unlike My ballot, sources
 * you don't follow are listed in full here: this is where you compare.
 *
 * With `?all` it goes wider, to every slate in the public catalog (loaded
 * when asked for, lib/allSlates.ts), on a race on your ballot or not: counts
 * first, then the sources grouped by kind, because a proposition has 100+.
 */
export function RacePanel() {
  const { key: routeKey } = useParams({ from: "/race/$key" });
  // TanStack Router auto-decodes route params, so routeKey is already the raw subject key.
  const targetKey = routeKey;
  const { all: everySlate = false } = useSearch({ from: "/race/$key" });

  const { slates } = useDecodedSlates();
  const [follows] = useFollows();
  const draft = useBallotDraft();
  const allRaces = useAllRaces(everySlate);
  const { all } = allRaces;
  const [filter, setFilter] = useState<SlateFilter>(NO_SLATE_FILTER);

  const imported = useMemo(
    () =>
      collateRaces(slates, { follows, includeUnfollowed: true }).find((r) => r.key === targetKey),
    [slates, follows, targetKey],
  );
  const race = all?.byKey.get(targetKey) ?? imported;
  const tally = useMemo(() => (all && race ? tallyRace(race) : undefined), [all, race]);

  // Articles slates attach to this race (SPEC §3.15).
  const articles = useMemo(
    () => articlesByRace(all?.slates ?? slates, all?.follows ?? follows).get(targetKey) ?? [],
    [all, slates, follows, targetKey],
  );

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((r) => subjectKey(r.subject) === targetKey),
    [draft.rows, targetKey],
  );

  // A shared link can open a race no imported slate has: then the subject
  // comes from my own picks, or from the key itself.
  const keySubject = useMemo(() => subjectFromKey(targetKey), [targetKey]);
  const knownSubject = race?.subject ?? myRows[0]?.subject ?? keySubject;

  // The official voter guide's material on this race, when a guide covers it.
  const guide = useGuideItem(knownSubject);
  // My ballot's "Official guide" link lands here: the guide loads after the
  // page does, so scroll to it once it's there.
  const hash = useLocation({ select: (l) => l.hash });
  const guideReady = guide.guide !== undefined;
  useEffect(() => {
    if (hash === "official" && guideReady) document.getElementById("official")?.scrollIntoView();
  }, [hash, guideReady]);
  // My ballot's "All slates" lands here. The sidebar comes first on a phone.
  useEffect(() => {
    if (hash === "all-slates") document.getElementById("all-slates")?.scrollIntoView();
  }, [hash]);

  // The guide's subject has what a parsed key lacks (kind, id).
  const subject = race || myRows[0] ? knownSubject : (guide.guide?.item.subject ?? knownSubject);
  // The race's election and jurisdiction fall back to the slate's context when
  // the subject leaves them out.
  const jurisdiction = race?.jurisdiction ?? subject?.jurisdiction;
  const election = race?.election ?? subject?.election;
  const pollSubject = useMemo<Subject>(
    () => ({
      title: subject?.title ?? targetKey,
      ...(subject?.id ? { id: subject.id } : {}),
      ...(subject?.kind ? { kind: subject.kind } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
      ...(election ? { election } : {}),
    }),
    [subject, jurisdiction, election, targetKey],
  );

  return (
    <section className="panel">
      <p>
        <Link to="/">← My ballot</Link> · <Link to="/races">All races</Link>
      </p>
      <div className="race-title">
        <h2>{subject?.title ?? targetKey}</h2>
        {subject && (
          <FollowButton
            raceKey={targetKey}
            subject={followedSubject({ subject, jurisdiction, election })}
          />
        )}
      </div>
      <p className="hint">
        {subject?.kind && <span className="tag">{subject.kind}</span>}{" "}
        {jurisdiction && <span>{jurisdiction}</span>}
        {election && <span> · {election}</span>}
        {subject?.id && (
          <>
            {" · "}
            <code className="key">{subject.id}</code>
          </>
        )}
      </p>

      <div className="race-layout">
        {myRows.length > 0 && (
          <div className="card race-mine">
            <h3>My positions</h3>
            <ul className="position-list">
              {myRows.map((row) => (
                <li key={row.id}>
                  <span className={`stance stance-${row.stance ?? "neutral"}`}>
                    {row.stance ? STANCE_LABEL[row.stance] : "—"}
                  </span>
                  <span className="position-subject">
                    {row.choice ?? <em>(overall)</em>}
                    {row.statement && (
                      <div className="hint">
                        <em>statement:</em> {row.statement}
                      </div>
                    )}
                    {row.privateNote && (
                      <div className="hint">
                        <em>private note:</em> {row.privateNote}
                      </div>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Beside the endorsements on a wide screen; between My positions and them on a phone. */}
        <aside className="race-context" aria-label="Read up, news, polls, forecast and results">
          {subject && (
            <ReadUp
              links={raceLinks(
                {
                  subject,
                  jurisdiction,
                  election,
                  ...(race?.ballot ? { ballot: race.ballot } : {}),
                },
                localToday(),
              )}
            />
          )}

          {articles.length > 0 && <InTheNews articles={articles} />}

          <PollsPanel subject={pollSubject} />

          <ForecastsPanel subject={pollSubject} />

          <ResultsPanel subject={pollSubject} />
        </aside>

        <div className="race-choices">
          <div id="all-slates" className="all-slates">
            {!everySlate ? (
              <p>
                <Link
                  from="/race/$key"
                  to="."
                  search={{ all: true }}
                  className="button-link"
                >
                  <Users className="icon" aria-hidden="true" /> See all slates
                </Link>{" "}
                <span className="hint">
                  Every slate in the public catalog, not only the ones you've imported.
                </span>
              </p>
            ) : (
              <>
                <AllSlatesLoading state={allRaces} />
                {all && tally && tally.sources > 0 && (
                  <div className="card">
                    <h3>
                      {plural(tally.sources, "slate")} on this{" "}
                      {subject?.kind === "measure" ? "measure" : "race"}
                    </h3>
                    <AllSlatesFilters tally={tally} filter={filter} onChange={setFilter} />
                    <CatalogNote all={all} />
                  </div>
                )}
              </>
            )}
          </div>
          {guide.guide && <GuideOverview guide={guide.guide} />}
          {guide.status === "error" && (
            <p className="hint warning">
              Couldn't load the official voter guide: {guide.error?.message ?? "unknown error"}
            </p>
          )}
          {!race ? (
            <>
              {guide.guide && <GuideChoices guide={guide.guide} />}
              {(!everySlate || all) && (
                <div className="card">
                  <p className="hint">
                    {all ? "No slate in the public catalog has this race." : "No endorsements imported for this race yet."}{" "}
                    Add some in <Link to="/sources">Sources</Link>.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <RaceUnlistedNote race={race} />
              {race.onBallot && !tally && (
                <p className="hint">
                  {race.choices.filter((c) => c.onBallot).length} on the ballot ·{" "}
                  {race.followedSources} of {race.totalSources} sources with a position here are
                  ones you follow
                </p>
              )}
              {tally ? (
                <EveryChoice
                  tally={tally.choices}
                  yesNo={tally.yesNo}
                  filter={filter}
                  race={race}
                  guide={guide.guide}
                />
              ) : (
                race.choices.map((group) => (
                  <ChoiceCard
                    key={group.choice}
                    group={group}
                    race={race}
                    subjectTitle={race.subject.title}
                    guide={guide.guide}
                  />
                ))
              )}
            </>
          )}
          {guide.guide && <GuideDetails guide={guide.guide} />}
        </div>
      </div>
    </section>
  );
}

/** Where to read more: voter guides, Ballotpedia, news. Plain links; nothing is fetched. */
function ReadUp({ links }: { links: ResearchLink[] }) {
  return (
    <div className="card read-up">
      <h3>Read up</h3>
      <ul className="read-up-list">
        {links.map((link) => (
          <li key={link.label}>
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.label} ↗
            </a>
            <div className="hint">{link.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Articles attached to this race by the imported slates (SPEC §3.15): reading,
 * never endorsements, so from every slate, followed or not.
 */
function InTheNews({ articles }: { articles: AttachedArticle[] }) {
  return (
    <div className="card read-up" id="articles">
      <h3>In the news</h3>
      <p className="hint">Linked to this race by the slates you've imported. Not endorsements.</p>
      <ul className="read-up-list">
        {articles.map((article) => {
          const by = article.attachedBy.map(
            (a) => `${a.source.name}${a.valid ? "" : " (signature didn't verify)"}`,
          );
          // Whoever published it attached it: no need to say so twice.
          const self = by.length === 1 && by[0] === article.publisher;
          return (
            <li key={article.href}>
              <a href={article.href} target="_blank" rel="noreferrer">
                {article.title} ↗
              </a>
              <div className="hint">
                {[
                  article.publisher,
                  articleDate(article.publishedAt),
                  article.kind,
                  article.choices.length > 0 ? `about ${article.choices.join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {article.summary && <div>{article.summary}</div>}
              {!self && <div className="hint">Linked by {by.join(", ")}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The guide's candidates, or what each vote on a measure means, for a race no
 * imported slate lists choices for (a shared link opened by a new visitor).
 */
function GuideChoices({ guide }: { guide: GuideForSubject }) {
  const { candidates, means } = guide.item;
  return (
    <>
      {candidates?.map((candidate) => (
        <div key={candidate.choice} className="card">
          <div className="card-title">
            <strong>{candidate.choice}</strong>
          </div>
          <CandidateGuide candidate={candidate} guide={guide} />
        </div>
      ))}
      {means &&
        Object.entries(means).map(([choice, passage]) => (
          <div key={choice} className="card">
            <div className="card-title">
              <strong>{choice}</strong>
            </div>
            <GuideMeans passage={passage} guide={guide} />
          </div>
        ))}
    </>
  );
}

/** Every choice with its sources, as far as the filter lets them through. */
function EveryChoice({
  tally,
  yesNo,
  filter,
  race,
  guide,
}: {
  tally: ChoiceTally[];
  yesNo: boolean;
  filter: SlateFilter;
  race: Race;
  guide?: GuideForSubject;
}) {
  const filtering = isFiltering(filter);
  const shown = tally
    .map((choice) => ({ choice, positions: filterPositions(choice, yesNo, filter) }))
    .filter(({ positions }) => !filtering || positions.length > 0);
  if (shown.length === 0) {
    return (
      <div className="card">
        <p className="hint">No slate on this race matches.</p>
      </div>
    );
  }
  return shown.map(({ choice, positions }) => (
    <ChoiceCard
      key={choice.group.choice}
      group={choice.group}
      race={race}
      subjectTitle={race.subject.title}
      guide={guide}
      every={{ positions, searching: filter.terms.length > 0 }}
    />
  ));
}

function ChoiceCard({
  group,
  race,
  subjectTitle,
  guide,
  every,
}: {
  group: ChoiceGroup;
  race: Race;
  subjectTitle: string;
  guide?: GuideForSubject;
  /** Every slate on the choice, as filtered: shown by kind, not as one list. */
  every?: { positions: RacePosition[]; searching: boolean };
}) {
  const candidate: CandidateInfo | undefined = guide?.item.candidates?.find(
    (c) => c.choice === group.choice,
  );
  const means: Passage | undefined = group.choice ? guide?.item.means?.[group.choice] : undefined;
  const links = candidateLinks(race, group.choice);
  const candidateChoice = group.choice !== "" && !isYesNo(race);
  const total = { for: 0, against: 0 };
  for (const p of group.positions) {
    const tone = stanceTone(p.stance);
    if (tone === "for") total.for++;
    else if (tone === "against") total.against++;
  }
  return (
    <div className="card">
      <div className="card-title">
        <strong>{group.choice || <em>(no specific choice)</em>}</strong>
        {designation(group) && <span className="hint">{designation(group)}</span>}
        <ChoiceBallotTags group={group} race={race} />
        <span className="grow" />
        <span className="tag">
          {total.for} for · {total.against} against{every ? "" : ", followed or not"}
        </span>
        {candidateChoice && (
          <FollowButton
            raceKey={race.key}
            subject={followedSubject(race)}
            choice={group.choice}
          />
        )}
      </div>
      {guide && candidate && <CandidateGuide candidate={candidate} guide={guide} />}
      {guide && !candidate && group.onBallot && guide.item.subject.kind === "race" && (
        <p className="hint">No statement or photo in the official voter guide.</p>
      )}
      {guide && means && <GuideMeans passage={means} guide={guide} />}
      {links.length > 0 && (
        <p className="research-links">
          <span className="hint">Read up on {group.choice}:</span>{" "}
          {links.map((link, i) => (
            <span key={link.label}>
              {i > 0 && " · "}
              <a href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </span>
          ))}
        </p>
      )}
      {group.positions.length === 0 ? (
        <p className="hint">
          {every
            ? "On the ballot; no slate takes a position on this choice."
            : `On the ballot; none of your imported sources take a position on ${subjectTitle} for this choice.`}
        </p>
      ) : every ? (
        <SlateGroups positions={every.positions} searching={every.searching} />
      ) : (
        <ul className="position-list">
          {group.positions.map((position) => (
            <PositionRow key={position.source.id} position={position} />
          ))}
        </ul>
      )}
    </div>
  );
}
