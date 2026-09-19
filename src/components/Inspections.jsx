import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  Camera,
  Trash2,
  ChevronDown,
  ChevronUp,
  Folder
} from 'lucide-react';
import {
  INSPECTION_STAGES,
  loadInspectionData,
  saveInspectionData
} from '../services/inspectionService';

export default function Inspections({ activeProject, selectedFolder }) {
  const [activeStageId, setActiveStageId] = useState('rough-in-plumbing');
  const [items, setItems] = useState([]);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});

  // New Custom Item Form State
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Underground Plumbing');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemNote, setNewItemNote] = useState('');

  const projectId = activeProject?.id || selectedFolder?.id || 'default_project';

  useEffect(() => {
    const loaded = loadInspectionData(projectId, activeStageId);
    setItems(loaded);
  }, [projectId, activeStageId]);

  const handleStatusChange = (itemId, newStatus) => {
    const updated = items.map(item => {
      if (item.id === itemId) {
        return { ...item, status: newStatus };
      }
      return item;
    });
    setItems(updated);
    saveInspectionData(projectId, activeStageId, updated);
  };

  const handleNoteChange = (itemId, noteText) => {
    const updated = items.map(item => {
      if (item.id === itemId) {
        return { ...item, note: noteText };
      }
      return item;
    });
    setItems(updated);
    saveInspectionData(projectId, activeStageId, updated);
  };

  const handlePhotoUpload = (itemId, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result;
      const updated = items.map(item => {
        if (item.id === itemId) {
          return { ...item, photoUrl: base64 };
        }
        return item;
      });
      setItems(updated);
      saveInspectionData(projectId, activeStageId, updated);
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = (itemId) => {
    const updated = items.map(item => {
      if (item.id === itemId) {
        return { ...item, photoUrl: null };
      }
      return item;
    });
    setItems(updated);
    saveInspectionData(projectId, activeStageId, updated);
  };

  const handleAddCustomItem = (e) => {
    e.preventDefault();
    if (!newItemTitle.trim()) return;

    const newItem = {
      id: `custom-${Date.now()}`,
      title: newItemTitle.trim(),
      category: newItemCategory.trim() || 'Custom Rules',
      description: newItemDesc.trim() || 'Custom job site inspection rule.',
      status: 'pending',
      photoUrl: null,
      note: newItemNote.trim()
    };

    const updated = [newItem, ...items];
    setItems(updated);
    saveInspectionData(projectId, activeStageId, updated);

    // Reset Form
    setNewItemTitle('');
    setNewItemDesc('');
    setNewItemNote('');
    setShowAddModal(false);
  };

  const handleDeleteItem = (itemId) => {
    const updated = items.filter(item => item.id !== itemId);
    setItems(updated);
    saveInspectionData(projectId, activeStageId, updated);
  };

  // Metrics
  const totalItems = items.length;
  const passedCount = items.filter(i => i.status === 'passed').length;
  const fixCount = items.filter(i => i.status === 'fix_required').length;
  const pendingCount = items.filter(i => i.status === 'pending').length;
  const passPercentage = totalItems > 0 ? Math.round((passedCount / totalItems) * 100) : 0;

  // Categories
  const categories = ['all', ...new Set(items.map(i => i.category))];
  const filteredItems = filterCategory === 'all' ? items : items.filter(i => i.category === filterCategory);

  const activeStage = INSPECTION_STAGES.find(s => s.id === activeStageId) || INSPECTION_STAGES[0];

  return (
    <div className="inspections-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Compact Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ClipboardCheck style={{ color: 'var(--color-accent)' }} size={20} />
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#fff' }}>
          City Inspection Pre-Check
        </h2>
      </div>

      {/* Municipal Stages 2-Row Grid (3x2) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px'
        }}
      >
        {INSPECTION_STAGES.map(stage => {
          const isSelected = stage.id === activeStageId;
          return (
            <button
              type="button"
              key={stage.id}
              onClick={() => setActiveStageId(stage.id)}
              style={{
                padding: '8px 6px',
                borderRadius: '10px',
                border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-zinc-800)',
                background: isSelected ? 'rgba(var(--color-accent-rgb), 0.15)' : 'var(--color-zinc-900)',
                color: isSelected ? 'var(--color-accent)' : 'var(--color-zinc-300)',
                fontSize: '0.75rem',
                fontWeight: isSelected ? 700 : 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                textAlign: 'center'
              }}
            >
              <span>{stage.icon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stage.number}. {stage.shortName}</span>
            </button>
          );
        })}
      </div>

      {/* Stage Summary Card & Readiness Gauge */}
      <div className="card settings-card" style={{ background: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              STAGE {activeStage.number} PRE-CHECK • {totalItems} ITEMS TOTAL
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '2px 0 4px 0' }}>
              {activeStage.icon} {activeStage.name}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-zinc-400)', margin: 0 }}>
              {activeStage.description}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: passPercentage === 100 ? '#10b981' : 'var(--color-accent)' }}>
              {passPercentage}%
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-zinc-400)' }}>Ready for Inspector</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ height: '8px', background: 'var(--color-zinc-800)', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
          <div
            style={{
              height: '100%',
              width: `${passPercentage}%`,
              background: passPercentage === 100 ? '#10b981' : 'var(--color-accent)',
              transition: 'width 0.4s ease'
            }}
          />
        </div>

        {/* Status Badges Summary */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.78rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#10b981' }}>
              <CheckCircle2 size={14} /> {passedCount} Passed
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#f43f5e' }}>
              <AlertTriangle size={14} /> {fixCount} Needs Fix
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#C5A059' }}>
              <Clock size={14} /> {pendingCount} Pending
            </div>
          </div>
        </div>
      </div>



      {/* Category Filter Pills */}
      {categories.length > 2 && (
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
          {categories.map(cat => {
            const count = cat === 'all' ? items.length : items.filter(i => i.category === cat).length;
            return (
              <button
                type="button"
                key={cat}
                onClick={() => setFilterCategory(cat)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  border: filterCategory === cat ? '1px solid var(--color-zinc-600)' : '1px solid var(--color-zinc-800)',
                  background: filterCategory === cat ? 'var(--color-zinc-800)' : 'transparent',
                  color: filterCategory === cat ? '#fff' : 'var(--color-zinc-400)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {cat === 'all' ? `All Items (${count})` : `${cat} (${count})`}
              </button>
            );
          })}
        </div>
      )}

      {/* Grouped Collapsible Trade Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {(() => {
          // Group items by category
          const grouped = {};
          filteredItems.forEach(item => {
            const cat = item.category || 'General';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
          });

          const toggleCategoryCollapse = (catName) => {
            setCollapsedCategories(prev => ({
              ...prev,
              [catName]: prev[catName] === false ? true : false
            }));
          };

          return Object.keys(grouped).map(catName => {
            const catItems = grouped[catName];
            const catTotal = catItems.length;
            const catPassed = catItems.filter(i => i.status === 'passed').length;
            const catFix = catItems.filter(i => i.status === 'fix_required').length;
            const unpassedCriticalCount = catItems.filter(i => i.status !== 'passed' && i.note && (i.note.startsWith('CRITICAL') || i.note.startsWith('Ensure') || i.note.startsWith('Check') || i.note.startsWith('BUILDER REMINDER'))).length;
            const isCollapsed = collapsedCategories[catName] !== false; // default true (collapsed)

            return (
              <div
                key={catName}
                style={{
                  background: 'var(--color-zinc-950)',
                  border: unpassedCriticalCount > 0 ? '1px solid rgba(197, 160, 89, 0.4)' : '1px solid var(--color-zinc-800)',
                  borderRadius: '12px',
                  overflow: 'hidden'
                }}
              >
                {/* Trade Section Collapsible Header */}
                <div
                  onClick={() => toggleCategoryCollapse(catName)}
                  style={{
                    padding: '12px 14px',
                    background: unpassedCriticalCount > 0 ? 'rgba(197, 160, 89, 0.08)' : 'var(--color-zinc-900)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--color-zinc-800)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <Folder size={18} style={{ color: unpassedCriticalCount > 0 ? '#C5A059' : 'var(--color-accent)' }} />
                    <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>
                      {catName}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-zinc-400)', background: 'var(--color-zinc-800)', padding: '1px 7px', borderRadius: '10px' }}>
                      {catTotal} {catTotal === 1 ? 'Rule' : 'Rules'}
                    </span>
                    {unpassedCriticalCount > 0 && (
                      <span style={{ fontSize: '0.72rem', background: 'rgba(197, 160, 89, 0.22)', color: '#F1D7A7', border: '1px solid rgba(197, 160, 89, 0.45)', padding: '1px 8px', borderRadius: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        🔥 {unpassedCriticalCount} Watch-Out{unpassedCriticalCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontSize: '0.72rem', color: catPassed === catTotal ? '#10b981' : 'var(--color-accent)' }}>
                      {catPassed}/{catTotal} Passed {catFix > 0 && <span style={{ color: '#f43f5e' }}>({catFix} Fix)</span>}
                    </div>
                    {isCollapsed ? (
                      <ChevronDown size={18} style={{ color: unpassedCriticalCount > 0 ? '#C5A059' : 'var(--color-zinc-400)' }} />
                    ) : (
                      <ChevronUp size={18} style={{ color: unpassedCriticalCount > 0 ? '#C5A059' : 'var(--color-zinc-400)' }} />
                    )}
                  </div>
                </div>

                {/* Collapsible Content: Item Cards */}
                {!isCollapsed && (
                  <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {catItems.map(item => {
                      const isPassed = item.status === 'passed';
                      const isFix = item.status === 'fix_required';
                      const isCritical = item.note && (item.note.startsWith('CRITICAL') || item.note.startsWith('Ensure') || item.note.startsWith('Check') || item.note.startsWith('BUILDER REMINDER'));

                      return (
                        <div
                          key={item.id}
                          className="card settings-card"
                          style={{
                            borderLeft: isPassed ? '4px solid #10b981' : isFix ? '4px solid #f43f5e' : isCritical ? '4px solid #C5A059' : '4px solid var(--color-zinc-700)',
                            border: isCritical && !isPassed ? '1px solid rgba(197, 160, 89, 0.4)' : '1px solid var(--color-zinc-800)',
                            background: isCritical && !isPassed ? 'rgba(197, 160, 89, 0.04)' : 'var(--color-zinc-900)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            padding: '12px'
                          }}
                        >
                          {/* Critical Watch-Out Header Badge */}
                          {isCritical && !isPassed && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(197, 160, 89, 0.2)', color: '#F1D7A7', fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', width: 'fit-content', letterSpacing: '0.04em' }}>
                              <AlertTriangle size={13} style={{ color: '#C5A059' }} />
                              🔥 CRITICAL INSPECTOR WATCH-OUT
                            </div>
                          )}

                          {/* Card Header & Title */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                            <div>
                              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: '#fff' }}>
                                {item.title}
                              </h4>
                              <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-400)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                                {item.description}
                              </p>
                            </div>
                            {item.id.startsWith('custom-') && (
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item.id)}
                                style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', padding: '2px' }}
                                title="Delete custom item"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>

                          {/* Critical Rule Alert Callout Box */}
                          {item.note && (item.note.startsWith('CRITICAL') || item.note.startsWith('Ensure') || item.note.startsWith('Check') || item.note.startsWith('BUILDER REMINDER')) && (
                            <div
                              style={{
                                backgroundColor: 'rgba(197, 160, 89, 0.12)',
                                border: '1px solid rgba(197, 160, 89, 0.4)',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                color: '#F1D7A7',
                                fontSize: '0.78rem',
                                lineHeight: 1.4,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px'
                              }}
                            >
                              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px', color: '#C5A059' }} />
                              <span>{item.note}</span>
                            </div>
                          )}

                          {/* Status Action Buttons Toggle */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => handleStatusChange(item.id, 'passed')}
                              style={{
                                padding: '6px 4px',
                                borderRadius: '8px',
                                border: isPassed ? '1.5px solid #10b981' : '1px solid var(--color-zinc-800)',
                                background: isPassed ? 'rgba(16, 185, 129, 0.15)' : 'var(--color-zinc-950)',
                                color: isPassed ? '#10b981' : 'var(--color-zinc-400)',
                                fontSize: '0.75rem',
                                fontWeight: isPassed ? 700 : 500,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                              }}
                            >
                              <CheckCircle2 size={13} /> Passed
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStatusChange(item.id, 'pending')}
                              style={{
                                padding: '6px 4px',
                                borderRadius: '8px',
                                border: item.status === 'pending' ? '1.5px solid #C5A059' : '1px solid var(--color-zinc-800)',
                                background: item.status === 'pending' ? 'rgba(197, 160, 89, 0.15)' : 'var(--color-zinc-950)',
                                color: item.status === 'pending' ? '#C5A059' : 'var(--color-zinc-400)',
                                fontSize: '0.75rem',
                                fontWeight: item.status === 'pending' ? 700 : 500,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                              }}
                            >
                              <Clock size={13} /> Pending
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStatusChange(item.id, 'fix_required')}
                              style={{
                                padding: '6px 4px',
                                borderRadius: '8px',
                                border: isFix ? '1.5px solid #f43f5e' : '1px solid var(--color-zinc-800)',
                                background: isFix ? 'rgba(244, 63, 94, 0.15)' : 'var(--color-zinc-950)',
                                color: isFix ? '#f43f5e' : 'var(--color-zinc-400)',
                                fontSize: '0.75rem',
                                fontWeight: isFix ? 700 : 500,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                              }}
                            >
                              <AlertTriangle size={13} /> Needs Fix
                            </button>
                          </div>

                          {/* Note Input & Photo Attachment Section */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px', borderTop: '1px dashed var(--color-zinc-800)' }}>
                            <input
                              type="text"
                              className="input-field"
                              value={item.userNote || (!item.note?.startsWith('CRITICAL:') && !item.note?.startsWith('Ensure') && !item.note?.startsWith('Check') ? item.note : '')}
                              onChange={(e) => handleNoteChange(item.id, e.target.value)}
                              placeholder="Add custom inspector note or photo detail..."
                              style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                            />

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              {item.photoUrl ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <img
                                    src={item.photoUrl}
                                    alt="Photo Proof"
                                    style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--color-zinc-700)' }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePhoto(item.id)}
                                    style={{ background: 'none', border: 'none', color: '#f43f5e', fontSize: '0.72rem', cursor: 'pointer' }}
                                  >
                                    Remove Photo
                                  </button>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-zinc-500)', fontStyle: 'italic' }}>
                                  No photo proof attached
                                </span>
                              )}

                              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0, padding: '4px 8px', fontSize: '0.72rem' }}>
                                <Camera size={12} style={{ marginRight: '4px' }} />
                                {item.photoUrl ? 'Change Photo' : 'Attach Photo'}
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handlePhotoUpload(item.id, e)}
                                  style={{ display: 'none' }}
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Add Custom Rule Button at Very Bottom */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '11px 16px',
            fontSize: '0.85rem',
            fontWeight: 700,
            border: '1px dashed rgba(197, 160, 89, 0.4)',
            background: 'rgba(197, 160, 89, 0.08)',
            color: '#F1D7A7',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <Plus size={17} style={{ color: '#C5A059' }} /> Add Custom Rule to {activeStage.shortName}
        </button>
      </div>

      {/* Modal for Adding Custom Inspection Rule */}
      {showAddModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="modal-content card" style={{ width: '100%', maxWidth: '440px', background: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)', borderRadius: '14px', padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 14px 0' }}>Add Custom Inspection Rule</h3>
            <form onSubmit={handleAddCustomItem} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                  Rule / Item Title *
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  placeholder="e.g. Check 4-inch cleanout cap tightness"
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                  Category
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  placeholder="e.g. Underground Plumbing"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                  Description / Details
                </label>
                <textarea
                  className="input-field"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  placeholder="Describe what the inspector checks or what sub-contractor must verify..."
                  rows={2}
                  style={{ width: '100%', resize: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                  Initial Note (Optional)
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newItemNote}
                  onChange={(e) => setNewItemNote(e.target.value)}
                  placeholder="e.g. Inspector dinged us on this last build"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  Save Custom Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
