import React from 'react';
import { Edit2, CloudLightning, FileText, CheckCircle, Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { STATUS_MESSAGES } from '../services/appErrors';
import { isDraftPhaseValid, splitsMatchTotal, splitsTotals, TRADE_SECTIONS_CONFIG } from '../services/editFormHelpers';
import { formatMoney } from '../services/money';

export default function StagingCard({ 
  stagedItem, 
  onEditClick, 
  onUploadClick, 
  onDeleteClick, 
  onDescriptionChange,
  onCostCategoryChange,
  onLotNumberChange,
  uploading,
  uploadStatusText,
  googleToken,
  selectedFolder
}) {
  if (!stagedItem) return null;

  const { metadata, mainImageBase64, secondaryImageBase64 } = stagedItem;

  const isLabor = metadata.costCategory === 'labor';
  const isCheck = metadata.type === 'check';
  const isMockMode = !googleToken || !selectedFolder;
  const hasValidPhase = isDraftPhaseValid(metadata);
  // Splits must add up to the receipt total before the draft can sync
  const splitsAddUp = splitsMatchTotal(metadata);
  const canSync = hasValidPhase && splitsAddUp;
  const { splitsTotal, receiptTotal } = splitsTotals(metadata);
  // A photo this phone could not find any more (it is put back with Edit)
  const photoMissing = (stagedItem.missingPhotos || []).some(field => !stagedItem[field]);

  const scannedItems = Array.isArray(metadata.lineItems) ? metadata.lineItems : [];
  const itemCount = scannedItems.length;
  const skuCount = scannedItems.filter(item => item && item.sku).length;

  return (
    <div className="staging-box" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Row 0: Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-zinc-800)', paddingBottom: '8px', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
          <span className="staging-title-tag" style={{ margin: 0, padding: '3px 8px', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <FileText size={10} /> {metadata.type || 'Document'}{isCheck && metadata.checkNumber ? ` #${metadata.checkNumber}` : ''}
          </span>
          {metadata.splits && metadata.splits.length > 0 && (
            <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', backgroundColor: 'rgba(241, 215, 167, 0.15)', color: '#F1D7A7', border: '1px solid rgba(241, 215, 167, 0.3)', flexShrink: 0 }}>
              Split ({metadata.splits.length})
            </span>
          )}
          {itemCount > 0 && (
            <span
              style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', backgroundColor: 'rgba(161, 161, 170, 0.12)', color: 'var(--color-zinc-300)', border: '1px solid rgba(161, 161, 170, 0.3)', flexShrink: 0 }}
              title="Line items read from the receipt, and how many have a SKU"
            >
              {itemCount} {itemCount === 1 ? 'item' : 'items'} · {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button 
            type="button"
            onClick={onDeleteClick}
            style={{ background: 'none', border: 'none', color: 'var(--color-rose-500)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
            disabled={uploading}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Category & Phase Badges */}
      {(!metadata.splits || metadata.splits.length === 0) && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '-2px', marginBottom: '2px', alignItems: 'center' }}>
          <span style={{ 
            fontSize: '0.65rem', 
            padding: '3px 8px', 
            borderRadius: '4px', 
            fontWeight: 700, 
            backgroundColor: 'rgba(113, 113, 122, 0.15)', 
            color: 'var(--color-zinc-300)', 
            border: '1px solid var(--color-zinc-800)' 
          }}>
            Cat: {metadata.tradeCategory ? metadata.tradeCategory.replace(/_/g, ' ').replace(/&/g, '&') : 'None'}
          </span>
          <span style={{ 
            fontSize: '0.65rem', 
            padding: '3px 8px', 
            borderRadius: '4px', 
            fontWeight: 700, 
            backgroundColor: hasValidPhase ? 'rgba(241, 215, 167, 0.1)' : 'rgba(244, 63, 94, 0.15)',
            color: hasValidPhase ? '#F1D7A7' : '#fb7185',
            border: hasValidPhase ? '1px solid rgba(241, 215, 167, 0.25)' : '1px solid rgba(244, 63, 94, 0.35)'
          }}>
            Phase: {hasValidPhase ? (metadata.tradePhase || 'None') : 'Choose a phase'}
          </span>
        </div>
      )}

      {/* Row 1: Description & Lot / Address Inputs or Splits Table */}
      {metadata.splits && metadata.splits.length > 0 ? (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '4px', 
          backgroundColor: 'var(--color-zinc-950)', 
          border: '1px solid var(--color-zinc-800)', 
          borderRadius: '6px', 
          padding: '6px 8px',
          fontSize: '0.72rem'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 1.5fr 1fr', gap: '6px', fontWeight: 'bold', borderBottom: '1px solid var(--color-zinc-800)', paddingBottom: '3px', color: 'var(--color-zinc-400)' }}>
            <span>Lot/Addr</span>
            <span>Cat</span>
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
          </div>
          {metadata.splits.map((s, idx) => (
            <div key={s.id || idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 1.5fr 1fr', gap: '6px', color: 'var(--color-zinc-300)', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.lotNumber}</span>
              <span style={{ 
                fontSize: '0.65rem', 
                fontWeight: 700,
                color: s.costCategory === 'labor' ? 'var(--color-sky-400)' : 'var(--color-amber-400)' 
              }}>{s.costCategory === 'labor' ? 'LAB' : 'MAT'}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.description}>{s.description || metadata.description}</span>
                {s.tradePhase && (
                  <span
                    style={{ fontSize: '0.62rem', color: 'var(--color-zinc-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={`${TRADE_SECTIONS_CONFIG[s.tradeCategory]?.label || s.tradeCategory || ''} / ${s.tradePhase}`}
                  >
                    {s.tradePhase}
                  </span>
                )}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>${Number(s.amount || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <span className="staging-label" style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-zinc-500)' }}>Description</span>
            <input 
              type="text" 
              className="staging-inline-input"
              style={{ padding: '6px 10px', fontSize: '0.8rem', marginTop: 0 }}
              value={metadata.description || ''} 
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Describe the job or item..."
              disabled={uploading}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <span className="staging-label" style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-zinc-500)' }}>Lot / Address</span>
            <input 
              type="text" 
              className="staging-inline-input"
              style={{ padding: '6px 10px', fontSize: '0.8rem', marginTop: 0 }}
              value={metadata.lotNumber || ''} 
              onChange={(e) => onLotNumberChange(e.target.value)}
              placeholder="Lot Number or Address..."
              disabled={uploading}
            />
          </div>
        </div>
      )}

      {/* Row 2: Metadata row (Vendor & Date, Cost Category Toggle, Amount) */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        backgroundColor: 'var(--color-zinc-900)', 
        border: '1px solid var(--color-zinc-800)', 
        borderRadius: '8px', 
        padding: '6px 10px',
        gap: '8px'
      }}>
        {/* Vendor & Date */}
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-zinc-200)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {metadata.vendor || 'Unknown Vendor'}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-zinc-500)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '4px' }}>
            <span>{metadata.date || 'No Date'}</span>
            {stagedItem.readByBackupAi && (
              <span
                title="Google's main AI was busy, so a backup read this receipt. Check the amounts before syncing."
                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--color-sky-400)', whiteSpace: 'nowrap' }}
              >
                <RefreshCw size={11} aria-hidden="true" /> Backup AI
              </span>
            )}
          </span>
        </div>

        {/* Category Toggle */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          {metadata.splits && metadata.splits.length > 0 ? (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-amber-400)', fontWeight: 700, textTransform: 'uppercase', border: '1px dashed var(--color-zinc-700)', padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--color-zinc-950)' }}>
              Split Categories
            </div>
          ) : (
            <div className="staging-mini-toggle" style={{ margin: 0, padding: '2px', width: '100%', maxWidth: '110px' }}>
              <button 
                type="button" 
                className={`mini-toggle-btn material ${!isLabor ? 'active' : ''}`}
                style={{ padding: '2px 4px', fontSize: '0.68rem' }}
                onClick={() => onCostCategoryChange('material')}
                disabled={uploading}
              >
                Mat
              </button>
              <button 
                type="button" 
                className={`mini-toggle-btn labor ${isLabor ? 'active' : ''}`}
                style={{ padding: '2px 4px', fontSize: '0.68rem' }}
                onClick={() => onCostCategoryChange('labor')}
                disabled={uploading}
              >
                Lab
              </button>
            </div>
          )}
        </div>

        {/* Amount */}
        <div style={{ flex: 0.8, textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-zinc-500)', textTransform: 'uppercase' }}>Amount</span>
          <span className={`staging-val amount ${metadata.splits && metadata.splits.length > 0 ? 'material' : (isLabor ? 'labor' : 'material')}`} style={{ fontSize: '1rem', fontWeight: 800, padding: 0, lineHeight: 1.1 }}>
            ${Number(metadata.amount || 0).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Row 3: Attachments & Actions Merged Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        {/* Attachments (thumbnails side-by-side) */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {mainImageBase64 && (
            <div style={{ position: 'relative', width: '42px', height: '42px' }}>
              {mainImageBase64.startsWith('data:application/pdf') ? (
                <div 
                  style={{ 
                    width: '42px', 
                    height: '42px', 
                    borderRadius: '6px', 
                    border: '1px solid var(--color-zinc-800)', 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                    color: '#ef4444', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontSize: '0.62rem',
                    fontWeight: 'bold',
                    fontFamily: 'monospace'
                  }}
                >
                  PDF
                </div>
              ) : (
                <img src={mainImageBase64} alt="Primary" style={{ width: '42px', height: '42px', borderRadius: '6px', objectFit: 'cover', border: '1px solid var(--color-zinc-800)' }} />
              )}
              <span style={{ position: 'absolute', bottom: '1px', left: '1px', backgroundColor: 'rgba(0,0,0,0.75)', fontSize: '0.5rem', padding: '1px 3px', borderRadius: '3px', color: '#fff', scale: '0.85', transformOrigin: 'bottom left' }}>
                {mainImageBase64.startsWith('data:application/pdf') ? 'Doc' : 'Prim'}
              </span>
            </div>
          )}
          {secondaryImageBase64 ? (
            <div style={{ position: 'relative', width: '42px', height: '42px' }}>
              <img src={secondaryImageBase64} alt="Receipt" style={{ width: '42px', height: '42px', borderRadius: '6px', objectFit: 'cover', border: '1px solid var(--color-zinc-800)' }} />
              <span style={{ position: 'absolute', bottom: '1px', left: '1px', backgroundColor: 'rgba(0,0,0,0.75)', fontSize: '0.5rem', padding: '1px 3px', borderRadius: '3px', color: '#fff', scale: '0.85', transformOrigin: 'bottom left' }}>
                Rec
              </span>
            </div>
          ) : (
            <div 
              onClick={onEditClick}
              style={{ 
                width: '42px', 
                height: '42px', 
                borderRadius: '6px', 
                border: '1px dashed var(--color-zinc-700)', 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer',
                fontSize: '0.55rem',
                color: 'var(--color-zinc-500)',
                textAlign: 'center',
                fontWeight: 700,
                lineHeight: 1
              }}
            >
              <span>+ Add</span>
              <span style={{ fontSize: '0.5rem', opacity: 0.8 }}>Rec</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: 0 }}>
          <button 
            type="button"
            onClick={onEditClick}
            className="btn btn-secondary" 
            style={{ flex: 1, padding: '8px 10px', fontSize: '0.8rem', height: '36px', whiteSpace: 'nowrap' }}
            disabled={Boolean(uploading)}
          >
            <Edit2 size={12} /> Edit
          </button>
          <button 
            type="button"
            onClick={onUploadClick}
            className="btn btn-primary" 
            style={{ 
              flex: 1.3, 
              padding: '8px 10px', 
              fontSize: '0.8rem', 
              height: '36px', 
              whiteSpace: 'nowrap',
              backgroundColor: !canSync ? 'var(--color-zinc-800)' : (stagedItem.sheetSyncError ? '#f59e0b' : undefined),
              color: !canSync ? 'var(--color-zinc-500)' : (stagedItem.sheetSyncError ? '#000' : undefined),
              border: !canSync ? '1px solid var(--color-zinc-700)' : undefined,
              cursor: !canSync ? 'not-allowed' : undefined
            }}
            disabled={Boolean(uploading) || !canSync}
          >
            {uploading ? (
              <>
                <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '1.5px', borderColor: 'var(--color-zinc-950)', borderTopColor: 'transparent', margin: 0 }}></div>
                {uploadStatusText || STATUS_MESSAGES.syncingSpreadsheet}
              </>
            ) : !hasValidPhase ? (
              <>
                <AlertCircle size={12} /> Choose a phase
              </>
            ) : !splitsAddUp ? (
              <>
                <AlertCircle size={12} /> Fix split amounts
              </>
            ) : isMockMode ? (
              <>
                <CheckCircle size={12} /> Download
              </>
            ) : stagedItem.sheetSyncError ? (
              <>
                <CloudLightning size={12} /> Retry Sheet Sync
              </>
            ) : (
              <>
                <CloudLightning size={12} /> Sync
              </>
            )}
          </button>
        </div>
      </div>

      {!hasValidPhase && (
        <div style={{
          fontSize: '0.72rem',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '6px',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0, color: '#fbbf24' }} />
          <span>Needs a phase before it can sync. Tap Edit to choose one.</span>
        </div>
      )}

      {photoMissing && (
        <div style={{
          fontSize: '0.72rem',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '6px',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0, color: '#fbbf24' }} />
          <span>This draft's receipt photo is no longer on this phone. Tap Edit to add it again, or sync without it.</span>
        </div>
      )}

      {hasValidPhase && !splitsAddUp && (
        <div style={{
          fontSize: '0.72rem',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '6px',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0, color: '#fbbf24' }} />
          <span>Splits add up to {formatMoney(splitsTotal)}, the receipt is {formatMoney(receiptTotal)}. Tap Edit to fix the amounts.</span>
        </div>
      )}

      {hasValidPhase && stagedItem.sheetSyncError && (
        <div style={{
          fontSize: '0.72rem',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '6px',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0, color: '#fbbf24' }} />
          <span>PDF safely saved in Drive. Spreadsheet sync pending — tap Retry to finish logging.</span>
        </div>
      )}

      {isMockMode && (
        <div style={{ fontSize: '0.65rem', color: 'var(--color-amber-500)', textAlign: 'center', marginTop: '2px', opacity: 0.8 }}>
          * Offline Mode (Auto-Downloads PDF)
        </div>
      )}
    </div>
  );
}
