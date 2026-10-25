import { type SlatePayload, createIdentity, parseSlate, serializeIdentity } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Code, FlaskConical, Lock, PenLine, Server, Vote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPublicSite } from "../lib/alpha";
import {
  type VerifiedSlate,
  catalogEntryUrl,
  fetchCatalogBundle,
  fetchCatalogSlate,
  storeSlates,
  verifyCatalogSlate,
} from "../lib/catalogImport";
import {
  type EntrySummary,
  isSummarized,
  racesInArea,
  summaryJurisdictions,
  summaryOf,
} from "../lib/catalogSummary";
import { areaOptionsOf } from "../lib/collate";
import { addIdentity, slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { REPO_URL } from "../lib/feedback";
import { forEachConcurrently } from "../lib/fetchProgress";
import { useActiveIdentity } from "../lib/identities";
import { downloadIdentityBackup } from "../lib/identityBackup";
import {
  type Area,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  parseJurisdiction,
} from "../lib/jurisdictions";
import {
  areaStore,
  defaultToUnfollowed,
  localToday,
  myElectionStore,
  onboardingStore,
  setStanding,
} from "../lib/myVote";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogEntryLogoUrl,
  catalogQueryOptions,
  slateFromUrlOptions,
} from "../lib/query";
import { type Standing, sourceIdOf } from "../lib/sources";
import { track } from "../lib/usage";
import { closeWizard } from "../lib/wizard";
import { AlphaWizardNote } from "./AlphaNotice";
import { AreaPicker } from "./AreaPicker";
import { isBallotEntry } from "./CatalogBrowser";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanSummary } from "./LeanMeter";
import { StandingToggle } from "./StandingToggle";
import { Checkbox } from "./ui/Checkbox";
import { ProgressBar } from "./ui/ProgressBar";
import { Radio, RadioGroup } from "./ui/Radio";
import { TextField } from "./ui/TextField";

type Step = "welcome" | "election" | "area" | "sources" | "importing" | "identity";

const VOTE_STEPS: Step[] = ["election", "area", "sources"];

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

/** Catalog entry path → how the user picked it. Not in the map = not picked. */
type Picks = ReadonlyMap<string, Exclude<Standing, "off">>;

/** Slates downloaded at once while importing. */
const IMPORT_CONCURRENCY = 6;

/** What the import step's bar shows. No `maxValue`: the total isn't known yet. */
interface ImportProgress {
  label: string;
  value: number;
  maxValue?: number;
}

/** The getting-started wizard. Loaded and mounted by WizardHost while open. */
export function Wizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("welcome");
  const [election, setElection] = useState("");
  const [area, setArea] = useState<Area>(() => areaStore.get());
  const [selected, setSelected] = useState<Picks>(new Map());
  const [downloadAll, setDownloadAll] = useState(false);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const stopped = useRef(false);
  /** Slates checked during the import, stored together at the end (or on Stop). */
  const pending = useRef<VerifiedSlate[]>([]);
  const bundleAbort = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // WizardHost starts this fetch as the wizard opens.
  const catalog = useQuery(catalogQueryOptions(CATALOG_URL));
  const { data: imported } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

  const today = localToday();
  const elections = useMemo(
    () => electionsOf(catalog.data?.entries ?? [], today),
    [catalog.data, today],
  );

  // Preselect the next upcoming election as soon as the catalog is in, so
  // anything the next steps need about it starts loading right away.
  useEffect(() => {
    if (!election && elections[0]) setElection(elections[0][0]);
  }, [election, elections]);

  const summaries = useElectionSummaries(
    catalog.data?.entries,
    election,
    // An older catalog's slates are only worth fetching for someone planning a vote.
    step !== "welcome" && step !== "identity",
  );

  // Move focus to each step's heading so keyboard and screen-reader users land
  // on the new content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run per step
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // A modal <dialog> traps focus, makes the page behind it inert and handles
  // Escape (as `cancel`, which we treat as "skip").
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function skip() {
    if (onboardingStore.get() === "") onboardingStore.set("skipped");
    track({ name: "wizard.skip" });
    closeWizard();
  }

  function finish(path: "vote" | "publish") {
    onboardingStore.set("done");
    track({ name: "wizard.finish", dims: { path } });
    closeWizard();
    void navigate({ to: path === "vote" ? "/" : "/publish" });
  }

  /** Store what the import has checked so far. */
  function storePending() {
    storeSlates(pending.current.splice(0));
  }

  /** Leave the import part-way: what's in so far stays, the rest is dropped. */
  function stopImport() {
    stopped.current = true;
    bundleAbort.current?.abort();
    storePending();
    finish("vote");
  }

  async function followSelected() {
    areaStore.set(area);
    myElectionStore.set(election);
    const entries = summaries.entries.map((s) => s.entry);
    const picked = (entry: CatalogEntry) => selected.has(entry.path) && !isBallotEntry(entry);
    // Official candidate lists always come along: they're the ballot itself.
    const chosen = downloadAll
      ? entries
      : entries.filter((e) => selected.has(e.path) || isBallotEntry(e));
    if (chosen.length === 0) {
      finish("vote");
      return;
    }
    setStep("importing");
    setImportErrors([]);
    stopped.current = false;
    pending.current = [];
    const known = new Set(imported.map((s) => s.token));

    if (downloadAll) {
      // The ones you didn't pick come along for comparison, not to trust:
      // sources new to this browser start unfollowed.
      const importedSources = new Set(imported.flatMap((s) => sourceIdOfToken(s.token) ?? []));
      defaultToUnfollowed(
        entries
          .filter((e) => !isBallotEntry(e) && !picked(e))
          .map(sourceIdOf)
          .filter((id) => !importedSources.has(id)),
      );
    }

    // Everything at once from the catalog's bundle when it has one, so even
    // the order of requests says nothing about your picks.
    let bundled: Map<string, string> | undefined;
    const bundle = catalog.data?.bundle;
    if (downloadAll && catalog.data && bundle) {
      const label = "Downloading every organization's endorsements";
      setImporting({ label, value: 0, ...(bundle.bytes ? { maxValue: bundle.bytes } : {}) });
      const controller = new AbortController();
      bundleAbort.current = controller;
      try {
        bundled = await fetchCatalogBundle(
          catalog.data,
          CATALOG_URL,
          (value, maxValue) => setImporting({ label, value, ...(maxValue ? { maxValue } : {}) }),
          controller.signal,
        );
      } catch {
        // Fetch them one by one instead.
      }
      bundleAbort.current = null;
      if (stopped.current) return;
    }

    const label = downloadAll ? `Adding all ${chosen.length} lists` : importLabel(chosen, picked);
    setImporting({ label, value: 0, maxValue: chosen.length });
    const errors: string[] = [];
    let done = 0;
    await forEachConcurrently(
      chosen,
      IMPORT_CONCURRENCY,
      async (entry) => {
        let token = bundled?.get(entry.path);
        try {
          token ??= await fetchCatalogSlate(entry, CATALOG_URL, queryClient);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${entry.attribution?.of.name ?? entry.slug}: ${message}`);
        }
        if (token) {
          const result = verifyCatalogSlate(token, known);
          if (result.kind === "error") {
            errors.push(`${entry.attribution?.of.name ?? entry.slug}: ${result.error}`);
          } else {
            if (result.kind === "verified") pending.current.push(result.slate);
            if (picked(entry)) {
              setStanding(sourceIdOf(entry), selected.get(entry.path) ?? "follow");
            }
          }
          // Checking hundreds of signatures in a row would freeze the page.
          await new Promise((resolve) => setTimeout(resolve));
        }
        done++;
        setImporting({ label, value: done, maxValue: chosen.length });
      },
      () => stopped.current,
    );
    // After a Stop this stores the ones that were still in flight.
    storePending();
    if (stopped.current) return;
    setImporting(null);
    if (errors.length === 0) finish("vote");
    else setImportErrors(errors);
  }

  const voteIndex = VOTE_STEPS.indexOf(step);

  return (
    <dialog
      ref={dialogRef}
      className="wizard"
      aria-labelledby="wizard-heading"
      onCancel={(e) => {
        e.preventDefault();
        // Mid-import, leaving takes the guarded Stop button, not a stray Escape.
        if (importing) return;
        skip();
      }}
    >
      {voteIndex >= 0 && (
        <ol className="wizard-progress" aria-label={`Step ${voteIndex + 1} of 3`}>
          {VOTE_STEPS.map((s, i) => (
            <li key={s} className={i <= voteIndex ? "done" : ""} />
          ))}
        </ol>
      )}

      {step === "welcome" && (
        <>
          <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
            Welcome to OpenSlate
          </h2>
          <p>
            Endorsements you can verify, from the people and groups you choose. Everything stays in
            this browser. What would you like to do?
          </p>
          {isPublicSite() && <AlphaWizardNote />}
          <div className="wizard-choices">
            <button type="button" className="wizard-choice" onClick={() => setStep("election")}>
              <Vote className="wizard-choice-icon" />
              <strong>Plan my vote</strong>
              <span>
                Pick the organizations you trust and see their endorsements side by side, race by
                race.
              </span>
            </button>
            <button type="button" className="wizard-choice" onClick={() => setStep("identity")}>
              <PenLine className="wizard-choice-icon" />
              <strong>Publish endorsements</strong>
              <span>
                Sign your own recommendations so friends or members can verify they came from you.
              </span>
            </button>
          </div>
          <AboutOpenSlate />
          <WizardFooter onSkip={skip} />
        </>
      )}

      {step === "election" && (
        <ElectionStep
          headingRef={headingRef}
          elections={elections}
          today={today}
          isLoading={catalog.isLoading}
          error={catalog.error}
          election={election}
          setElection={setElection}
          onBack={() => setStep("welcome")}
          onNext={() => setStep("area")}
          onSkip={skip}
          onManual={() => {
            finish("vote");
            void navigate({ to: "/sources" });
          }}
        />
      )}

      {step === "area" && catalog.data && (
        <AreaStep
          headingRef={headingRef}
          summaries={summaries}
          election={election}
          area={area}
          setArea={setArea}
          onBack={() => setStep("election")}
          onNext={() => setStep("sources")}
          onSkip={skip}
        />
      )}

      {step === "sources" && catalog.data && (
        <SourcesStep
          headingRef={headingRef}
          summaries={summaries}
          election={election}
          area={area}
          selected={selected}
          setSelected={setSelected}
          downloadAll={downloadAll}
          setDownloadAll={setDownloadAll}
          onBack={() => setStep("area")}
          onNext={followSelected}
          onSkip={skip}
        />
      )}

      {step === "importing" && (
        <>
          <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
            {importErrors.length > 0 ? "Some sources didn't import" : "Setting up your ballot…"}
          </h2>
          {importing && (
            <>
              <ProgressBar
                label={importing.label}
                value={importing.value}
                maxValue={importing.maxValue}
              />
              <p className="wizard-wait">
                <strong>Please keep this open until it finishes.</strong> It usually takes a few
                seconds. If you stop now, the sources still downloading won't be on your ballot.
              </p>
              <div className="wizard-footer">
                <ConfirmLink
                  label="Stop"
                  nudge="We recommend waiting until it finishes."
                  confirm="Stop anyway"
                  onConfirm={stopImport}
                />
              </div>
            </>
          )}
          {importErrors.length > 0 && (
            <>
              <ul className="error">
                {importErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <div className="wizard-footer">
                <span className="grow" />
                <button type="button" className="primary" onClick={() => finish("vote")}>
                  Continue to my ballot
                </button>
              </div>
            </>
          )}
        </>
      )}

      {step === "identity" && (
        <IdentityStep
          headingRef={headingRef}
          onBack={() => setStep("welcome")}
          onDone={() => finish("publish")}
          onSkip={skip}
        />
      )}
    </dialog>
  );
}

/** What the import bar says it's fetching: your picks, and the ballot lists that come along. */
function importLabel(chosen: CatalogEntry[], picked: (entry: CatalogEntry) => boolean): string {
  const picks = chosen.filter(picked).length;
  const ballots = chosen.some(isBallotEntry);
  const yours = picks === 1 ? "your pick" : `your ${picks} picks`;
  if (picks === 0) return "Downloading the official ballot lists";
  return ballots ? `Downloading ${yours} and the official ballot lists` : `Downloading ${yours}`;
}

/** The source a stored slate speaks for, or undefined if it doesn't parse. */
function sourceIdOfToken(token: string): string | undefined {
  try {
    return sourceIdOf(parseSlate(token).payload);
  } catch {
    return undefined;
  }
}

function WizardFooter({
  onBack,
  onSkip,
  children,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="wizard-footer">
      {onBack && (
        <button type="button" className="link" onClick={onBack}>
          ← Back
        </button>
      )}
      {onSkip && <SkipSetup onSkip={onSkip} />}
      <span className="grow" />
      {children}
    </div>
  );
}

/** How long the "we recommend you don't" nudge shows before the real button appears. */
const CONFIRM_ARM_DELAY_MS = 1200;

function SkipSetup({ onSkip }: { onSkip: () => void }) {
  return (
    <ConfirmLink
      label="Skip setup"
      nudge="We recommend you don't. It's easier and faster than doing it manually."
      confirm="Skip anyway"
      onConfirm={onSkip}
    />
  );
}

/**
 * A way out that takes two steps (skip setup, stop an import), so a newcomer
 * eager to "get to the real thing" reads why staying is worth it first.
 * Hovering (mouse) or pressing the link (touch, keyboard) shows the nudge;
 * after a short pause a separate confirm button appears beside it, out from
 * under a pointer that's still clicking the first one. Moving the mouse away
 * before then backs out.
 */
function ConfirmLink({
  label,
  nudge,
  confirm,
  onConfirm,
}: {
  label: string;
  nudge: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "hover" | "warned" | "armed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  function warn(next: "hover" | "warned") {
    if (stage === "armed") return;
    if (stage === "idle") {
      timer.current = setTimeout(() => setStage("armed"), CONFIRM_ARM_DELAY_MS);
    }
    // A press keeps the nudge open even if the mouse wanders off afterwards.
    if (stage !== "warned") setStage(next);
  }

  return (
    <span className="wizard-skip">
      <button
        type="button"
        className="link"
        aria-expanded={stage !== "idle"}
        onClick={() => warn("warned")}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") warn("hover");
        }}
        onPointerLeave={() => {
          if (stage !== "hover") return;
          clearTimeout(timer.current);
          setStage("idle");
        }}
      >
        {label}
      </button>
      <span className="wizard-skip-nudge" aria-live="polite">
        {stage !== "idle" && <span>{nudge}</span>}
        {stage === "armed" && (
          <button type="button" className="link" onClick={onConfirm}>
            {confirm}
          </button>
        )}
      </span>
    </span>
  );
}

/** The welcome step's answer to "what is this, and do I have to use this website?" */
function AboutOpenSlate() {
  return (
    <section className="wizard-about" aria-labelledby="wizard-about-heading">
      <h3 id="wizard-about-heading">What is OpenSlate?</h3>
      <p>
        A free tool for sharing endorsements anyone can check, and for lining up the ones you trust
        on your ballot. Every endorsement is signed, so you can see who issued it and that nobody
        changed it along the way.
      </p>
      <ul>
        {!isPublicSite() && (
          <li>
            <FlaskConical className="icon" />
            <span>
              <strong>Alpha.</strong> Written by AI with a human watching over it, so things might
              be wrong, change, or break. Check what matters, and help fix what isn't right.
            </span>
          </li>
        )}
        <li>
          <Lock className="icon" />
          <span>
            <strong>No account.</strong> Your picks, notes and signing keys stay in this browser.
            They're never sent to us, and reach others only when you share them.
          </span>
        </li>
        <li>
          <Code className="icon" />
          <span>
            <strong>Open source.</strong> Every line is public on GitHub under the MIT license: read
            it, check it, or help build it.
          </span>
        </li>
        <li>
          <Server className="icon" />
          <span>
            <strong>Don't want to use this website?</strong> Run your own copy. The app is plain
            files any web server can host, or that run on your own computer. A desktop app is on the
            way.
          </span>
        </li>
      </ul>
      <p className="wizard-about-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source code on GitHub
        </a>
        {" · "}
        <a href={`${REPO_URL}#how-to-run`} target="_blank" rel="noreferrer">
          How to run your own
        </a>
      </p>
    </section>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement>;

/**
 * The catalog's elections with how many organizations publish for each (a
 * ballot list keeps an election on the menu without counting as one).
 * Upcoming first (soonest first), then past (latest first).
 */
function electionsOf(entries: CatalogEntry[], today: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.election, (counts.get(entry.election) ?? 0) + (isBallotEntry(entry) ? 0 : 1));
  }
  return [...counts.entries()].sort(([a], [b]) => {
    const ap = a < today;
    const bp = b < today;
    return ap !== bp ? Number(ap) - Number(bp) : ap ? b.localeCompare(a) : a.localeCompare(b);
  });
}

function ElectionStep({
  headingRef,
  elections,
  today,
  isLoading,
  error,
  election,
  setElection,
  onBack,
  onNext,
  onSkip,
  onManual,
}: {
  headingRef: HeadingRef;
  elections: Array<[string, number]>;
  today: string;
  isLoading: boolean;
  error: Error | null;
  election: string;
  setElection: (next: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onManual: () => void;
}) {
  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Which election?
      </h2>
      {isLoading && <ProgressBar label="Loading the public catalog" value={0} />}
      {error && (
        <>
          <p className="error">Couldn't load the public catalog: {error.message}</p>
          <p>
            You can still add endorsements yourself: paste one a friend sent, or load one from a
            link.
          </p>
        </>
      )}
      {elections.length > 0 && (
        <RadioGroup
          aria-label="Election"
          className="wizard-options"
          value={election}
          onChange={setElection}
        >
          {elections.map(([date, count]) => (
            <Radio key={date} value={date} variant="card">
              <span className="grow">
                <strong>{formatElectionDate(date)}</strong>
                {date < today && <span className="tag tag-inline">past</span>}
              </span>
              <span className="hint">{count} organizations</span>
            </Radio>
          ))}
        </RadioGroup>
      )}
      <WizardFooter onBack={onBack} onSkip={onSkip}>
        {error ? (
          <button type="button" className="primary" onClick={onManual}>
            Add sources myself
          </button>
        ) : (
          <button type="button" className="primary" onClick={onNext} disabled={!election}>
            Next →
          </button>
        )}
      </WizardFooter>
    </>
  );
}

/** Each of the election's catalog entries, summarized; `done` of `total` slates read so far. */
interface ElectionSummaries {
  entries: EntrySummary[];
  /** Slates read so far, for entries the catalog doesn't summarize. */
  done: number;
  total: number;
}

/**
 * Where each of the election's organizations has races, for the area and
 * sources steps. A current catalog says so per entry, so this is immediate and
 * downloads nothing. For an older catalog's entries it fetches the slates
 * (once `active`), and reads them without checking signatures: it's only a
 * preview, and the import checks every slate it keeps.
 */
function useElectionSummaries(
  entries: CatalogEntry[] | undefined,
  election: string,
  active: boolean,
): ElectionSummaries {
  const forElection = useMemo(
    () => (entries ?? []).filter((e) => e.election === election),
    [entries, election],
  );
  const unsummarized = useMemo(() => forElection.filter((e) => !isSummarized(e)), [forElection]);
  const results = useQueries({
    queries: unsummarized.map((entry) => ({
      ...slateFromUrlOptions(catalogEntryUrl(entry, CATALOG_URL)),
      staleTime: 1000 * 60 * 5,
      enabled: active,
    })),
  });
  // Each slate is read once, however many times the list re-renders as the
  // rest arrive.
  const payloads = useRef(new Map<string, SlatePayload | undefined>());
  const tokens = results.map((r) => r.data);
  // useQueries returns new objects every render; key the memo on what matters.
  const resultKey = results.map((r) => `${r.status}:${r.data ?? ""}`).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on result contents
  return useMemo<ElectionSummaries>(() => {
    const tokenOf = new Map(unsummarized.map((entry, i) => [entry.path, tokens[i]]));
    const payloadOf = (token: string) => {
      if (!payloads.current.has(token)) {
        let payload: SlatePayload | undefined;
        try {
          payload = parseSlate(token).payload;
        } catch {
          payload = undefined;
        }
        payloads.current.set(token, payload);
      }
      return payloads.current.get(token);
    };
    return {
      entries: forElection.map((entry) => {
        const token = tokenOf.get(entry.path);
        return summaryOf(entry, token ? payloadOf(token) : undefined);
      }),
      done: results.filter((r) => r.status !== "pending").length,
      total: unsummarized.length,
    };
  }, [forElection, unsummarized, resultKey]);
}

/**
 * Shown while an older catalog's slates load: a bar, and a firm word against
 * skipping, since without them the next steps can't match anyone to your ballot.
 */
function SummariesWait({ summaries }: { summaries: ElectionSummaries }) {
  if (summaries.done >= summaries.total) return null;
  return (
    <div className="wizard-wait">
      <ProgressBar label="Loading endorsements" value={summaries.done} maxValue={summaries.total} />
      <p>
        <strong>Please wait for this to finish.</strong> This catalog doesn't say where each
        organization's endorsements are, so we read them all to match them to your ballot. If you
        skip setup now, you'll have to find your sources by hand.
      </p>
    </div>
  );
}

function AreaStep({
  headingRef,
  summaries,
  election,
  area,
  setArea,
  onBack,
  onNext,
  onSkip,
}: {
  headingRef: HeadingRef;
  summaries: ElectionSummaries;
  election: string;
  area: Area;
  setArea: (next: Area) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const options = useMemo(
    () => areaOptionsOf(summaryJurisdictions(summaries.entries)),
    [summaries],
  );

  const loading = summaries.done < summaries.total;

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Where do you vote?
      </h2>
      <p>
        This trims a statewide list to the races on your ballot. It's optional, stays in this
        browser, and you can change it any time.
      </p>
      {loading ? (
        <SummariesWait summaries={summaries} />
      ) : (
        <AreaPicker options={options} area={area} election={election} onChange={setArea} />
      )}
      <WizardFooter onBack={onBack} onSkip={onSkip}>
        {/* Picking an area is the way through; showing everything stays a quiet
            way out, and only once there's a picker to pass up. */}
        {!loading && !isAreaSet(area) && (
          <button type="button" className="hollow" onClick={onNext}>
            Show every race instead
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={onNext}
          disabled={loading || !isAreaSet(area)}
        >
          Next →
        </button>
      </WizardFooter>
    </>
  );
}

function SourcesStep({
  headingRef,
  summaries,
  election,
  area,
  selected,
  setSelected,
  downloadAll,
  setDownloadAll,
  onBack,
  onNext,
  onSkip,
}: {
  headingRef: HeadingRef;
  summaries: ElectionSummaries;
  election: string;
  area: Area;
  selected: Picks;
  setSelected: (next: Picks) => void;
  downloadAll: boolean;
  setDownloadAll: (next: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [showOthers, setShowOthers] = useState(false);

  // Each organization with how many races on *your* ballot it weighs in on,
  // grouped by where it publishes for (statewide, a city…).
  const ballots = summaries.entries.filter((s) => isBallotEntry(s.entry));
  const organizations = summaries.entries.length - ballots.length;
  const { groups, others } = useMemo(() => {
    const scored = summaries.entries
      .filter((s) => !isBallotEntry(s.entry))
      .map((s) => ({ entry: s.entry, races: racesInArea(s, area), scope: s.scope }));
    // A group that publishes for another city still weighs in on statewide
    // races, but it isn't "yours": list it under "based elsewhere".
    const elsewhere = (s: (typeof scored)[number]) => {
      if (!isAreaSet(area)) return false;
      const scope = parseJurisdiction(s.scope);
      return s.races === 0 || (scope.kind === "local" && !area.localities.includes(scope.path));
    };
    const relevant = scored.filter((s) => !elsewhere(s));
    const byScope = new Map<string, typeof scored>();
    for (const s of relevant) {
      const label = jurisdictionLabel(s.scope);
      byScope.set(label, [...(byScope.get(label) ?? []), s]);
    }
    return {
      groups: [...byScope.entries()]
        .map(([label, items]) => ({
          label,
          rank: jurisdictionRank(items[0]?.scope),
          items: items.sort(
            (a, b) =>
              b.races - a.races ||
              (a.entry.attribution?.of.name ?? "").localeCompare(
                b.entry.attribution?.of.name ?? "",
              ),
          ),
        }))
        .sort((a, b) => a.rank - b.rank || b.items.length - a.items.length),
      others: scored.filter(elsewhere).sort((a, b) => b.races - a.races),
    };
  }, [summaries, area]);

  function pick(path: string, standing: Standing) {
    const next = new Map(selected);
    if (standing === "off") next.delete(path);
    else next.set(path, standing);
    setSelected(next);
  }

  const following = [...selected.values()].filter((s) => s === "follow").length;
  const disagreeing = selected.size - following;
  const followLabel = [
    following > 0 ? `follow ${following}` : "",
    disagreeing > 0 ? `disagree with ${disagreeing}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  function renderItem(item: { entry: CatalogEntry; races: number }) {
    const { entry } = item;
    const standing = selected.get(entry.path) ?? "off";
    const name = entry.attribution?.of.name ?? entry.slug;
    return (
      <div key={entry.path} className={`wizard-source standing-${standing}`}>
        <EndorserAvatar
          sourceId={sourceIdOf(entry)}
          name={name}
          size="md"
          logo={catalogEntryLogoUrl(entry, CATALOG_URL)}
          logoBackground={entry.logo_background}
        />
        <span className="grow">
          <strong>{name}</strong>
          {entry.attribution?.of.uri && (
            <>
              {" "}
              <a href={entry.attribution.of.uri} target="_blank" rel="noreferrer">
                site
              </a>
            </>
          )}
        </span>
        <span className="hint wizard-source-meta">
          {item.races} race{item.races === 1 ? "" : "s"}
          {isAreaSet(area) ? " on your ballot" : ""}
          {entry.lean && (
            <LeanSummary sourceId={sourceIdOf(entry)} lean={{ ...entry.lean, via: "catalog" }} />
          )}
        </span>
        <StandingToggle name={name} value={standing} onChange={(next) => pick(entry.path, next)} />
      </div>
    );
  }

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Whose recommendations do you trust?
      </h2>
      <p>
        Follow a few for {formatElectionDate(election)}: a party, a newspaper, groups that share
        your values. Mark ones you disagree with too: what they back counts against it on your
        ballot, and what they oppose counts for it. You can change this later on the Sources page.
      </p>
      <SummariesWait summaries={summaries} />
      <div className="wizard-scroll">
        {groups.map((group) => (
          <fieldset key={group.label} className="wizard-group">
            <legend>{group.label}</legend>
            {group.items.map(renderItem)}
          </fieldset>
        ))}
        {others.length > 0 && (
          <fieldset className="wizard-group">
            <legend>
              <button type="button" className="link" onClick={() => setShowOthers((v) => !v)}>
                {showOthers ? "▾" : "▸"} {others.length} more based elsewhere
              </button>
            </legend>
            {showOthers && others.map(renderItem)}
          </fieldset>
        )}
      </div>
      <p className="hint">
        These are secondhand reports: a researcher's signed record of what each organization
        published. Have a slate from a friend? Add it on the Sources page afterwards.
        {ballots.length > 0 && (
          <>
            {" "}
            The official candidate list from{" "}
            {ballots.map((s) => s.entry.attribution?.of.name ?? s.entry.slug).join(" and ")} is
            included, so every race shows its whole field.
          </>
        )}
      </p>
      {organizations > 0 && (
        <Checkbox
          className="wizard-download-all"
          isSelected={downloadAll}
          onChange={setDownloadAll}
        >
          <span>
            <strong>Download all {organizations} organizations' lists, not just my picks</strong>
            <span className="hint ui-option-note">
              More private: the server can't tell whose recommendations you use. The ones you didn't
              pick are kept for comparison, not followed. It's a bigger download.
            </span>
          </span>
        </Checkbox>
      )}
      <WizardFooter onBack={onBack} onSkip={onSkip}>
        {/* Following someone is the way through, as on the area step. */}
        {selected.size === 0 && (
          <button type="button" className="hollow" onClick={onNext}>
            {downloadAll ? "Download without following" : "Continue without sources"}
          </button>
        )}
        <button type="button" className="primary" onClick={onNext} disabled={selected.size === 0}>
          {selected.size === 0
            ? "Follow and see my ballot →"
            : `${followLabel.charAt(0).toUpperCase()}${followLabel.slice(1)} and see my ballot →`}
        </button>
      </WizardFooter>
    </>
  );
}

function IdentityStep({
  headingRef,
  onBack,
  onDone,
  onSkip,
}: {
  headingRef: HeadingRef;
  onBack: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const { all, setActiveKey } = useActiveIdentity();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "organization">("individual");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const created = all.find((i) => i.publicKey === createdKey);
  const [backedUp, setBackedUp] = useState(false);

  function create() {
    const stored = serializeIdentity(
      createIdentity(name.trim() ? { name: name.trim(), kind } : { kind }),
    );
    addIdentity(stored);
    setActiveKey(stored.publicKey);
    track({ name: "identity.create" });
    setCreatedKey(stored.publicKey);
  }

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        {created ? "Back up your identity" : "Create your signing identity"}
      </h2>
      {!created ? (
        <>
          <p>
            Your identity is a key pair. It signs your endorsements so anyone can check they came
            from you and weren't changed. The secret half never leaves this browser.
          </p>
          {all.length > 0 && (
            <p className="hint">
              You already have {all.length} identit{all.length === 1 ? "y" : "ies"}. You can go
              straight to Compose, or make another.
            </p>
          )}
          <TextField
            label="Name people will see (optional)"
            value={name}
            placeholder="e.g. Jamie Rivera, or Elm Street Tenants Association"
            onChange={setName}
          />
          <RadioGroup
            aria-label="Who is publishing"
            className="wizard-kind"
            orientation="horizontal"
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
          >
            <Radio value="individual" variant="card">
              <span>
                <strong>Just me</strong>
                <span className="hint ui-option-note">My own recommendations</span>
              </span>
            </Radio>
            <Radio value="organization" variant="card">
              <span>
                <strong>An organization</strong>
                <span className="hint ui-option-note">A group's endorsements</span>
              </span>
            </Radio>
          </RadioGroup>
          <WizardFooter onBack={onBack} onSkip={onSkip}>
            {all.length > 0 && (
              <button type="button" onClick={onDone}>
                Go to Compose
              </button>
            )}
            <button type="button" className="primary" onClick={create}>
              Create identity
            </button>
          </WizardFooter>
        </>
      ) : (
        <>
          <p>
            Created <strong>{created.name ?? "your identity"}</strong>. Download a backup now: if
            this browser's data is cleared, the backup is the only way to keep signing as{" "}
            {created.name ?? "you"}. Anyone with the file can sign as you, so keep it private.
          </p>
          <code className="key">{created.publicKey}</code>
          <WizardFooter>
            <button
              type="button"
              className={backedUp ? "" : "primary"}
              onClick={() => {
                downloadIdentityBackup(created);
                setBackedUp(true);
              }}
            >
              {backedUp ? "Downloaded ✓" : "Download backup"}
            </button>
            <button type="button" className={backedUp ? "primary" : "hollow"} onClick={onDone}>
              Continue to Compose →
            </button>
          </WizardFooter>
        </>
      )}
    </>
  );
}
