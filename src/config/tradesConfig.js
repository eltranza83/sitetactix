/**
 * Centralized Trade Categories Configuration
 * Single Source of Truth for Purchasing, Specs, and AI Trade Recognition
 */

export const TRADE_SECTION_MAP = {
  quartz: {
    id: 'quartz',
    title: 'Quartz Hardware',
    aliases: ['quartz', 'countertop', 'countertops', 'stone', 'granite', 'quartz guy', 'slab'],
    keywords: [
      'electrical pass-through', 'pass-through', 'caps', 'hole grommets', 'grommet',
      'quartz', 'countertop', 'sink cutout', 'support bracket', 'undermount sink clip',
      'seam adhesive', 'corbel', 'waterfall edge', 'backsplash bracket', 'sink', 'sinks'
    ]
  },
  electrical: {
    id: 'electrical',
    title: 'Electrical Hardware Fixtures',
    aliases: ['electrician', 'electrical', 'electric', 'lighting', 'lights', 'sparky'],
    keywords: [
      'security light', 'security lights', 'doorbell', 'chime kit', 'smart doorbell',
      'hanging light', 'porch light', 'exterior column light', 'column lights',
      'garage ceiling light', 'ceiling light', 'vanity light', 'vanity lights',
      'smart switch', 'smart switches', 'extension rod', 'extension rods',
      'ceiling fan', 'ceiling fans', 'gfci', 'gfi', 'outlet', 'outlets',
      'breaker', 'dimmer', 'dimmer switch', 'dimmer switches', 'can light', 'can lights', 'recessed light',
      'junction box', 'switch plate', 'motion sensor', 'under cabinet lighting'
    ]
  },
  plumbing: {
    id: 'plumbing',
    title: 'Plumbing Hardware Fixtures',
    aliases: ['plumber', 'plumbing', 'pipes', 'fixtures', 'water'],
    keywords: [
      'soap dispenser', 'garbage disposal', 'disposal button', 'air switch',
      'water heater', 'water heater stand', 'water heater tray', 'expansion tank',
      'shower kit', 'shower kits', 'toilet', 'toilets', 'rough-in valve',
      'shower valve', 'faucet', 'faucets', 'p-trap', 'drain', 'angle stop',
      'supply line', 'wax ring', 'flange', 'hose bibb', 'tub spout',
      'shower pan liner', 'shower head', 'cleanout plug'
    ]
  },
  hvac: {
    id: 'hvac',
    title: 'HVAC Hardware & Fixtures',
    aliases: ['hvac', 'ac', 'heating', 'cooling', 'air conditioning', 'mechanical'],
    keywords: [
      'thermostat', 'smart thermostat', 'vent', 'register', 'diffuser',
      'return grill', 'filter', 'furnace filter', 'condensate pump', 'line set',
      'exhaust fan', 'bath fan', 'damper', 'duct cap'
    ]
  },
  paint_drywall: {
    id: 'paint_drywall',
    title: 'Paint & Drywall Supplies',
    aliases: ['paint', 'painter', 'drywall', 'sheetrock', 'mud'],
    keywords: [
      'primer', 'paint', 'roller cover', 'tray liner', 'caulk',
      'joint compound', 'drywall tape', 'corner bead', 'sanding sponge',
      'sheen', 'drop cloth', 'masking tape', 'patch kit'
    ]
  },
  general: {
    id: 'general',
    title: 'General Hardware & Materials',
    aliases: ['general', 'materials', 'hardware', 'other', 'misc', 'miscellaneous'],
    keywords: []
  }
};

export const TRADE_CATEGORIES = TRADE_SECTION_MAP;
