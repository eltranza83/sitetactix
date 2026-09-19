export const TRADE_SECTIONS_CONFIG = {
  'Site_Prep_&_Structure': {
    label: 'Site Prep & Structure',
    phases: ['Foundation & Flatwork', 'Roofing', 'Windows & Exterior Doors']
  },
  'Framing_&_Lumber': {
    label: 'Framing & Lumber',
    phases: ['Framing Lumber & Truss']
  },
  'Mechanicals_&_Utilities': {
    label: 'Mechanicals & Utilities',
    phases: ['Plumbing Rough-In', 'Electrical & Lighting', 'HVAC / AC Systems', 'Insulation & Alarms']
  },
  'Interior_Finishes': {
    label: 'Interior Finishes',
    phases: ['Drywall & Sheetrock', 'Cabinets & Trim Carpentry', 'Quartz & Countertops', 'Glass Work']
  },
  'Paint_Tile': {
    label: 'Paint & Tile',
    phases: ['Tile & Flooring', 'Paint & Finishes']
  },
  'House_Exterior_&_Yard': {
    label: 'House Exterior & Yard',
    phases: ['Stucco & Masonry', 'Garage Doors', 'Driveway & Sidewalks', 'Cantera Stone Detail', 'Fencing & Gates', 'Landscaping & Irrigation']
  },
  'Project_Overhead_&_Bills': {
    label: 'Project Overhead & Bills',
    phases: ['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Extra Costs & Misc']
  },
  'Paperwork_&_Permits': {
    label: 'Paperwork & Permits',
    phases: ['Paperwork & Permits']
  },
  'Interior_Hardware': {
    label: 'Interior Hardware',
    phases: ['Plumbing Hardware Fixtures', 'Electrical Hardware Fixtures']
  }
};

export const ROUTING_TEST_SPLITS = Object.entries(TRADE_SECTIONS_CONFIG)
  .flatMap(([tradeCategory, config]) => (
    config.phases.map((tradePhase) => ({
      tradeCategory,
      tradePhase,
      costCategory: 'material',
      description: `Routing test - ${tradePhase}`
    }))
  ));

export const ALLOCATION_COLORS = [
  { text: '#F1D7A7', border: '#F1D7A7', bg: 'rgba(241, 215, 167, 0.12)', darkBg: 'rgba(241, 215, 167, 0.04)' },
  { text: '#38bdf8', border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', darkBg: 'rgba(56, 189, 248, 0.04)' },
  { text: '#34d399', border: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', darkBg: 'rgba(52, 211, 153, 0.04)' },
  { text: '#c084fc', border: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', darkBg: 'rgba(192, 132, 252, 0.04)' }
];

export function compressImage(file, maxWidth = 1200, maxHeight = 1200) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], `${file.name.replace(/\.[^/.]+$/, '')}_compressed.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

export function hasWholeWord(desc, keywords) {
  if (!desc) return false;
  const lowerDesc = desc.toLowerCase();
  return keywords.some(word => {
    const escaped = word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(lowerDesc);
  });
}

export function suggestSplitId(description, splits) {
  if (!description || !splits || splits.length === 0) return null;

  const keywords = {
    plumbing: ['pvc', 'elbow', 'valve', 'pipe', 'drain', 'shower', 'solder', 'copper', 'faucet', 'sink', 'toilet', 'brass', 'tee', 'flange', 'abs', 'cpvc', 'nipple', 'plumb', 'hose', 'washer', 'coupling', 'tub', 'cleanout'],
    electrical: ['wire', 'box', 'switch', 'outlet', 'breaker', 'conduit', 'gang', 'romex', 'cable', 'lamp', 'bulb', 'light', 'electric', 'receptacle', 'connector', 'dimmer', 'ground', 'fuse', 'tape', 'pigtail', 'fixture', 'junction'],
    hvac: ['duct', 'register', 'vent', 'grille', 'thermostat', 'ac', 'furnace', 'hvac', 'damper', 'flex', 'insulation', 'compressor', 'fan', 'filter', 'baffle'],
    framing: ['lumber', 'stud', 'plywood', 'nail', 'bolt', 'truss', 'header', 'joist', 'timber', 'post', 'screw', 'anchor', 'wood', 'hanger', 'plate', 'frame', 'sheathing', 'tie'],
    cabinets: ['cabinet', 'closet', 'rod', 'shelf', 'bracket', 'drawer', 'handle', 'hinge', 'trim', 'molding', 'door', 'pull', 'vanity'],
    drywall: ['drywall', 'sheetrock', 'mud', 'joint', 'compound', 'plaster', 'gypsum'],
    paint: ['paint', 'brush', 'roller', 'primer', 'caulk', 'sealer', 'varnish', 'stain', 'solvent']
  };

  const isPlumbingItem = hasWholeWord(description, keywords.plumbing);
  const isElectricalItem = hasWholeWord(description, keywords.electrical);
  const isHVACItem = hasWholeWord(description, keywords.hvac);
  const isFramingItem = hasWholeWord(description, keywords.framing);
  const isCabinetItem = hasWholeWord(description, keywords.cabinets);
  const isDrywallItem = hasWholeWord(description, keywords.drywall);
  const isPaintItem = hasWholeWord(description, keywords.paint);

  for (const s of splits) {
    const phaseLower = (s.tradePhase || '').toLowerCase();
    const catLower = (s.tradeCategory || '').toLowerCase();

    if (isPlumbingItem && (phaseLower.includes('plumb') || phaseLower.includes('sewer') || phaseLower.includes('water') || catLower.includes('plumb'))) return s.id;
    if (isElectricalItem && (phaseLower.includes('elect') || phaseLower.includes('light') || phaseLower.includes('power') || phaseLower.includes('wire') || catLower.includes('elect'))) return s.id;
    if (isHVACItem && (phaseLower.includes('hvac') || phaseLower.includes('duct') || phaseLower.includes('heat') || phaseLower.includes('vent') || phaseLower.includes('air') || phaseLower.includes('ac '))) return s.id;
    if (isFramingItem && (phaseLower.includes('frame') || phaseLower.includes('lumber') || phaseLower.includes('wood') || phaseLower.includes('truss') || catLower.includes('frame') || catLower.includes('lumb'))) return s.id;
    if (isCabinetItem && (phaseLower.includes('cabinet') || phaseLower.includes('trim') || phaseLower.includes('closet') || phaseLower.includes('rod') || phaseLower.includes('bracket') || phaseLower.includes('shelf') || phaseLower.includes('molding') || phaseLower.includes('door') || catLower.includes('finish'))) return s.id;
    if (isDrywallItem && (phaseLower.includes('drywall') || phaseLower.includes('sheetrock') || phaseLower.includes('mud') || phaseLower.includes('joint') || phaseLower.includes('compound') || catLower.includes('finish'))) return s.id;
    if (isPaintItem && (phaseLower.includes('paint') || phaseLower.includes('brush') || phaseLower.includes('roller') || phaseLower.includes('primer') || catLower.includes('paint') || catLower.includes('tile'))) return s.id;
  }

  return null;
}
