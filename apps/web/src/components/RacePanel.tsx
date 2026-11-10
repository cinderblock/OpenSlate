import type { CandidateInfo, GuideReference, Passage, Subject } from "@openslate/core";
import { Link, useLocation, useParams, useSearch } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { type AllRacesState, useAllRaces } from "../lib/allSlates";
import {
  type AttachedArticle,
  articleDate,
  articlesByRace,
  type SharedCoverage,
  sharedCoverage,
} from "../lib/articles";
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
import {
  type GuideForSubject,
  referencePlaceLabel,
  useGuideItem,
  useGuideReferences,
  useGuideSubjects,
} from "../lib/guides";
import { localToday, useDecodedSlates, useFollows } from "../lib/myVote";
import { type ParsedRaceSlug, parseRaceSlug, raceSlug } from "../lib/raceSlug";
import {
  type ChoiceTally,
  filterPositions,
  isFiltering,
  NO_SLATE_FILTER,
  type SlateFilter,
  tallyRace,
} from "../lib/raceTally";
import type { CatalogRace } from "../lib/regions/us-ca/countyResults";
import { candidateLinks, type ResearchLink, raceLinks } from "../lib/researchLinks";
import { subjectFromKey, subjectKey } from "../lib/subjects";
import { AllSlatesFilters, AllSlatesLoading, CatalogNote, plural, SlateGroups } from "./AllSlates";
import { ChoiceBallotTags, RaceUnlistedNote } from "./BallotTags";
import { FollowButton } from "./FollowButton";
import { ForecastsPanel } from "./ForecastsPanel";
import { CandidateGuide, GuideDetails, GuideMeans, GuideOverview } from "./GuideContent";
import { PollsPanel } from "./PollsPanel";
import { PositionRow, STANCE_LABEL } from "./PositionRow";
import { RaceCountyCount, useRaceCountyCount } from "./RaceCountyCount";
import { RaceLink } from "./RaceLink";
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
  // `/race/$` (a slug) or `/race/$key` (an `id` key). TanStack Router decodes params.
  const params = useParams({ strict: false });
  const { all: asked = false, k: pin } = useSearch({ strict: false });
  const target = useRaceTarget(params._splat, params.key, pin);

  if (target.state === "found") {
    return (
      <RaceView
        key={target.key}
        targetKey={target.key}
        everySlate={asked || target.viaCatalog}
        pinned={pin === target.key}
      />
    );
  }
  return <RaceLookup target={target} />;
}

type RaceTarget =
  | { state: "found"; key: string; viaCatalog: boolean }
  | { state: "several"; keys: string[] }
  | { state: "searching"; parsed?: ParsedRaceSlug; catalog?: AllRacesState }
  | { state: "missing"; parsed?: ParsedRaceSlug; catalog?: AllRacesState };

/**
 * Which race a `/race/...` address names. A slug is looked for in what's here
 * first: imported slates, my own picks, and the official voter guide for its
 * election and area. Only when none of those has it does the public catalog
 * load, so a link to a race only some catalog slate covers still opens.
 */
function useRaceTarget(
  splat: string | undefined,
  key: string | undefined,
  pin: string | undefined,
): RaceTarget {
  const parsed = useMemo(() => (splat !== undefined ? parseRaceSlug(splat) : undefined), [splat]);
  // An `id` key, or `?k` naming one of the races at this slug.
  const direct = key ?? (pin && parsed && raceSlug(pin) === parsed.slug ? pin : undefined);
  const looking = parsed !== undefined && direct === undefined;

  const { slates, isReady } = useDecodedSlates();
  const draft = useBallotDraft();
  const guide = useGuideSubjects(looking ? parsed : undefined);
  const local = useMemo(() => {
    if (!looking) return [];
    // Every race collated from these slates has one of their positions' keys.
    const keys = [
      ...slates.flatMap((slate) => slate.payload.positions.map((p) => subjectKey(p.subject))),
      ...Object.values(draft.rows).map((r) => subjectKey(r.subject)),
      ...guide.subjects.map(subjectKey),
    ];
    return [...new Set(keys)].filter((k) => raceSlug(k) === parsed.slug);
  }, [looking, parsed, slates, draft.rows, guide.subjects]);
  // Once the local look has finished for this slug, it stays finished: a guide
  // list that failed goes back to pending each time a new reader of it mounts
  // (the race page itself, once found), which would otherwise unfind the race.
  const settledNow = isReady && !guide.pending;
  const [settledFor, setSettledFor] = useState<string>();
  useEffect(() => {
    if (settledNow && parsed) setSettledFor(parsed.slug);
  }, [settledNow, parsed]);
  const localDone = settledNow || (parsed !== undefined && settledFor === parsed.slug);

  const needCatalog = looking && localDone && local.length === 0;
  const catalog = useAllRaces(needCatalog);
  const fromCatalog = useMemo(
    () =>
      needCatalog && catalog.all
        ? [...catalog.all.byKey.keys()].filter((k) => raceSlug(k) === parsed?.slug)
        : [],
    [needCatalog, catalog.all, parsed],
  );

  if (direct !== undefined) return { state: "found", key: direct, viaCatalog: false };
  if (!parsed) return { state: "missing" };
  const [only, ...more] = local.length > 0 ? local : fromCatalog;
  if (only !== undefined && more.length === 0) {
    return { state: "found", key: only, viaCatalog: local.length === 0 };
  }
  if (only !== undefined) return { state: "several", keys: [only, ...more] };
  if (!localDone || (needCatalog && !catalog.all && catalog.status.state !== "error")) {
    return { state: "searching", parsed, ...(needCatalog ? { catalog } : {}) };
  }
  return { state: "missing", parsed, ...(needCatalog ? { catalog } : {}) };
}

/** A slug's title, as near as it can be read back: "board-seat-4" -> "Board seat 4". */
function titleFromSlug(titleSlug: string): string {
  const words = titleSlug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The race page before (or instead of) a race: looking, which one, or not found. */
function RaceLookup({ target }: { target: Exclude<RaceTarget, { state: "found" }> }) {
  const parsed = target.state === "several" ? undefined : target.parsed;
  const where = [parsed?.jurisdiction, parsed?.election].filter(Boolean);
  return (
    <section className="panel">
      <p>
        <Link to="/">← My ballot</Link> · <Link to="/races">All races</Link>
      </p>
      {target.state === "several" ? (
        <>
          <h2>Which race?</h2>
          <p className="hint">More than one race has this address. Pick one:</p>
          <ul className="read-up-list">
            {target.keys.map((key) => {
              const subject = subjectFromKey(key);
              return (
                <li key={key}>
                  <RaceLink raceKey={key} pin>
                    {subject?.title ?? key}
                  </RaceLink>
                  {subject && (
                    <div className="hint">
                      {[subject.jurisdiction, subject.election].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <h2>{parsed ? titleFromSlug(parsed.titleSlug) : "Race not found"}</h2>
          {where.length > 0 && <p className="hint">{where.join(" · ")}</p>}
          {target.state === "searching" ? (
            target.catalog ? (
              <>
                <p className="hint">
                  Not in your slates or the official voter guide. Looking in the public catalog…
                </p>
                <AllSlatesLoading state={target.catalog} />
              </>
            ) : (
              <p className="hint">Looking for this race…</p>
            )
          ) : (
            <>
              {target.catalog && <AllSlatesLoading state={target.catalog} />}
              <div className="card">
                <p className="hint">
                  No race at this address in your slates, the official voter guide or the public
                  catalog. Find it in <Link to="/races">All races</Link>, or add endorsements in{" "}
                  <Link to="/sources">Sources</Link>.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** One race, once the address has named it. */
function RaceView({
  targetKey,
  everySlate,
  pinned,
}: {
  targetKey: string;
  /** Every slate in the public catalog, not only what's imported. */
  everySlate: boolean;
  /** The address names the race exactly (`?k`), so its links keep doing so. */
  pinned: boolean;
}) {
  const { slates } = useDecodedSlates();
  const [follows] = useFollows();
  const draft = useBallotDraft();
  const allRaces = useAllRaces(everySlate);
  const { all } = allRaces;
  const [filter, setFilter] = useState<SlateFilter>(NO_SLATE_FILTER);

  const imported = useMemo(
    () => collateRaces(slates, { follows, includeUnfollowed: true, only: targetKey })[0],
    [slates, follows, targetKey],
  );
  const race = all?.byKey.get(targetKey) ?? imported;
  const tally = useMemo(() => (all && race ? tallyRace(race) : undefined), [all, race]);

  // Articles slates attach to this race (SPEC §3.15).
  const articlesEverywhere = useMemo(
    () => all?.articles ?? articlesByRace(slates, follows),
    [all, slates, follows],
  );
  const articles = articlesEverywhere.get(targetKey) ?? [];
  const alsoCovers = useMemo(
    () => sharedCoverage(articlesEverywhere, targetKey),
    [articlesEverywhere, targetKey],
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
  const references = useGuideReferences(guide.guide);
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

  // What the county's count is matched on: the people running, or the measure's letter.
  const countyRace = useMemo<CatalogRace | undefined>(
    () =>
      subject
        ? {
            key: targetKey,
            subject,
            ...(election ? { election } : {}),
            ...(jurisdiction ? { jurisdiction } : {}),
            ...(race?.ballot ? { ballot: race.ballot } : {}),
            choices: race?.choices ?? [],
          }
        : undefined,
    [subject, election, jurisdiction, race, targetKey],
  );
  const countyCount = useRaceCountyCount(countyRace);

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

          {references.length > 0 && <ReferencedBy references={references} />}

          {articles.length > 0 && (
            <InTheNews articles={articles} alsoCovers={alsoCovers} everySlate={Boolean(all)} />
          )}

          <PollsPanel subject={pollSubject} />

          <ForecastsPanel subject={pollSubject} />

          {/* A local race's own county count, in place of civicAPI (the backup source);
              the state's races have theirs in ResultsPanel. */}
          {countyCount ? (
            <RaceCountyCount count={countyCount} card />
          ) : (
            <ResultsPanel subject={pollSubject} />
          )}
        </aside>

        <div className="race-choices">
          <div id="all-slates" className="all-slates">
            {!everySlate ? (
              <p>
                <RaceLink raceKey={targetKey} all pin={pinned} className="button-link">
                  <Users className="icon" aria-hidden="true" /> See all slates
                </RaceLink>{" "}
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
                    {all
                      ? "No slate in the public catalog has this race."
                      : "No endorsements imported for this race yet."}{" "}
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

/** A race's title without its description: "California — Proposition 41". */
function raceName(title: string): string {
  return title.split(" (")[0] ?? title;
}

/**
 * What else in the official voter guide mentions this race. Found by the same
 * rule for every race; it says the words are there, not how the two relate.
 */
function ReferencedBy({ references }: { references: GuideReference[] }) {
  return (
    <div className="card read-up" id="referenced-by">
      <h3>Referenced by</h3>
      <p className="hint">Other items in the official voter guide that mention this one.</p>
      <ul className="read-up-list">
        {references.map(({ from, choice, where }) => (
          <li key={`${from.title}|${choice ?? ""}`}>
            <RaceLink raceKey={subjectKey(from)}>{raceName(from.title)}</RaceLink>
            <div className="hint">
              {choice && <>Names {choice} · </>}
              {where.map(referencePlaceLabel).join(" · ")}
            </div>
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
function InTheNews({
  articles,
  alsoCovers,
  everySlate,
}: {
  articles: AttachedArticle[];
  /** Other races these same articles are attached to. */
  alsoCovers: SharedCoverage[];
  /** Read from every slate in the public catalog, not only the imported ones. */
  everySlate: boolean;
}) {
  return (
    <div className="card read-up" id="articles">
      <h3>In the news</h3>
      <p className="hint">
        Linked to this race by{" "}
        {everySlate ? "slates in the public catalog" : "the slates you've imported"}. Not
        endorsements.
      </p>
      {alsoCovers.length > 0 && (
        <p className="hint">
          Articles here also cover{" "}
          {alsoCovers.map((race, i) => (
            <Fragment key={race.key}>
              {i > 0 && ", "}
              <RaceLink raceKey={race.key}>{raceName(race.title)}</RaceLink> ({race.articles})
            </Fragment>
          ))}
        </p>
      )}
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
          <FollowButton raceKey={race.key} subject={followedSubject(race)} choice={group.choice} />
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
