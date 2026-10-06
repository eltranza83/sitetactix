/**
 * Fixed declarations for the 13 Jarvis tools.
 * All 13 tools are ALWAYS offered on every turn. No keyword filtering.
 */
export const JARVIS_TOOL_DECLARATIONS = [
  {
    name: 'get_project_summary',
    description: 'Retrieve the overall financial summary for the active construction project including build budget, total spent to date, material vs labor breakdown, still owed on open quotes, projected total cost (spent + owed), and working capital balance (cash on hand).',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_contractor_balance',
    description: 'Retrieve contract quote, labor paid, and remaining balance owed for subcontractors. Can filter by contractor name or trade term (e.g., "electrician", "plumber", "framer"). If contractor parameter is omitted, returns all contractors with open balances.',
    parameters: {
      type: 'OBJECT',
      properties: {
        contractor: {
          type: 'STRING',
          description: 'Contractor name or trade term such as electrician, plumber, framer, tile contractor, painter'
        }
      }
    }
  },
  {
    name: 'get_spending',
    description: 'Retrieve detailed spending figures (material, labor, total spent, quotes, owed) broken down by construction phase or broad category.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phase: {
          type: 'STRING',
          description: 'Canonical phase name e.g. Framing Lumber & Truss, Drywall & Sheetrock, Tile & Flooring'
        },
        category: {
          type: 'STRING',
          description: 'Category sheet name e.g. Framing & Lumber, Paint & Tile, Mechanicals & Utilities'
        }
      }
    }
  },
  {
    name: 'search_payments',
    description: 'Search payment transactions and receipts by text, vendor/store, date range, or amount range. Returns payments with date, vendor, description, material/labor amount, check #, phase, and receipt drive file id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'Keyword to search transaction descriptions, line items, or materials (e.g., sheetrock, thinset, cement)'
        },
        vendor: {
          type: 'STRING',
          description: 'Vendor or store name (e.g., Home Depot, Floor & Decor, Vodilias Tile)'
        },
        from: {
          type: 'STRING',
          description: 'Start date in YYYY-MM-DD format'
        },
        to: {
          type: 'STRING',
          description: 'End date in YYYY-MM-DD format'
        },
        minAmount: {
          type: 'NUMBER',
          description: 'Minimum dollar amount'
        },
        maxAmount: {
          type: 'NUMBER',
          description: 'Maximum dollar amount'
        }
      }
    }
  },
  {
    name: 'open_receipt',
    description: 'Open a receipt PDF in the document viewer and retrieve its recorded line items, SKU, brand, and unit pricing details for reorders.',
    parameters: {
      type: 'OBJECT',
      properties: {
        driveFileId: {
          type: 'STRING',
          description: 'Google Drive file ID of the receipt PDF'
        },
        paymentId: {
          type: 'STRING',
          description: 'Payment or transaction identifier'
        },
        vendor: {
          type: 'STRING',
          description: 'Vendor name fallback if ID is not known'
        }
      }
    }
  },
  {
    name: 'list_folder_files',
    description: 'Lists the files in a project Drive folder: name, file ID, and for scanned receipts the purchaseDate, amount, vendor and item. savedToDrive is only the upload date — when talking about when something was bought, use purchaseDate; if it is null, say the purchase date is not recorded rather than giving the upload date. Matches folder against real project folder names (e.g. Home Depot, Lowe\'s, Floor & Decor).',
    parameters: {
      type: 'OBJECT',
      properties: {
        folder: {
          type: 'STRING',
          description: 'The name of the project folder to list files from (e.g., Home Depot, Lowe\'s, Floor & Decor).'
        }
      },
      required: ['folder']
    }
  },
  {
    name: 'open_file',
    description: 'Opens a document or receipt in the viewer. Only accepts a fileId that was returned by a previous tool in this session (such as list_folder_files or search_payments).',
    parameters: {
      type: 'OBJECT',
      properties: {
        fileId: {
          type: 'STRING',
          description: 'The file ID to open, selected from recent folder listings or search results.'
        }
      },
      required: ['fileId']
    }
  },
  {
    name: 'stage_expense',
    description: 'Draft a manual expense or receipt into the project Drafts queue. The code enforces a two-step confirmation before writing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vendor: {
          type: 'STRING',
          description: 'Store or payee vendor name'
        },
        amount: {
          type: 'NUMBER',
          description: 'Dollar amount'
        },
        description: {
          type: 'STRING',
          description: 'Description of items or service'
        },
        costType: {
          type: 'STRING',
          enum: ['material', 'labor'],
          description: 'Material or labor cost category'
        },
        phase: {
          type: 'STRING',
          description: 'Canonical trade phase (e.g. Extra Costs & Misc, Drywall & Sheetrock)'
        },
        date: {
          type: 'STRING',
          description: 'Transaction date YYYY-MM-DD (defaults to today)'
        },
        checkNumber: {
          type: 'STRING',
          description: 'Check number if paid by check'
        }
      },
      required: ['vendor', 'amount', 'description', 'costType']
    }
  }
];
