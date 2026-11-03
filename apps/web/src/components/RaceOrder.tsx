import { GripVertical, ListOrdered } from "lucide-react";
import { useState } from "react";
import { Button, GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { ballotChoices, isYesNo } from "../lib/ballotView";
import type { Race } from "../lib/collate";
import { setOrderOverride } from "../lib/orderOverrides";
import { moveNames } from "../lib/ranking";

/** The names the ballot prints for a race, in the order the app shows them. */
function printedNames(race: Race): string[] {
  return ballotChoices(race)
    .filter((group) => group.choice !== "" && group.onBallot && !group.writeIn)
    .map((group) => group.choice);
}

/** A race the voter can put in their own ballot's order: listed, two names or more. */
function reorderable(race: Race): boolean {
  return race.onBallot && !isYesNo(race) && printedNames(race).length >= 2;
}

/**
 * How sure the race's order is (`Race.orderBasis`), and, on screen, a way to
 * put the names in the order the voter's own ballot prints them when the app
 * is wrong or can't tell (`orderOverrides.ts`). In print only an unsure
 * order is noted.
 */
export function RaceOrderNote({ race, print }: { race: Race; print?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (print) {
    return race.orderBasis === "varies" ? (
      <div className="pb-race-detail">Your ballot may list these names in another order.</div>
    ) : null;
  }
  if (!reorderable(race)) return null;
  if (editing) return <OrderEditor race={race} onDone={() => setEditing(false)} />;
  const fix = (label: string) => (
    <Button className="link" onPress={() => setEditing(true)}>
      {label}
    </Button>
  );
  switch (race.orderBasis) {
    case "varies":
      return (
        <p className="race-order hint no-print">
          Your ballot may list these names in another order. {race.orderNote}{" "}
          {fix("Match my ballot")}
        </p>
      );
    case "likely":
      return (
        <p className="race-order hint no-print">
          Probably your ballot's order: {lowerFirst(race.orderNote)} {fix("Fix the order")}
        </p>
      );
    case "yours":
      return (
        <p className="race-order hint no-print">
          In the order you set from your ballot. {fix("Change")}{" "}
          <Button className="link" onPress={() => setOrderOverride(race, undefined)}>
            Use the app's order
          </Button>
        </p>
      );
    default:
      return <p className="race-order hint no-print">{fix("Different order on your ballot?")}</p>;
  }
}

function lowerFirst(text: string | undefined): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

/**
 * Drag the names into the ballot's order, by pointer, touch, keyboard or
 * screen reader (React Aria's drag and drop), then save it on this device.
 */
function OrderEditor({ race, onDone }: { race: Race; onDone: () => void }) {
  const [order, setOrder] = useState(() => printedNames(race));
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder: (event) =>
      setOrder((current) =>
        moveNames(
          current,
          [...event.keys].map(String),
          String(event.target.key),
          event.target.dropPosition === "before" ? "before" : "after",
        ),
      ),
  });
  return (
    <div className="race-order-editor no-print">
      <p className="hint">
        <ListOrdered className="icon" aria-hidden /> Drag the names into the order your ballot
        prints them. It's kept on this device only.
      </p>
      <GridList
        aria-label={`Ballot order for ${race.subject.title}`}
        className="choice-list ranked-list"
        items={order.map((id) => ({ id }))}
        dragAndDropHooks={dragAndDropHooks}
        keyboardNavigationBehavior="tab"
      >
        {({ id }) => (
          <GridListItem id={id} textValue={id} className="choice-row">
            <Button slot="drag" className="drag-handle" aria-label={`Move ${id}`}>
              <GripVertical className="icon" />
            </Button>
            <span>{id}</span>
          </GridListItem>
        )}
      </GridList>
      <div className="race-order-actions">
        <Button
          className="primary"
          onPress={() => {
            setOrderOverride(race, order);
            onDone();
          }}
        >
          Save this order
        </Button>
        <Button onPress={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
