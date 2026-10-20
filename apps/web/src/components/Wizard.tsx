import { type SlatePayload, createIdentity, serializeIdentity, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { catalogEntryUrl, importCatalogEntry } from "../lib/catalogImport";
import { areaOptionsOf } from "../lib/collate";
import { addIdentity, identityCollection, slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { useActiveIdentity } from "../lib/identities";
import { downloadIdentityBackup } from "../lib/identityBackup";
import {
  type Area,
  inArea,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  parseJurisdiction,
} from "../lib/jurisdictions";
import {
  areaStore,
  localToday,
  myElectionStore,
  onboardingStore,
  setFollowed,
  useOnboarding,
} from "../lib/myVote";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogQueryOptions,
  slateFromUrlOptions,
} from "../lib/query";
import { sourceIdOf } from "../lib/sources";
import { subjectKey } from "../lib/subjects";
import { track } from "../lib/usage";
import { closeWizard, openWizard, useWizardOpen } from "../lib/wizard";
import { AreaPicker } from "./AreaPicker";
import { isBallotEntry } from "./CatalogBrowser";
import { Checkbox } from "./ui/Checkbox";
import { Radio, RadioGroup } from "./ui/Radio";
import { TextField } from "./ui/TextField";

type Step = "welcome" | "election" | "area" | "sources" | "importing" | "identity";

const VOTE_STEPS: Step[] = ["election", "area", "sources"];

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

/**
 * Mounted once in the layout. Opens itself on a first visit (nothing imported,
 * no identity, never finished or skipped); "Get started" reopens it any time.
 */
export function WizardHost() {
  const open = useWizardOpen();
  const [onboarding] = useOnboarding();
  const slates = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const identities = useLiveQuery((q) => q.from({ identity: identityCollection }));
  const firstVisit =
    onboarding === "" &&
    slates.isReady &&
    identities.isReady &&
    slates.data.length === 0 &&
    identities.data.length === 0;

  useEffect(() => {
    if (firstVisit) openWizard();
  }, [firstVisit]);

  return open ? <Wizard /> : null;
}

function Wizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("welcome");
  const [election, setElection] = useState("");
  const [area, setArea] = useState<Area>(() => areaStore.get());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const catalog = useQuery(catalogQueryOptions(CATALOG_URL));
  const { data: imported } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

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

  async function followSelected(entries: CatalogEntry[]) {
    areaStore.set(area);
    myElectionStore.set(election);
    // Official candidate lists always come along: they're the ballot itself.
    const chosen = entries.filter((e) => selected.has(e.path) || isBallotEntry(e));
    if (chosen.length === 0) {
      finish("vote");
      return;
    }
    setStep("importing");
    setProgress({ done: 0, total: chosen.length });
    const known = new Set(imported.map((s) => s.token));
    const errors: string[] = [];
    for (const [i, entry] of chosen.entries()) {
      const result = await importCatalogEntry(entry, CATALOG_URL, known, queryClient);
      if (result.kind === "error") {
        errors.push(`${entry.attribution?.of.name ?? entry.slug}: ${result.error}`);
      } else if (!isBallotEntry(entry)) {
        setFollowed(sourceIdOf(entry), true);
      }
      setProgress({ done: i + 1, total: chosen.length });
    }
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
          <div className="wizard-choices">
            <button type="button" className="wizard-choice" onClick={() => setStep("election")}>
              <span className="wizard-choice-icon" aria-hidden="true">
                🗳
              </span>
              <strong>Plan my vote</strong>
              <span>
                Pick the organizations you trust and see their endorsements side by side, race by
                race.
              </span>
            </button>
            <button type="button" className="wizard-choice" onClick={() => setStep("identity")}>
              <span className="wizard-choice-icon" aria-hidden="true">
                ✍
              </span>
              <strong>Publish endorsements</strong>
              <span>
                Sign your own recommendations so friends or members can verify they came from you.
              </span>
            </button>
          </div>
          <WizardFooter onSkip={skip} />
        </>
      )}

      {step === "election" && (
        <ElectionStep
          headingRef={headingRef}
          entries={catalog.data?.entries}
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

      {(step === "area" || step === "sources") && catalog.data && (
        <ElectionSlates entries={catalog.data.entries} election={election}>
          {(loaded) =>
            step === "area" ? (
              <AreaStep
                headingRef={headingRef}
                loaded={loaded}
                area={area}
                setArea={setArea}
                onBack={() => setStep("election")}
                onNext={() => setStep("sources")}
                onSkip={skip}
              />
            ) : (
              <SourcesStep
                headingRef={headingRef}
                loaded={loaded}
                election={election}
                area={area}
                selected={selected}
                setSelected={setSelected}
                onBack={() => setStep("area")}
                onNext={() => followSelected(loaded.entries.map((l) => l.entry))}
                onSkip={skip}
              />
            )
          }
        </ElectionSlates>
      )}

      {step === "importing" && (
        <>
          <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
            {importErrors.length > 0 ? "Some sources didn't import" : "Setting up your ballot…"}
          </h2>
          {progress && (
            <p>
              Imported {progress.done} of {progress.total}.
            </p>
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
      {onSkip && (
        <button type="button" className="link" onClick={onSkip}>
          Skip setup
        </button>
      )}
      <span className="grow" />
      {children}
    </div>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement>;

function ElectionStep({
  headingRef,
  entries,
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
  entries: CatalogEntry[] | undefined;
  isLoading: boolean;
  error: Error | null;
  election: string;
  setElection: (next: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onManual: () => void;
}) {
  const today = localToday();
  const elections = useMemo(() => {
    // Organizations per election; a ballot list keeps the election on the menu
    // without counting as one.
    const counts = new Map<string, number>();
    for (const entry of entries ?? []) {
      counts.set(
        entry.election,
        (counts.get(entry.election) ?? 0) + (isBallotEntry(entry) ? 0 : 1),
      );
    }
    // Upcoming first (soonest first), then past (latest first).
    return [...counts.entries()].sort(([a], [b]) => {
      const ap = a < today;
      const bp = b < today;
      return ap !== bp ? Number(ap) - Number(bp) : ap ? b.localeCompare(a) : a.localeCompare(b);
    });
  }, [entries, today]);

  // Preselect the next upcoming election.
  useEffect(() => {
    if (!election && elections[0]) setElection(elections[0][0]);
  }, [election, elections, setElection]);

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Which election?
      </h2>
      {isLoading && <p className="hint">Loading the public catalog…</p>}
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

interface LoadedEntry {
  entry: CatalogEntry;
  payload?: SlatePayload;
}

interface Loaded {
  entries: LoadedEntry[];
  done: number;
  total: number;
}

/** Fetch the election's catalog slates once; both the area and sources steps read them. */
function ElectionSlates({
  entries,
  election,
  children,
}: {
  entries: CatalogEntry[];
  election: string;
  children: (loaded: Loaded) => React.ReactNode;
}) {
  const forElection = useMemo(
    () => entries.filter((e) => e.election === election),
    [entries, election],
  );
  const results = useQueries({
    queries: forElection.map((entry) => ({
      ...slateFromUrlOptions(catalogEntryUrl(entry, CATALOG_URL)),
      staleTime: 1000 * 60 * 5,
    })),
  });
  const tokens = results.map((r) => r.data);
  // useQueries returns new objects every render; key the memo on what matters.
  const resultKey = results.map((r) => `${r.status}:${r.data ?? ""}`).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on result contents
  const loaded = useMemo<Loaded>(() => {
    const out = forElection.map((entry, i) => {
      const token = tokens[i];
      const payload = token ? verifySlate(token).payload : undefined;
      return payload ? { entry, payload } : { entry };
    });
    return {
      entries: out,
      done: results.filter((r) => !r.isLoading).length,
      total: forElection.length,
    };
  }, [forElection, resultKey]);
  return <>{children(loaded)}</>;
}

function positionJurisdiction(payload: SlatePayload, index: number): string | undefined {
  return payload.positions[index]?.subject.jurisdiction ?? payload.context?.jurisdiction;
}

function AreaStep({
  headingRef,
  loaded,
  area,
  setArea,
  onBack,
  onNext,
  onSkip,
}: {
  headingRef: HeadingRef;
  loaded: Loaded;
  area: Area;
  setArea: (next: Area) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const options = useMemo(() => {
    const positions: Array<{ jurisdiction?: string }> = [];
    for (const { payload } of loaded.entries) {
      if (!payload) continue;
      payload.positions.forEach((_, i) => {
        positions.push({ jurisdiction: positionJurisdiction(payload, i) });
      });
    }
    return areaOptionsOf(positions);
  }, [loaded]);

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Where do you vote?
      </h2>
      <p>
        This trims a statewide list to the races on your ballot. It's optional, stays in this
        browser, and you can change it any time.
      </p>
      {loaded.done < loaded.total ? (
        <p className="hint">
          Loading endorsements… {loaded.done} of {loaded.total}
        </p>
      ) : (
        <AreaPicker options={options} area={area} onChange={setArea} />
      )}
      <WizardFooter onBack={onBack} onSkip={onSkip}>
        <button type="button" className="primary" onClick={onNext}>
          {isAreaSet(area) ? "Next →" : "Skip, show everything →"}
        </button>
      </WizardFooter>
    </>
  );
}

function SourcesStep({
  headingRef,
  loaded,
  election,
  area,
  selected,
  setSelected,
  onBack,
  onNext,
  onSkip,
}: {
  headingRef: HeadingRef;
  loaded: Loaded;
  election: string;
  area: Area;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [showOthers, setShowOthers] = useState(false);

  // Each organization with how many races on *your* ballot it weighs in on,
  // grouped by where it publishes for (statewide, a city…).
  const ballots = loaded.entries.filter((l) => isBallotEntry(l.entry));
  const { groups, others } = useMemo(() => {
    const scored = loaded.entries
      .filter((l) => !isBallotEntry(l.entry))
      .map(({ entry, payload }) => {
        const races = new Set<string>();
        payload?.positions.forEach((position, i) => {
          if (inArea(positionJurisdiction(payload, i), area))
            races.add(subjectKey(position.subject));
        });
        return { entry, races: races.size, scope: payload?.context?.jurisdiction };
      });
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
  }, [loaded, area]);

  function toggle(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  }

  function renderItem(item: { entry: CatalogEntry; races: number }) {
    const { entry } = item;
    const on = selected.has(entry.path);
    const name = entry.attribution?.of.name ?? entry.slug;
    return (
      <Checkbox key={entry.path} variant="card" isSelected={on} onChange={() => toggle(entry.path)}>
        <span className="grow">
          <strong>{name}</strong>
          {entry.attribution?.of.uri && (
            <>
              {" "}
              <a
                href={entry.attribution.of.uri}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                site
              </a>
            </>
          )}
        </span>
        <span className="hint">
          {item.races} race{item.races === 1 ? "" : "s"}
          {isAreaSet(area) ? " on your ballot" : ""}
        </span>
      </Checkbox>
    );
  }

  return (
    <>
      <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
        Whose recommendations do you trust?
      </h2>
      <p>
        Pick a few for {formatElectionDate(election)}: a party, a newspaper, groups that share your
        values. Pick ones you disagree with too if you want the contrast. You can change this later
        on the Sources page.
      </p>
      {loaded.done < loaded.total && (
        <p className="hint">
          Loading endorsements… {loaded.done} of {loaded.total}
        </p>
      )}
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
            {ballots.map((l) => l.entry.attribution?.of.name ?? l.entry.slug).join(" and ")} is
            included, so every race shows its whole field.
          </>
        )}
      </p>
      <WizardFooter onBack={onBack} onSkip={onSkip}>
        <button type="button" className="primary" onClick={onNext}>
          {selected.size === 0
            ? "Continue without sources"
            : `Follow ${selected.size} and see my ballot →`}
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
            <button type="button" className={backedUp ? "primary" : ""} onClick={onDone}>
              Continue to Compose →
            </button>
          </WizardFooter>
        </>
      )}
    </>
  );
}
