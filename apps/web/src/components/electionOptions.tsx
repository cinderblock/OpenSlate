import { formatElectionDate } from "../lib/dates";
import type { SelectOption } from "./ui/Select";

/**
 * Election dates as Select options: the date, a "past"/"today" tag, and
 * optionally how many races each has.
 */
export function electionOptions(
  elections: Array<{ date: string; races?: number }>,
  today: string,
): SelectOption[] {
  return elections.map(({ date, races }) => {
    const when = date < today ? "past" : date === today ? "today" : null;
    return {
      id: date,
      textValue: formatElectionDate(date),
      label: (
        <>
          {formatElectionDate(date)}
          {when && <span className="tag tag-inline">{when}</span>}
        </>
      ),
      badge: races != null ? `${races} races` : undefined,
    };
  });
}
