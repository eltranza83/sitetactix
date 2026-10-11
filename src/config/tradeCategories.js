/**
 * The one list of the 9 categories and 26 phases, in Sheet order.
 * Everything reads from here: the scan AI, the Edit screen, X-Ray, the Sheet sync and the Dashboard.
 * `key` is the app's internal category key; `name` matches the Sheet exactly.
 * `noSub` lists phases that are not paid to a sub (the Dashboard shows no "Payee" line for them).
 */
export const TRADE_CATEGORIES = [
  { key: 'Paperwork_&_Permits', name: 'Paperwork & Permits', phases: ['Paperwork & Permits'], noSub: ['Paperwork & Permits'] },
  { key: 'Site_Prep_&_Structure', name: 'Site Prep & Structure', phases: ['Foundation & Flatwork', 'Roofing', 'Windows & Exterior Doors'], noSub: ['Windows & Exterior Doors'] },
  { key: 'Framing_&_Lumber', name: 'Framing & Lumber', phases: ['Framing Lumber & Truss'] },
  { key: 'Mechanicals_&_Utilities', name: 'Mechanicals & Utilities', phases: ['Plumbing Rough-In', 'Electrical & Lighting', 'HVAC / AC Systems', 'Insulation & Alarms'] },
  { key: 'Interior_Finishes', name: 'Interior Finishes', phases: ['Drywall & Sheetrock', 'Cabinets & Trim Carpentry', 'Quartz & Countertops', 'Glass Work'] },
  { key: 'Paint_Tile', name: 'Paint & Tile', phases: ['Tile & Flooring', 'Paint & Finishes'] },
  { key: 'Interior_Hardware', name: 'Interior Hardware', phases: ['Plumbing Hardware Fixtures', 'Electrical Hardware Fixtures'], noSub: ['Plumbing Hardware Fixtures', 'Electrical Hardware Fixtures'] },
  { key: 'House_Exterior_&_Yard', name: 'House Exterior & Yard', phases: ['Stucco & Masonry', 'Garage Doors', 'Driveway & Sidewalks', 'Cantera Stone Detail', 'Fencing & Gates', 'Landscaping & Irrigation'], noSub: ['Garage Doors'] },
  { key: 'Project_Overhead_&_Bills', name: 'Project Overhead & Bills', phases: ['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Extra Costs & Misc'], noSub: ['Monthly Utility Bills', 'Extra Costs & Misc'] }
];

export const ALL_CATEGORY_KEYS = TRADE_CATEGORIES.map(c => c.key);
export const ALL_PHASES = TRADE_CATEGORIES.flatMap(c => c.phases);

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Position of a category (by key or name) in Sheet order; unknown names sort last. */
export function categoryRank(keyOrName) {
  const wanted = norm(keyOrName);
  const index = TRADE_CATEGORIES.findIndex(c => norm(c.key) === wanted || norm(c.name) === wanted);
  return index === -1 ? 99 : index;
}

/** True when a phase is normally paid to a sub (so the Dashboard tracks a payee for it). */
export function phaseHasSub(phase) {
  const wanted = norm(phase);
  const category = TRADE_CATEGORIES.find(c => c.phases.some(p => norm(p) === wanted));
  if (!category) return false;
  return !(category.noSub || []).some(p => norm(p) === wanted);
}
