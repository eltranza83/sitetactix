import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Plus, Sparkles, Trash2, UploadCloud, X, AlertTriangle } from 'lucide-react';
import { TRADE_CATEGORIES } from '../config/tradeCategories';
import { extractQuoteData } from '../services/gemini';
import {
  findDuplicateContractMatches,
  readExistingContracts,
  saveQuoteContractsToSheet,
  updateContractRowInSheet,
  uploadQuoteFileToDrive
} from '../services/contractsService';
import { formatMoney, parseMoney } from '../services/money';
import { getDriveErrorMessage, isAuthError } from '../services/appErrors';

function resolveCategoryKey(catNameOrKey, phaseName) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetCat = norm(catNameOrKey);
  const byCat = TRADE_CATEGORIES.find(c => norm(c.key) === targetCat || norm(c.name) === targetCat);
  if (byCat) return byCat.key;
  const targetPhase = norm(phaseName);
  const byPhase = TRADE_CATEGORIES.find(c => c.phases.some(p => norm(p) === targetPhase));
  return byPhase?.key || TRADE_CATEGORIES[0].key;
}

function makeBlankLine(idSuffix = 1) {
  const firstCat = TRADE_CATEGORIES[0];
  return {
    id: `qline_${Date.now()}_${idSuffix}`,
    tradeCategory: firstCat.key,
    tradePhase: firstCat.phases[0],
    quoteAmount: '',
    scopeSummary: ''
  };
}

export default function DashboardQuoteModal({
  isOpen,
  mode = 'new', // 'new' | 'edit' | 'change_order'
  initialContract = null,
  onClose,
  googleToken,
  activeProject,
  selectedFolder,
  spreadsheetId,
  existingContracts = [],
  onSaved,
  onSessionExpired,
  onShowToast
}) {
  const isEditMode = mode === 'edit' && Boolean(initialContract?.rowNumber);
  const isChangeOrderMode = mode === 'change_order' && Boolean(initialContract);

  const [sub, setSub] = useState('');
  const [company, setCompany] = useState('');
  const [quoteDate, setQuoteDate] = useState('');
  const [items, setItems] = useState(() => [makeBlankLine(1)]);
  const [attachedFile, setAttachedFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [aiNotice, setAiNotice] = useState(null);
  const [conflictMatches, setConflictMatches] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setAttachedFile(null);
    setModalError(null);
    setAiNotice(null);
    setConflictMatches(null);
    setQuoteDate('');

    if ((mode === 'edit' || mode === 'change_order') && initialContract) {
      const catKey = resolveCategoryKey(initialContract.category, initialContract.phase);
      const catObj = TRADE_CATEGORIES.find(c => c.key === catKey) || TRADE_CATEGORIES[0];
      const matchedPhase = catObj.phases.find(
        p => p.toLowerCase() === String(initialContract.phase || '').trim().toLowerCase()
      ) || catObj.phases[0];

      setSub(initialContract.sub || '');
      setCompany(initialContract.company || '');
      setItems([{
        id: `qline_init_${Date.now()}`,
        tradeCategory: catKey,
        tradePhase: matchedPhase,
        quoteAmount: mode === 'edit' ? String(parseMoney(initialContract.quote) || '') : '',
        scopeSummary: ''
      }]);
    } else {
      setSub('');
      setCompany('');
      setItems([makeBlankLine(1)]);
    }
  }, [isOpen, mode, initialContract]);

  const knownSubSuggestions = useMemo(() => {
    const subs = new Set();
    const companies = new Set();
    (Array.isArray(existingContracts) ? existingContracts : []).forEach(c => {
      if (c?.sub) subs.add(String(c.sub).trim());
      if (c?.company) companies.add(String(c.company).trim());
    });
    return { subs: [...subs], companies: [...companies] };
  }, [existingContracts]);

  if (!isOpen) return null;

  const resetAndClose = () => {
    if (saving || extracting) return;
    setSub('');
    setCompany('');
    setQuoteDate('');
    setItems([makeBlankLine(1)]);
    setAttachedFile(null);
    setModalError(null);
    setAiNotice(null);
    setConflictMatches(null);
    onClose();
  };

  const handleFileSelected = async (file) => {
    if (!file) return;
    setAttachedFile(file);
    setModalError(null);
    setAiNotice(null);
    setConflictMatches(null);

    setExtracting(true);
    try {
      const { data, readByBackupAi } = await extractQuoteData(file);
      if (data.date) setQuoteDate(data.date);
      if (isChangeOrderMode || isEditMode) {
        const extractedSum = (Array.isArray(data.items) ? data.items : []).reduce(
          (acc, item) => acc + parseMoney(item?.quoteAmount),
          0
        );
        if (extractedSum > 0) {
          setItems(prev => prev.map((line, idx) => (idx === 0 ? { ...line, quoteAmount: String(extractedSum) } : line)));
        }
        if (!sub && data.sub) setSub(data.sub);
        if (!company && data.company) setCompany(data.company);
      } else {
        if (data.sub) setSub(data.sub);
        if (data.company) setCompany(data.company);
        if (Array.isArray(data.items) && data.items.length > 0) {
          setItems(
            data.items.map((item, idx) => {
              const matchedCat = TRADE_CATEGORIES.find(c => c.key === item.tradeCategory) || TRADE_CATEGORIES[0];
              const validPhase = matchedCat.phases.includes(item.tradePhase)
                ? item.tradePhase
                : matchedCat.phases[0];
              return {
                id: `qline_ai_${Date.now()}_${idx}`,
                tradeCategory: matchedCat.key,
                tradePhase: validPhase,
                quoteAmount: item.quoteAmount ? String(item.quoteAmount) : '',
                scopeSummary: item.scopeSummary || ''
              };
            })
          );
        }
      }
      setAiNotice(
        readByBackupAi
          ? 'Quote read with backup AI — double-check the fields below before saving.'
          : 'AI pre-filled the quote details below. Review or tweak anything before saving.'
      );
    } catch (err) {
      console.error('Quote AI extraction failed:', err);
      setModalError(`${err.message || 'Could not auto-read this file.'} Your file is still attached — fill in the fields below to save.`);
    } finally {
      setExtracting(false);
    }
  };

  const handleCategoryChange = (lineId, newCatKey) => {
    const cat = TRADE_CATEGORIES.find(c => c.key === newCatKey);
    const defaultPhase = cat?.phases?.[0] || '';
    setConflictMatches(null);
    setItems(prev =>
      prev.map(line => (line.id === lineId ? { ...line, tradeCategory: newCatKey, tradePhase: defaultPhase } : line))
    );
  };

  const handleLineChange = (lineId, field, value) => {
    setConflictMatches(null);
    setItems(prev => prev.map(line => (line.id === lineId ? { ...line, [field]: value } : line)));
  };

  const handleAddLine = () => {
    setConflictMatches(null);
    setItems(prev => [...prev, makeBlankLine(prev.length + 1)]);
  };

  const handleRemoveLine = (lineId) => {
    setConflictMatches(null);
    setItems(prev => (prev.length > 1 ? prev.filter(line => line.id !== lineId) : prev));
  };

  const executeSave = async (resolutionMode = null) => {
    const cleanSub = sub.trim();
    const cleanCompany = company.trim();
    if (!cleanSub && !cleanCompany) {
      setModalError('Enter at least a Subcontractor person name or Company name.');
      return;
    }

    const validItems = items.filter(line => line.tradePhase && parseMoney(line.quoteAmount) > 0);
    if (validItems.length === 0) {
      setModalError('Enter a quote amount greater than $0 for at least one phase.');
      return;
    }

    if (!googleToken) {
      setModalError('Connect Google Drive first so the quote can be saved to your Sheet.');
      return;
    }
    if (!spreadsheetId) {
      setModalError('Could not find the Google Sheet for this project.');
      return;
    }

    setSaving(true);
    setModalError(null);

    try {
      const projectFolderId = selectedFolder?.id || activeProject?.folderId;
      const partyLabel = cleanCompany && cleanSub && cleanCompany.toLowerCase() !== cleanSub.toLowerCase()
        ? `${cleanSub} (${cleanCompany})`
        : (cleanCompany || cleanSub);
      const fileNote = attachedFile ? ' + saved file in Drive' : '';

      if (isEditMode) {
        if (attachedFile && projectFolderId) {
          await uploadQuoteFileToDrive({
            accessToken: googleToken,
            projectFolderId,
            file: attachedFile,
            sub: cleanSub,
            company: cleanCompany,
            date: quoteDate,
            prefix: 'Quote'
          });
        }
        const [firstLine] = validItems;
        await updateContractRowInSheet({
          accessToken: googleToken,
          spreadsheetId,
          rowNumber: initialContract.rowNumber,
          sub: cleanSub,
          company: cleanCompany,
          tradeCategory: firstLine.tradeCategory,
          tradePhase: firstLine.tradePhase,
          quoteAmount: firstLine.quoteAmount
        });
        onShowToast?.(`Updated contract quote for ${partyLabel} to ${formatMoney(firstLine.quoteAmount)}${fileNote}!`, 'success');
        setSaving(false);
        resetAndClose();
        onSaved?.();
        return;
      }

      if (isChangeOrderMode) {
        if (attachedFile && projectFolderId) {
          await uploadQuoteFileToDrive({
            accessToken: googleToken,
            projectFolderId,
            file: attachedFile,
            sub: cleanSub,
            company: cleanCompany,
            date: quoteDate,
            prefix: 'Change Order'
          });
        }
        const [changeLine] = validItems;
        const addedAmt = parseMoney(changeLine.quoteAmount);
        const newTotal = parseMoney(initialContract.quote) + addedAmt;
        if (initialContract.rowNumber) {
          await updateContractRowInSheet({
            accessToken: googleToken,
            spreadsheetId,
            rowNumber: initialContract.rowNumber,
            sub: cleanSub,
            company: cleanCompany,
            tradeCategory: changeLine.tradeCategory,
            tradePhase: changeLine.tradePhase,
            quoteAmount: newTotal
          });
        } else {
          await saveQuoteContractsToSheet({
            accessToken: googleToken,
            spreadsheetId,
            sub: cleanSub,
            company: cleanCompany,
            items: [changeLine],
            conflictResolution: 'add_to_quote'
          });
        }
        onShowToast?.(
          `Added ${formatMoney(addedAmt)} change order for ${partyLabel} (new quote: ${formatMoney(newTotal)})${fileNote}!`,
          'success'
        );
        setSaving(false);
        resetAndClose();
        onSaved?.();
        return;
      }

      // If user hasn't picked a duplicate resolution yet, inspect live Contracts!A1:E first
      if (!resolutionMode) {
        const live = await readExistingContracts(googleToken, spreadsheetId);
        const matches = findDuplicateContractMatches(live.contracts, validItems, {
          sub: cleanSub,
          company: cleanCompany
        });
        if (matches.length > 0) {
          setConflictMatches(matches);
          setSaving(false);
          return;
        }
      }

      if (attachedFile && projectFolderId) {
        await uploadQuoteFileToDrive({
          accessToken: googleToken,
          projectFolderId,
          file: attachedFile,
          sub: cleanSub,
          company: cleanCompany,
          date: quoteDate
        });
      }

      const result = await saveQuoteContractsToSheet({
        accessToken: googleToken,
        spreadsheetId,
        sub: cleanSub,
        company: cleanCompany,
        items: validItems,
        conflictResolution: resolutionMode || 'append_row'
      });

      onShowToast?.(
        `Saved ${result.updatedCount === 1 ? 'quote' : `${result.updatedCount} phase quotes`} for ${partyLabel} to Contracts${fileNote}!`,
        'success'
      );

      setSaving(false);
      resetAndClose();
      onSaved?.();
    } catch (err) {
      console.error('Failed to save quote to Contracts:', err);
      setSaving(false);
      if (isAuthError(err)) {
        onSessionExpired?.({ interactive: true });
        setModalError('Your Google session expired. Please reconnect and click Save again.');
        return;
      }
      setModalError(getDriveErrorMessage(err, 'save quote to Contracts'));
    }
  };

  return (
    <div
      onClick={resetAndClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(6px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--st-panel)',
          border: '1px solid var(--st-line)',
          borderTop: '3px solid var(--st-gold)',
          borderRadius: '14px',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.7)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--st-text)', fontFamily: 'var(--font-display)' }}>
              {isEditMode
                ? 'Edit Subcontractor Quote'
                : isChangeOrderMode
                  ? 'Add Change Order to Quote'
                  : 'Add / Upload Subcontractor Quote'}
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--st-muted)', lineHeight: 1.35 }}>
              {isEditMode
                ? <>Updates row {initialContract?.rowNumber} in <strong style={{ color: 'var(--st-gold)' }}>Contracts</strong> without touching your Paid/Still Owed formulas.</>
                : isChangeOrderMode
                  ? <>Current quote: <strong style={{ color: 'var(--st-text)' }}>{formatMoney(initialContract?.quote || 0)}</strong>. Enter the change order amount below to add it to this contract.</>
                  : <>Drop an emailed PDF/photo for AI auto-fill, or enter the quote manually into <strong style={{ color: 'var(--st-gold)' }}>Contracts</strong>.</>}
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={saving || extracting}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--st-line)',
              color: 'var(--st-muted)',
              borderRadius: '8px',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex'
            }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Optional PDF / Photo Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer?.files?.[0];
            if (dropped) handleFileSelected(dropped);
          }}
          onClick={() => !extracting && !saving && fileInputRef.current?.click()}
          style={{
            border: dragOver ? '1.5px dashed var(--st-gold)' : '1px dashed var(--color-zinc-700)',
            backgroundColor: dragOver ? 'rgba(212, 183, 135, 0.08)' : 'rgba(0, 0, 0, 0.3)',
            borderRadius: '10px',
            padding: '14px 12px',
            textAlign: 'center',
            cursor: extracting || saving ? 'not-allowed' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease'
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) handleFileSelected(picked);
            }}
          />
          {extracting ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--st-gold)', fontSize: '0.82rem', fontWeight: 600 }}>
              <Loader2 size={16} className="animate-spin" />
              <span>Reading quote with AI...</span>
            </div>
          ) : attachedFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <FileUp size={16} style={{ color: 'var(--st-gold)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--st-text)' }}>{attachedFile.name}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--st-muted)' }}>(Tap to replace file)</span>
            </div>
          ) : (
            <>
              <UploadCloud size={20} style={{ color: 'var(--st-gold)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--st-text)' }}>
                {isChangeOrderMode
                  ? 'Upload Change Order PDF or Photo '
                  : 'Upload Emailed Quote PDF or Photo '}
                <span style={{ color: 'var(--st-muted)', fontWeight: 400 }}>(Optional)</span>
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--st-muted)' }}>
                AI pre-fills the fields below &amp; archives the PDF in &ldquo;Contracts &amp; Quotes&rdquo;
              </span>
            </>
          )}
        </div>

        {aiNotice && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: 'rgba(212, 183, 135, 0.1)',
            border: '1px solid rgba(212, 183, 135, 0.28)',
            fontSize: '0.74rem',
            color: 'var(--st-gold)'
          }}>
            <Sparkles size={14} style={{ flexShrink: 0 }} />
            <span>{aiNotice}</span>
          </div>
        )}

        {modalError && (
          <div style={{
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fca5a5',
            fontSize: '0.76rem',
            lineHeight: 1.4
          }}>
            {modalError}
          </div>
        )}

        {/* Sub & Company Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.72rem', marginBottom: '4px', display: 'block' }}>
              Sub Name (Person)
            </label>
            <input
              type="text"
              list="quote-known-subs"
              className="form-input"
              placeholder="e.g. Enrique Vallejo"
              value={sub}
              onChange={(e) => {
                setSub(e.target.value);
                setConflictMatches(null);
              }}
              disabled={saving}
            />
            <datalist id="quote-known-subs">
              {knownSubSuggestions.subs.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.72rem', marginBottom: '4px', display: 'block' }}>
              Company Name
            </label>
            <input
              type="text"
              list="quote-known-companies"
              className="form-input"
              placeholder="e.g. Lucen LLC"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setConflictMatches(null);
              }}
              disabled={saving}
            />
            <datalist id="quote-known-companies">
              {knownSubSuggestions.companies.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Dynamic Phase Lines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--st-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contract Phase{items.length > 1 ? 's' : ''} ({items.length})
            </span>
            {!isEditMode && !isChangeOrderMode && (
              <button
                type="button"
                onClick={handleAddLine}
                disabled={saving}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(212, 183, 135, 0.35)',
                  color: 'var(--st-gold)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Plus size={12} /> Add Another Phase
              </button>
            )}
          </div>

          {items.map((line, index) => {
            const catObj = TRADE_CATEGORIES.find(c => c.key === line.tradeCategory) || TRADE_CATEGORIES[0];
            return (
              <div
                key={line.id}
                style={{
                  backgroundColor: 'var(--st-soft)',
                  border: '1px solid var(--st-line)',
                  borderRadius: '10px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--st-muted)' }}>
                    Phase Row #{index + 1}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(line.id)}
                      disabled={saving}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex'
                      }}
                      title="Remove phase row"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.68rem', marginBottom: '3px', display: 'block' }}>
                      Category
                    </label>
                    <select
                      className="form-input"
                      value={line.tradeCategory}
                      onChange={(e) => handleCategoryChange(line.id, e.target.value)}
                      disabled={saving}
                    >
                      {TRADE_CATEGORIES.map(c => (
                        <option key={c.key} value={c.key}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: '0.68rem', marginBottom: '3px', display: 'block' }}>
                      Phase
                    </label>
                    <select
                      className="form-input"
                      value={line.tradePhase}
                      onChange={(e) => handleLineChange(line.id, 'tradePhase', e.target.value)}
                      disabled={saving}
                    >
                      {catObj.phases.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.68rem', marginBottom: '3px', display: 'block' }}>
                    {isChangeOrderMode ? 'Change Order Amount to Add ($)' : 'Contract Quote Amount ($)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    placeholder={isChangeOrderMode ? 'e.g. 1250.00' : 'e.g. 14500.00'}
                    value={line.quoteAmount}
                    onChange={(e) => handleLineChange(line.id, 'quoteAmount', e.target.value)}
                    disabled={saving}
                  />
                  {isChangeOrderMode && parseMoney(line.quoteAmount) > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--st-gold)', fontWeight: 600, marginTop: '5px' }}>
                      New Total Quote: {formatMoney(parseMoney(initialContract?.quote) + parseMoney(line.quoteAmount))}
                    </div>
                  )}
                </div>

                {line.scopeSummary && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--st-muted)', fontStyle: 'italic', lineHeight: 1.3 }}>
                    Scope: {line.scopeSummary}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Duplicate Contract Resolution Prompt */}
        {conflictMatches && conflictMatches.length > 0 && (
          <div style={{
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '10px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: 'var(--color-amber-400)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.76rem', color: 'var(--st-text)', lineHeight: 1.4 }}>
                <strong>Existing Contract Found:</strong>{' '}
                {conflictMatches.map(m => `${m.phase} (currently ${formatMoney(m.oldQuote)})`).join(', ')}. How would you like to save this quote?
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => executeSave('replace')}
                style={{ fontSize: '0.76rem', padding: '8px 10px' }}
              >
                Replace Existing Quote ({conflictMatches.map(m => `${formatMoney(m.oldQuote)} → ${formatMoney(m.newQuote)}`).join(', ')})
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => executeSave('add_to_quote')}
                style={{ fontSize: '0.76rem', padding: '8px 10px', borderColor: 'rgba(212, 183, 135, 0.4)', color: 'var(--st-gold)' }}
              >
                Add to Existing Quote / Change Order ({conflictMatches.map(m => `${formatMoney(m.oldQuote)} + ${formatMoney(m.newQuote)} = ${formatMoney(m.combinedQuote)}`).join(', ')})
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => executeSave('append_row')}
                style={{ fontSize: '0.76rem', padding: '8px 10px' }}
              >
                Add as a Separate Row in Contracts
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {!conflictMatches && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={resetAndClose}
              disabled={saving || extracting}
              style={{ width: 'auto', padding: '9px 14px', fontSize: '0.8rem' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => executeSave(null)}
              disabled={saving || extracting}
              style={{ width: 'auto', padding: '9px 16px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Saving to Contracts...</span>
                </>
              ) : (
                <span>
                  {isEditMode
                    ? 'Update Quote'
                    : isChangeOrderMode
                      ? 'Add Change Order'
                      : 'Save to Contracts'}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
