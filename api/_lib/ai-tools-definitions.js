/**
 * AI Tool Definitions & Function Declarations for Gemini Function Calling
 */

export const AI_TOOL_DECLARATIONS = [
  {
    name: 'get_vendor_history',
    description: 'Retrieve transaction history, invoices, and payments for a specific vendor, subcontractor, or contractor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vendorName: { type: 'STRING', description: 'Name of the vendor or contractor (e.g., Kike Vallejo, ABC Electric)' },
        projectId: { type: 'STRING', description: 'Optional project ID or lot identifier' }
      },
      required: ['vendorName']
    }
  },
  {
    name: 'get_subcontractor_balance',
    description: 'Retrieve the total quote, total amount paid, and remaining balance for a subcontractor or trade phase.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tradeOrContractor: { type: 'STRING', description: 'Trade category or contractor name (e.g. Electrician, Plumbing Rough-In, Concrete)' },
        projectId: { type: 'STRING', description: 'Optional project ID or lot identifier' }
      },
      required: ['tradeOrContractor']
    }
  },
  {
    name: 'search_receipts',
    description: 'Search recorded invoices, receipts, and payment transactions by keyword, date, or amount range.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Keyword search term (e.g., lumber, inspection, check #1042)' },
        minAmount: { type: 'NUMBER', description: 'Optional minimum total cost' },
        maxAmount: { type: 'NUMBER', description: 'Optional maximum total cost' },
        projectId: { type: 'STRING', description: 'Optional project ID' }
      }
    }
  },
  {
    name: 'stage_manual_transaction',
    description: 'Stage a user-reported business expense, contractor labor draw, or check payment with no receipt directly into the application Drafts queue (stagedItems) for human review, PDF voucher generation, and spreadsheet synchronization. ONLY call this tool after confirming the complete transaction details with the user or when explicitly commanded to stage it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transactionType: {
          type: 'STRING',
          enum: ['expense', 'contractor_payment', 'check'],
          description: 'Type of transaction: "expense" for vendor/store purchases, "contractor_payment" or "check" for subcontractor labor draws.'
        },
        vendorOrPayee: {
          type: 'STRING',
          description: 'Name of the merchant, vendor, contractor, or subcontractor (e.g. Stripes, Rios Plumbing, Home Depot, Kike Vallejo).'
        },
        amount: {
          type: 'NUMBER',
          description: 'Total dollar amount of the transaction.'
        },
        date: {
          type: 'STRING',
          description: 'Transaction date in YYYY-MM-DD format (defaults to current date if today).'
        },
        lotNumber: {
          type: 'STRING',
          description: 'Project or lot name (e.g. Lot 3).'
        },
        tradeCategory: {
          type: 'STRING',
          description: 'Spreadsheet category tab name (e.g. Mechanicals_&_Utilities, Project_Overhead_&_Bills, Site_Prep_&_Structure, Framing_&_Lumber).'
        },
        tradePhase: {
          type: 'STRING',
          description: 'Specific phase within the category sheet (e.g. Plumbing Rough-In, Extra Costs & Misc, Foundation Concrete, Trash & Dumpster).'
        },
        costCategory: {
          type: 'STRING',
          description: 'Optional cost classification: "material" or "labor". ONLY set if explicitly specified by the user (e.g. "for materials", "labor draw"). Do NOT guess or infer from the vendor or item description. Leave unset/empty string "" for general expenses.'
        },
        paymentMethod: {
          type: 'STRING',
          description: 'Required method of payment (e.g. "Debit Card", "Credit Card", "Cash", "Check #1045", "Zelle", "Transfer"). You MUST ask the user if this is not provided in the conversation.'
        },
        checkNumber: {
          type: 'STRING',
          description: 'Specific check number if paid by check (e.g. "1045").'
        },
        description: {
          type: 'STRING',
          description: 'Brief description of the work performed, purchase, or business purpose.'
        },
        receiptStatus: {
          type: 'STRING',
          enum: ['no_receipt', 'attached'],
          description: 'Receipt status ("no_receipt" for self-attested manual entries).'
        },
        notes: {
          type: 'STRING',
          description: 'Optional additional notes for the voucher record.'
        }
      },
      required: ['transactionType', 'vendorOrPayee', 'amount', 'paymentMethod']
    }
  },
  {
    name: 'get_project_schedule',
    description: 'Retrieve upcoming field reminders, trade calls, site watchouts, and in-app milestone tasks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Filter category: reminder, trade_call, watchout, or all' },
        projectId: { type: 'STRING', description: 'Optional project ID' }
      }
    }
  },
  {
    name: 'get_purchasing_list',
    description: 'Retrieve items and materials from the Firestore Purchasing Checklist for a project/lot. Optionally filtered by trade or specific item name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        trade: { type: 'STRING', description: 'Optional trade/category filter. Only pass recognized trade names: "electrical", "plumbing", "quartz", "hvac", "paint_drywall", "general". Do NOT pass item names (e.g. "pool", "pool heater", "lights") here.' },
        itemName: { type: 'STRING', description: 'Optional item name to check or look up on the purchasing checklist (e.g. "pool heater", "ceiling fans", "security lights").' },
        unpurchasedOnly: { type: 'BOOLEAN', description: 'Whether to return only unpurchased/needed items (default false)' },
        targetResource: { type: 'STRING', description: 'Target resource type: "project" (default, reads project checklist) or "master" (reads Master Template)' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g. Lot 3, Lot 55). Defaults to active project.' }
      }
    }
  },
  {
    name: 'add_purchasing_item',
    description: 'Add a brand new hardware fixture or material item to the Purchasing Checklist. Use ONLY when the user explicitly requests to create or add a new item (e.g. "add 6 GFCI outlets", "create item"). NEVER use this tool for "mark as purchased", "we bought X", or purchase status updates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item: { type: 'STRING', description: 'Name of the hardware, fixture, or material item to add (e.g. GFCI outlets, dimmer switches, shower pan liner)' },
        quantity: { type: 'NUMBER', description: 'Quantity needed (default 1)' },
        category: { type: 'STRING', description: 'Optional explicit trade/category override (e.g. electrical, plumbing, quartz)' },
        targetResource: { type: 'STRING', description: 'Target resource type: "project" (default, modifies working project doc) or "master" (modifies Company Master Template in parent folder)' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g. Lot 3, Lot 55) when targetResource is "project". Defaults to active project.' }
      },
      required: ['item']
    }
  },
  {
    name: 'update_purchasing_item_status',
    description: 'Update the purchased or needed status of an existing hardware fixture or material item on the Purchasing Checklist for a project/lot (e.g. "mark security lights as purchased", "mark faucets as needed", "we bought the ceiling fans", "set vanity lights to purchased"). If the item is ambiguous or not on the list, it safely returns zero changes and asks for clarification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemName: { type: 'STRING', description: 'Name of the item to mark/update (e.g. Security lights, soap dispenser, vanity lights)' },
        isPurchased: { type: 'BOOLEAN', description: 'Whether the item has been purchased (default true, false for needed)' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g. Lot 3, Lot 55). Defaults to active project.' }
      },
      required: ['itemName']
    }
  },
  {
    name: 'remove_purchasing_item',
    description: 'Remove, delete, or take off an item/material from the Google Docs Purchasing Checklist for a project or the Master Purchasing Template.',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemName: { type: 'STRING', description: 'Name of the item to delete/remove (e.g., "red light bulb", "shower pan liner")' },
        category: { type: 'STRING', description: 'Optional trade/category name (e.g., "Electrical Hardware Fixtures", "Plumbing")' },
        targetResource: { type: 'STRING', description: 'Target resource type: "project" (default) or "master"' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g., Lot 3, Lot 37). Defaults to active project.' }
      },
      required: ['itemName']
    }
  },
  {
    name: 'remove_purchasing_section',
    description: 'Remove or delete an entire section/category heading and its contents from the Google Docs Purchasing Checklist for a project or the Master Purchasing Template.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sectionName: { type: 'STRING', description: 'Name of the section/trade category to remove (e.g., "General Hardware & Materials")' },
        targetResource: { type: 'STRING', description: 'Target resource type: "project" (default) or "master"' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g., Lot 3, Lot 37). Defaults to active project.' }
      },
      required: ['sectionName']
    }
  },
  {
    name: 'sync_purchasing_master_to_projects',
    description: 'Non-destructively synchronize standard items from the Master Purchasing Template into active project purchasing lists, adding missing items without resetting checked items or custom quantities.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetProjectIds: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of project IDs to sync (e.g. ["lot_3", "lot_37"]). Defaults to all active projects if omitted.'
        },
        dryRun: {
          type: 'BOOLEAN',
          description: 'If true, simulates the sync and returns a preview summary of what would change without modifying project documents.'
        }
      }
    }
  },
  {
    name: 'get_purchasing_audit_log',
    description: 'Retrieve the historical audit log of purchasing operations and Master sync actions across projects.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'INTEGER', description: 'Maximum number of audit entries to return (default 20)' }
      }
    }
  },
  {
    name: 'deprecate_purchasing_master_item',
    description: 'Marks an item as deprecated in the Company Master Purchasing Template. Deprecated items are excluded from future project creations while remaining preserved on active projects.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item: { type: 'STRING', description: 'The name or item_id of the standard item to deprecate in the Master Purchasing Template.' }
      },
      required: ['item']
    }
  },
  {
    name: 'get_municipal_inspections',
    description: 'Retrieve the 6-stage city building inspection checklist, passed stages, and pending inspection items.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stageId: { type: 'STRING', description: 'Optional inspection stage filter (e.g., foundation, framing, rough_in, final)' },
        projectId: { type: 'STRING', description: 'Optional project ID or lot identifier' }
      }
    }
  },
  {
    name: 'get_weather_for_jobsite',
    description: 'Fetch current weather conditions and 7-day forecast for the jobsite using Open-Meteo API.',
    parameters: {
      type: 'OBJECT',
      properties: {
        latitude: { type: 'NUMBER', description: 'Jobsite latitude (defaults to project coordinates if omitted)' },
        longitude: { type: 'NUMBER', description: 'Jobsite longitude (defaults to project coordinates if omitted)' },
        locationName: { type: 'STRING', description: 'City/Address or Lot location name' }
      }
    }
  },
  {
    name: 'get_project_budget',
    description: 'Retrieve the high-level budget breakdown, total spent, and budget variance by phase.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Cost category: material, labor, or all' },
        projectId: { type: 'STRING', description: 'Optional project ID' }
      }
    }
  },
  {
    name: 'get_drive_files',
    description: 'Search Google Drive project folders and files by folder name, keyword, or document type. If querying what folders exist or broad project drive contents, call without arguments to retrieve the complete folder hierarchy and file manifest.',
    parameters: {
      type: 'OBJECT',
      properties: {
        folderName: { type: 'STRING', description: 'Target folder name or path (e.g. Planos, Invoices, Permits, Google Doc Purchasing List)' },
        keyword: { type: 'STRING', description: 'Search term for file title' }
      }
    }
  },
  {
    name: 'open_drive_document',
    description: 'Open a specific document, PDF, floor plan, or spreadsheet from Google Drive in a new viewer tab.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fileName: { type: 'STRING', description: 'The name or keyword of the file/PDF to open (e.g., "floor plan", "Lot 3 Floor Plan Review.pdf")' },
        folderName: { type: 'STRING', description: 'Optional subfolder name where the file resides (e.g., "Floor Plans", "Closing Settlement")' },
        documentId: { type: 'STRING', description: 'Optional Google Drive file ID if known' }
      },
      required: ['fileName']
    }
  },
  {
    name: 'open_drive_folder',
    description: 'Open or navigate to a specific Google Drive project subfolder (e.g. "Floor Plans", "Closing Settlement", "App Folders").',
    parameters: {
      type: 'OBJECT',
      properties: {
        folderName: { type: 'STRING', description: 'The folder name to open' },
        folderId: { type: 'STRING', description: 'Optional folder ID' }
      },
      required: ['folderName']
    }
  },
  {
    name: 'navigate_app_tab',
    description: 'Switch the active application tab to dashboard, brain, xray (X-Ray Floor Plan), or settings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tab: { type: 'STRING', description: 'Target tab name: "dashboard", "brain", "xray", or "settings"' }
      },
      required: ['tab']
    }
  },
  {
    name: 'get_project_finishes',
    description: 'Retrieve homeowner finish specifications, paint colors, paint schedules, roofing materials, stucco textures, stone finishes, and fixtures from Firestore. Call this tool whenever the user asks about paint colors, finishes, materials, or sheens for any lot or room. Returns explicit whole-house defaults and location-specific overrides.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Category filter (e.g., Paint, Stucco, Stone, Roofing, Tile, Flooring, Plumbing Fixtures, Countertops)' },
        room: { type: 'STRING', description: 'Room or location filter (e.g., Master Bath, Kitchen, Study, Exterior, Whole House)' },
        surface: { type: 'STRING', description: 'Surface filter (e.g., Interior Walls, Ceilings, Trim & Doors, Cabinets, Exterior Body / Walls, Accent Wall / Feature)' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g. Lot 3, Lot 55)' }
      }
    }
  },
  {
    name: 'get_homeowner_specs',
    description: 'Retrieve finish specifications, selections, paint schedules, roofing materials, stucco textures, stone finishes, and fixtures from Firestore. Returns explicit whole-house defaults and location-specific overrides.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Category filter (e.g., Paint, Stucco, Stone, Roofing, Tile, Flooring, Plumbing Fixtures, Countertops)' },
        room: { type: 'STRING', description: 'Room or location filter (e.g., Master Bath, Kitchen, Study, Exterior, Whole House)' },
        surface: { type: 'STRING', description: 'Surface filter (e.g., Interior Walls, Ceilings, Trim & Doors, Cabinets, Exterior Body / Walls, Accent Wall / Feature)' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID (e.g. Lot 3, Lot 55)' }
      }
    }
  },
  {
    name: 'save_finish_spec',
    description: 'Create or update a finish/material specification in the Firestore database (e.g. "add roofing material Owens Corning Estate Gray", "change Lot 3 roofing color to Onyx Black", "set stucco texture to Medium Dash"). If multiple records exist for that category and location is ambiguous, safely asks for clarification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Category name (e.g. Paint, Stucco, Stone, Roofing, Tile & Grout, Countertops & Flooring, Fixtures & Hardware)' },
        codeOrProduct: { type: 'STRING', description: 'Color name, code #, or product model (e.g. SW 7005 Pure White, Dover White #104, Duration Architectural Shingle)' },
        location: { type: 'STRING', description: 'Location or area (e.g. Whole House, Study Accent Wall, Exterior Body, Front Entry Columns)' },
        scope: { type: 'STRING', description: 'Scope: whole_house, room_override, exterior_general, or area_specific' },
        brand: { type: 'STRING', description: 'Brand or supplier (e.g. Sherwin-Williams, Owens Corning, Master Wall, Daltile)' },
        sheen: { type: 'STRING', description: 'Sheen, finish, or specs (e.g. Flat, Satin, Medium Dash, Honed Smooth)' },
        attributes: { type: 'OBJECT', description: 'Optional key-value attributes (e.g. {"texture": "Medium Dash", "sealant": "Dry-Treat", "warranty": "30-Year", "thickness": "2-inch"})' },
        notes: { type: 'STRING', description: 'Optional notes' },
        specId: { type: 'STRING', description: 'Optional specific finish ID if modifying a known document' },
        projectId: { type: 'STRING', description: 'Optional project or lot ID' }
      },
      required: ['category', 'codeOrProduct']
    }
  },
  {
    name: 'get_site_setup',
    description: 'Retrieve mobilization checklist status and site setup protocol requirements.',
    parameters: {
      type: 'OBJECT',
      properties: {
        projectId: { type: 'STRING', description: 'Optional project ID' }
      }
    }
  },
  {
    name: 'save_memory',
    description: 'Save a permanent contextual fact, verbal agreement, subcontractor preference, quote, site decision, or lesson learned to persistent memory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The exact fact, decision, or preference to remember.' },
        projectId: { type: 'STRING', description: 'The project/lot identifier (e.g. Lot 12) or null if global.' },
        category: {
          type: 'STRING',
          description: 'Category: subcontractor, vendor, decision, preference, quote, procedure, rule, lesson_learned, or general.'
        },
        memoryType: {
          type: 'STRING',
          description: 'Type: project_fact, subcontractor, vendor, preference, decision, agreement, instruction, lesson_learned, business_rule, or general.'
        },
        importance: {
          type: 'STRING',
          description: 'Importance level: critical, important, or informational.'
        },
        isGlobal: {
          type: 'BOOLEAN',
          description: 'True if this is a company-wide or multi-project rule/preference.'
        },
        effectiveDate: {
          type: 'STRING',
          description: 'Optional date (YYYY-MM-DD) when this fact or agreement became effective.'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'search_memories',
    description: 'Search persistent business memory for verbal agreements, subcontractor preferences, site decisions, quotes, and lessons learned.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search term or question regarding saved memories.' },
        projectId: { type: 'STRING', description: 'Optional project ID / lot identifier to scope the search.' },
        category: { type: 'STRING', description: 'Optional category filter.' },
        memoryType: { type: 'STRING', description: 'Optional memory type filter.' }
      }
    }
  },
  {
    name: 'list_memories',
    description: 'List all active saved memories, site decisions, or subcontractor preferences for a specific project/lot or globally.',
    parameters: {
      type: 'OBJECT',
      properties: {
        projectId: { type: 'STRING', description: 'Optional project ID / lot identifier.' },
        category: { type: 'STRING', description: 'Optional category filter.' },
        includeGlobal: { type: 'BOOLEAN', description: 'Whether to include company-wide global memories.' }
      }
    }
  },
  {
    name: 'update_memory',
    description: 'Update an existing saved memory when details change (e.g., subcontractor changes payment method from check to ACH).',
    parameters: {
      type: 'OBJECT',
      properties: {
        memoryId: { type: 'STRING', description: 'ID of the existing memory to update (if known).' },
        searchQuery: { type: 'STRING', description: 'Query to locate the existing memory if ID is not known.' },
        updatedText: { type: 'STRING', description: 'The new updated memory text.' },
        projectId: { type: 'STRING', description: 'Optional project ID.' },
        reason: { type: 'STRING', description: 'Reason for the change.' }
      },
      required: ['updatedText']
    }
  },
  {
    name: 'delete_memory',
    description: 'Deactivate or forget a previously saved memory (e.g. when user says "Forget what I told you about...").',
    parameters: {
      type: 'OBJECT',
      properties: {
        memoryId: { type: 'STRING', description: 'ID of the memory to forget (if known).' },
        searchQuery: { type: 'STRING', description: 'Query or description of what memory to forget.' },
        projectId: { type: 'STRING', description: 'Optional project ID.' },
        reason: { type: 'STRING', description: 'Reason for deactivation.' }
      },
      required: ['searchQuery']
    }
  },
  {
    name: 'list_user_preferences',
    description: 'Retrieve all learned and configured user preferences, communication styles, and interaction rules for the current user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Optional category filter (e.g. response_style, information_depth, terminology)' },
        scope: { type: 'STRING', description: 'Optional scope filter (global or project)' }
      }
    }
  },
  {
    name: 'confirm_user_preference',
    description: 'Promote an observed preference candidate to an active persistent user preference after user confirmation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        candidateId: { type: 'STRING', description: 'ID of the candidate preference' },
        statement: { type: 'STRING', description: 'The preference rule statement' },
        scope: { type: 'STRING', description: 'global or project' }
      }
    }
  },
  {
    name: 'deactivate_user_preference',
    description: 'Deactivate or delete a specific learned user preference.',
    parameters: {
      type: 'OBJECT',
      properties: {
        searchQuery: { type: 'STRING', description: 'Keyword or topic of the preference to delete (e.g. concise answers, bottom line)' }
      },
      required: ['searchQuery']
    }
  },
  {
    name: 'reset_user_preferences',
    description: 'Forget and purge all learned communication preferences and behavioral habits for the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN', description: 'Confirmation flag' }
      }
    }
  }
];

/**
 * Execute weather tool lookup via Open-Meteo free API (no key needed).
 */
export async function executeWeatherTool({ latitude = 32.7767, longitude = -96.7970, locationName = 'Jobsite' }) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      location: locationName,
      current: {
        temperatureF: Math.round((data.current.temperature_2m * 9/5) + 32),
        temperatureC: data.current.temperature_2m,
        humidity: data.current.relative_humidity_2m,
        precipitationMm: data.current.precipitation,
        windSpeedMph: Math.round(data.current.wind_speed_10m * 0.621371)
      },
      dailyForecast: (data.daily?.time || []).slice(0, 5).map((date, idx) => ({
        date,
        maxTempF: Math.round((data.daily.temperature_2m_max[idx] * 9/5) + 32),
        minTempF: Math.round((data.daily.temperature_2m_min[idx] * 9/5) + 32),
        precipitationMm: data.daily.precipitation_sum[idx]
      }))
    };
  } catch (err) {
    return {
      location: locationName,
      error: `Could not retrieve live weather from Open-Meteo: ${err.message}`
    };
  }
}

/**
 * Functional clusters of AI tools for dynamic, quota-aware subsetting.
 */
export const AI_TOOL_CLUSTERS = {
  FINANCIALS: [
    'get_vendor_history',
    'get_subcontractor_balance',
    'search_receipts',
    'stage_manual_transaction',
    'get_project_budget'
  ],
  INSPECTIONS_SCHEDULE: [
    'get_municipal_inspections',
    'get_project_schedule',
    'get_weather_for_jobsite',
    'get_site_setup'
  ],
  PURCHASING_FINISHES: [
    'get_purchasing_list',
    'add_purchasing_item',
    'update_purchasing_item_status',
    'remove_purchasing_item',
    'remove_purchasing_section',
    'sync_purchasing_master_to_projects',
    'get_purchasing_audit_log',
    'deprecate_purchasing_master_item',
    'get_project_finishes',
    'get_homeowner_specs',
    'save_finish_spec'
  ],
  DRIVE_DOCUMENTS: [
    'get_drive_files',
    'open_drive_document',
    'open_drive_folder',
    'navigate_app_tab'
  ],
  MEMORY_PREFERENCES: [
    'save_memory',
    'search_memories',
    'list_memories',
    'update_memory',
    'delete_memory',
    'list_user_preferences',
    'confirm_user_preference',
    'deactivate_user_preference',
    'reset_user_preferences'
  ]
};

/**
 * Select a targeted subset of AI tool declarations based on user query and recent history.
 * Employs a fail-open design: defaults to all tools if query is broad, ambiguous, or multi-domain.
 */
export function selectRelevantToolDeclarations(query = '', conversationHistory = []) {
  const q = String(query || '').trim().toLowerCase();

  let historyText = '';
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    historyText = conversationHistory
      .slice(-3)
      .map(c => Array.isArray(c.parts) ? c.parts.map(p => p.text || '').join(' ') : (c.text || c.content || ''))
      .join(' ')
      .toLowerCase();
  }
  const combined = `${historyText} ${q}`.trim();

  // Fail-open: Broad, audit, or empty queries receive all 33 tools
  const broadPatterns = [
    /\b(audit|status|overview|summary|briefing|how are we doing|full report|everything|all phases|entire project)\b/i,
    /\b(check everything|full project|project update)\b/i
  ];
  if (!q || broadPatterns.some(p => p.test(q))) {
    return AI_TOOL_DECLARATIONS;
  }

  const selectedNames = new Set(AI_TOOL_CLUSTERS.MEMORY_PREFERENCES);

  const hasTrade = /\b(subcontractor\w*|contractor\w*|vendor\w*|plumber\w*|electrician\w*|framer\w*|framing|concrete|painter\w*|painting|hvac|roofer\w*|roofing|drywall\w*|mason\w*|trim\w*|cabinet\w*)\b/i.test(combined);
  const hasExplicitMoney = /\b(owe\w*|pay\w*|paid|payment\w*|balance\w*|quote\w*|cost\w*|spent|spend\w*|expense\w*|invoice\w*|receipt\w*|check\w*|labor\w*|material cost|budget\w*|draw\w*|financial\w*|money|dollar\w*|price\w*|charge\w*)\b/i.test(combined);
  const hasPurchasing = /\b(purchas\w*|buy\w*|bought|fixture\w*|appliance\w*|hardware|material\w*|suppl\w*|need\w*|shopping|order\w*|item\w*|list\w*|install\w*|deliver\w*|paint\w*|color\w*|sheen\w*|stucco|tile\w*|finish\w*|spec\w*|selection\w*|roofing shingle|sherwin|cantera)\b/i.test(combined);

  const hasInspections = /\b(inspect\w*|city|permit\w*|passed|failed|rough-in|slab|framing inspection|plumbing inspection|electrical inspection|foundation inspection|site setup|mobilization|silt|meter|water meter|weather|rain|forecast|schedule\w*|reminder\w*|call\w*)\b/i.test(combined);

  // If query is specifically about purchasing/materials or inspections for a trade and doesn't ask about money, omit financial accounting tools
  const hasFinancials = hasExplicitMoney || (hasTrade && !hasPurchasing && !hasInspections);
  const hasDrive = /\b(drive|folder\w*|file\w*|pdf\w*|plan\w*|blueprint\w*|document\w*|sheet\w*|directory|open|navigate|tab\w*)\b/i.test(combined);

  // If no specific domain pattern matched, fail-open to full tool declarations
  if (!hasFinancials && !hasInspections && !hasPurchasing && !hasDrive) {
    return AI_TOOL_DECLARATIONS;
  }

  if (hasFinancials) AI_TOOL_CLUSTERS.FINANCIALS.forEach(n => selectedNames.add(n));
  if (hasInspections) AI_TOOL_CLUSTERS.INSPECTIONS_SCHEDULE.forEach(n => selectedNames.add(n));
  if (hasPurchasing) AI_TOOL_CLUSTERS.PURCHASING_FINISHES.forEach(n => selectedNames.add(n));
  if (hasDrive) AI_TOOL_CLUSTERS.DRIVE_DOCUMENTS.forEach(n => selectedNames.add(n));

  const toolMap = new Map(AI_TOOL_DECLARATIONS.map(t => [t.name, t]));
  return Array.from(selectedNames).map(name => toolMap.get(name)).filter(Boolean);
}

