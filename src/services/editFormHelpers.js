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

export function isValidPhase(category, phase) {
  if (!category || !phase) return false;
  const config = TRADE_SECTIONS_CONFIG[category];
  if (!config || !Array.isArray(config.phases)) return false;
  return config.phases.includes(phase);
}

export function isDraftPhaseValid(metadata) {
  if (!metadata) return false;
  if (Array.isArray(metadata.splits) && metadata.splits.length > 0) {
    return metadata.splits.every(split => isValidPhase(split.tradeCategory || metadata.tradeCategory, split.tradePhase));
  }
  return isValidPhase(metadata.tradeCategory, metadata.tradePhase);
}

export function distributeReceiptTotalToSplits(splitBaseAmounts, receiptTotal) {
  if (!Array.isArray(splitBaseAmounts) || splitBaseAmounts.length === 0) {
    return [];
  }

  const receiptCents = Math.round((parseFloat(receiptTotal) || 0) * 100);
  const baseCents = splitBaseAmounts.map(amt => Math.max(0, Math.round((parseFloat(amt) || 0) * 100)));
  const totalBaseCents = baseCents.reduce((sum, c) => sum + c, 0);

  if (totalBaseCents === 0) {
    if (receiptCents === 0) {
      return baseCents.map(() => '0.00');
    }
    const equalShare = Math.floor(receiptCents / baseCents.length);
    let remainder = receiptCents % baseCents.length;
    return baseCents.map(() => {
      const share = equalShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      return (share / 100).toFixed(2);
    });
  }

  const diffCents = receiptCents - totalBaseCents;

  const resultCents = baseCents.map(base => {
    const proportionalDiff = Math.round(diffCents * (base / totalBaseCents));
    return base + proportionalDiff;
  });

  const allocatedTotal = resultCents.reduce((sum, c) => sum + c, 0);
  const leftoverCents = receiptCents - allocatedTotal;

  if (leftoverCents !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < baseCents.length; i++) {
      if (baseCents[i] > baseCents[largestIdx]) {
        largestIdx = i;
      }
    }
    resultCents[largestIdx] += leftoverCents;
  }

  return resultCents.map(cents => (cents / 100).toFixed(2));
}

export function checkLineItemsDiscrepancy(lineItemsTotal, receiptTotal, thresholdRatio = 0.15) {
  const lineTotalNum = parseFloat(lineItemsTotal) || 0;
  const receiptTotalNum = parseFloat(receiptTotal) || 0;
  if (receiptTotalNum <= 0 || lineTotalNum <= 0) {
    return { isDiscrepant: false, lineItemsTotal: lineTotalNum, receiptTotal: receiptTotalNum, diff: 0 };
  }
  const diff = Math.abs(receiptTotalNum - lineTotalNum);
  const threshold = receiptTotalNum * thresholdRatio;
  return {
    isDiscrepant: diff > threshold,
    lineItemsTotal: lineTotalNum,
    receiptTotal: receiptTotalNum,
    diff
  };
}

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

/**
 * The scanned line items (with SKUs) assigned to one split,
 * so each split's PDF lists only its own items.
 */
export function getItemsForSplit(lineItems, itemAllocations, splitId) {
  if (!Array.isArray(lineItems) || !itemAllocations) return [];
  return lineItems.filter((_, idx) => itemAllocations[idx] === splitId);
}

/**
 * Turns a scanned date into YYYY-MM-DD, which is what the date box needs.
 * Accepts 2026-02-01, 02/01/2026, 2/1/26 and 02-01-2026 (month first, as on US receipts;
 * a first number above 12 is read as the day). Returns '' when the text is not a real date.
 */
export function normalizeScanDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  let year;
  let month;
  let day;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const us = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (us) {
    let first = Number(us[1]);
    let second = Number(us[2]);
    year = Number(us[3]);
    if (us[3].length === 2) year += 2000;
    if (first > 12 && second <= 12) [first, second] = [second, first];
    month = first;
    day = second;
  } else {
    return '';
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
