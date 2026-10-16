/**
 * Punch items keep their floor plan pin as floorPlanX / floorPlanY (percent of the plan).
 * An item without a pin stores null. Number(null) is 0, so a plain number check would
 * treat "no pin" as a pin in the top-left corner: always use these instead.
 */

/** The pin position as a number, or null when there is none. */
export function pinCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasFloorPlanPin(issue) {
  return pinCoordinate(issue?.floorPlanX) !== null && pinCoordinate(issue?.floorPlanY) !== null;
}

/** A punch item placed on the floor plan (not deleted). */
export function isLocatedIssue(issue) {
  return !issue?.deletedAt && hasFloorPlanPin(issue);
}

/** Punch items shown on the floor plan: resolved ones only when the user asks to see them. */
export function visibleBlueprintIssues(issues, showResolved = false) {
  const located = (issues || []).filter(isLocatedIssue);
  return showResolved ? located : located.filter(issue => issue.status !== 'resolved');
}
