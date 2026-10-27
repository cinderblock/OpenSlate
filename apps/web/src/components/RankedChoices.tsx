import { GripVertical } from "lucide-react";
import { Button, GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { type DraftRow, rowIdFor, useRanking } from "../lib/ballotDraft";
import { ballotChoices, choiceRowClass } from "../lib/ballotView";
import type { Race } from "../lib/collate";
import {
  type ApplyRank,
  markChange,
  marksFor,
  moveNames,
  pickChange,
  type RankChange,
  rankingOf,
  reorderChange,
  unrankedNames,
  writeInGroup,
} from "../lib/ranking";
import { ChoiceRowContent } from "./ChoiceRow";

/** The line between ranked names and the rest; never a candidate's name. */
const LINE = "\u0000line";

/**
 * A candidate race as the user's ranking (lib/ranking.ts): the names they'd
 * vote for in order, a line, then everyone else in ballot order. Drag a name
 * (or the line) to rank, re-rank or unrank; the bubble does the same in one
 * tap. The first few ranked are marked on the ballot, the rest are backups.
 * React Aria's drag and drop: by pointer, touch, keyboard or screen reader.
 */
export function RankedChoices({
  race,
  election,
  rows,
  applyRank,
  numbered,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  applyRank: ApplyRank;
  /** Show each choice's key (focus mode). */
  numbered?: boolean;
}) {
  const saved = useRanking(election, race.subject);
  const order = rankingOf(race, election, rows, saved);
  const unranked = unrankedNames(race, election, rows, order);
  const marks = marksFor(race);
  const groups = new Map(ballotChoices(race).map((group) => [group.choice, group]));
  const items = [...order, LINE, ...unranked].map((id) => ({ id }));
  const apply = (change: RankChange) => applyRank(election, race.subject, change);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({ "text/plain": key === LINE ? "Not ranked" : String(key) })),
    onReorder: (event) => {
      const target = event.target;
      const moved = moveNames(
        items.map((item) => item.id),
        [...event.keys].map(String),
        String(target.key),
        target.dropPosition === "before" ? "before" : "after",
      );
      apply(reorderChange(race, election, rows, saved, moved.slice(0, moved.indexOf(LINE))));
    },
  });

  const shown = [...order, ...unranked];
  return (
    <GridList
      aria-label={`Your ranking for ${race.subject.title}`}
      className="choice-list ranked-list"
      items={items}
      dragAndDropHooks={dragAndDropHooks}
      keyboardNavigationBehavior="tab"
    >
      {({ id }) => {
        if (id === LINE) {
          return (
            <GridListItem id={LINE} textValue="Not ranked" className="rank-line">
              <Button slot="drag" className="drag-handle" aria-label="Move the not-ranked line">
                <GripVertical className="icon" />
              </Button>
              <span>
                {order.length === 0
                  ? "Not ranked yet: tap a bubble, or drag names above this line in the order you'd pick them"
                  : unranked.length > 0
                    ? "Not ranked"
                    : "Everyone is ranked"}
              </span>
            </GridListItem>
          );
        }
        const group = groups.get(id) ?? writeInGroup(id);
        const at = order.indexOf(id);
        const rank = at === -1 ? undefined : at + 1;
        const backup = at >= marks;
        const stance = rows[rowIdFor(election, race.subject, id)]?.stance;
        const key = shown.indexOf(id);
        return (
          <GridListItem
            id={id}
            textValue={id}
            className={`${choiceRowClass(stance, backup)}${at === marks ? " first-backup" : ""}`}
          >
            <ChoiceRowContent
              group={group}
              race={race}
              stance={stance}
              rank={rank}
              backup={backup}
              shortcut={numbered && key < 9 ? key + 1 : undefined}
              onPick={() => apply(pickChange(race, election, rows, saved, id))}
              onMark={(next) => apply(markChange(race, election, rows, saved, id, next))}
              handle={
                <Button slot="drag" className="drag-handle" aria-label={`Move ${id}`}>
                  <GripVertical className="icon" />
                </Button>
              }
            />
          </GridListItem>
        );
      }}
    </GridList>
  );
}
