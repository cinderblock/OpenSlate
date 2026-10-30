import type { Subject } from "@openslate/core";
import { Star } from "lucide-react";
import { followRace, isFollowing, unfollowRace, useFollowedRaces } from "../lib/followedRaces";

/**
 * Keep an eye on a race, or a candidate in it, under All races. Named for the
 * candidate when `choice` is set and `showName` asks for it, in a list where
 * the race's own button sits beside it.
 */
export function FollowButton({
  raceKey,
  subject,
  choice,
  showName,
}: {
  raceKey: string;
  subject: Subject;
  choice?: string;
  showName?: boolean;
}) {
  const [followed] = useFollowedRaces();
  const following = isFollowing(followed, raceKey, choice);
  const target = choice ?? subject.title;
  return (
    <button
      type="button"
      className={`follow-button no-print${following ? " following" : ""}`}
      aria-pressed={following}
      aria-label={`Follow ${target}`}
      onClick={() =>
        following ? unfollowRace(raceKey, choice) : followRace(raceKey, subject, choice)
      }
    >
      <Star className="icon" aria-hidden="true" />
      {following ? "Following" : "Follow"}
      {showName && choice ? ` ${choice}` : ""}
    </button>
  );
}
