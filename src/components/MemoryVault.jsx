import React, { useState, useEffect } from 'react';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Edit2,
  History,
  X,
  User,
  Bot,
  Globe,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  getMemories,
  saveMemory,
  updateMemory,
  deactivateMemory,
  searchMemories
} from '../services/memoryService.js';

export default function MemoryVault({ projectId, projectName }) {
  const [memories, setMemories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [importanceFilter, setImportanceFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all'); // 'all' | 'active' | 'global'
  const [expandedHistoryIds, setExpandedHistoryIds] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [editReason, setEditReason] = useState('');

  const [newForm, setNewForm] = useState({
    text: '',
    projectId: projectId || '',
    isGlobal: false,
    category: 'subcontractor',
    memoryType: 'subcontractor',
    importance: 'important',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  const loadMemories = async () => {
    try {
      let items = [];
      if (searchQuery.trim()) {
        items = await searchMemories(searchQuery, {
          projectId: scopeFilter === 'active' ? projectId : null,
          category: categoryFilter !== 'all' ? categoryFilter : null,
          memoryType: categoryFilter !== 'all' ? categoryFilter : null,
          includePersonal: scopeFilter === 'personal' || scopeFilter === 'all',
          limit: 50
        });
      } else {
        items = await getMemories({
          projectId: scopeFilter === 'active' ? projectId : (scopeFilter === 'global' ? 'global' : scopeFilter === 'personal' ? 'personal' : null),
          scope: scopeFilter !== 'all' ? scopeFilter : null,
          category: categoryFilter !== 'all' ? categoryFilter : null,
          includeGlobal: scopeFilter !== 'active' && scopeFilter !== 'personal',
          includePersonal: scopeFilter === 'personal' || scopeFilter === 'all',
          activeOnly: true
        });
      }

      if (importanceFilter !== 'all') {
        items = items.filter(m => m.importance === importanceFilter);
      }

      setMemories(items);
    } catch (err) {
      console.error('Error fetching memories in vault:', err);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [projectId, searchQuery, categoryFilter, importanceFilter, scopeFilter]);

  const toggleHistory = (id) => {
    setExpandedHistoryIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!newForm.text.trim()) return;

    try {
      await saveMemory({
        text: newForm.text.trim(),
        projectId: newForm.isGlobal ? null : (newForm.projectId || projectId),
        isGlobal: Boolean(newForm.isGlobal),
        category: newForm.category,
        memoryType: newForm.memoryType,
        importance: newForm.importance,
        effectiveDate: newForm.effectiveDate || null,
        source: 'user_explicit'
      });

      setNewForm({
        text: '',
        projectId: projectId || '',
        isGlobal: false,
        category: 'subcontractor',
        memoryType: 'subcontractor',
        importance: 'important',
        effectiveDate: new Date().toISOString().split('T')[0]
      });
      setShowAddModal(false);
      await loadMemories();
    } catch (err) {
      alert('Failed to save memory: ' + err.message);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingMemory || !editingMemory.text.trim()) return;

    try {
      await updateMemory(
        editingMemory.id,
        {
          text: editingMemory.text.trim(),
          category: editingMemory.category,
          memoryType: editingMemory.memoryType,
          importance: editingMemory.importance,
          isGlobal: editingMemory.isGlobal,
          effectiveDate: editingMemory.effectiveDate
        },
        editReason.trim() || 'Updated via Memory Vault UI'
      );
      setEditingMemory(null);
      setEditReason('');
      await loadMemories();
    } catch (err) {
      alert('Failed to update memory: ' + err.message);
    }
  };

  const handleDelete = async (memory) => {
    if (window.confirm(`⚠️ Confirm Deactivation:\n\nAre you sure you want to deactivate and forget this memory?\n\n"${memory.text}"`)) {
      try {
        await deactivateMemory(memory.id, 'Deactivated via Memory Vault UI');
        await loadMemories();
      } catch (err) {
        alert('Failed to deactivate memory: ' + err.message);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header Banner */}
      <div
        style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid var(--color-zinc-800)',
          borderLeft: '4px solid var(--color-amber-500)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-zinc-100)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Brain size={20} style={{ color: 'var(--color-amber-400)' }} />
              Second Brain — Persistent Memory Vault
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-zinc-400)' }}>
              Inspect, search, and manage permanent business decisions, subcontractor preferences, quotes, and lessons learned.
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            style={{
              backgroundColor: 'var(--color-amber-500)',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(197, 160, 89, 0.25)'
            }}
          >
            <Plus size={16} />
            <span>Add Memory Note</span>
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', paddingTop: '6px' }}>
          {/* Search input */}
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-zinc-400)' }} />
            <input
              type="text"
              placeholder="Search memories, painter preferences, quotes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px 8px 32px',
                borderRadius: '6px',
                border: '1px solid var(--color-zinc-700)',
                backgroundColor: 'var(--color-zinc-950)',
                color: 'var(--color-zinc-100)',
                fontSize: '0.8rem',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Scope selector */}
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-zinc-700)',
              backgroundColor: 'var(--color-zinc-950)',
              color: 'var(--color-zinc-200)',
              fontSize: '0.8rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Scopes (Projects, Global & Personal)</option>
            <option value="active">Active Project ({projectName})</option>
            <option value="global">Global Business Knowledge</option>
            <option value="personal">Personal Notes & Reminders</option>
          </select>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-zinc-700)',
              backgroundColor: 'var(--color-zinc-950)',
              color: 'var(--color-zinc-200)',
              fontSize: '0.8rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Categories</option>
            <option value="subcontractor">Subcontractors</option>
            <option value="vendor">Vendors & Suppliers</option>
            <option value="decision">Site Decisions</option>
            <option value="preference">Preferences</option>
            <option value="quote">Quotes</option>
            <option value="lesson_learned">Lessons Learned</option>
            <option value="business_rule">Business Rules</option>
            <option value="instruction">Instructions</option>
            <option value="general">General Notes</option>
          </select>

          {/* Importance filter */}
          <select
            value={importanceFilter}
            onChange={(e) => setImportanceFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-zinc-700)',
              backgroundColor: 'var(--color-zinc-950)',
              color: 'var(--color-zinc-200)',
              fontSize: '0.8rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Importance</option>
            <option value="critical">⚡ Critical</option>
            <option value="important">Important</option>
            <option value="informational">Informational</option>
          </select>
        </div>
      </div>

      {/* Memory List Cards */}
      {memories.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--color-zinc-900)',
            border: '1px dashed var(--color-zinc-800)',
            borderRadius: '10px',
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--color-zinc-400)'
          }}
        >
          <Brain size={36} style={{ opacity: 0.4, marginBottom: '8px', color: 'var(--color-amber-400)' }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-zinc-200)' }}>
            No persistent memories found
          </div>
          <div style={{ fontSize: '0.78rem', marginTop: '4px', maxWidth: '380px', margin: '4px auto 0' }}>
            Tell Jarvis in voice or chat: <em>"Remember that..."</em> or click <strong>Add Memory Note</strong> above to store facts, decisions, and subcontractor rules.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {memories.map((mem) => {
            const hasHistory = Array.isArray(mem.changeHistory) && mem.changeHistory.length > 0;
            const isExpanded = expandedHistoryIds[mem.id];

            return (
              <div
                key={mem.id}
                style={{
                  backgroundColor: 'var(--color-zinc-900)',
                  border: '1px solid var(--color-zinc-800)',
                  borderLeft: `4px solid ${
                    mem.importance === 'critical'
                      ? '#ef4444'
                      : mem.importance === 'important'
                      ? 'var(--color-amber-500)'
                      : 'var(--color-zinc-600)'
                  }`,
                  borderRadius: '10px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                {/* Card Top Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {/* Scope Badge */}
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: mem.isGlobal ? 'rgba(59, 130, 246, 0.15)' : 'rgba(197, 160, 89, 0.15)',
                        color: mem.isGlobal ? '#60a5fa' : 'var(--color-amber-400)',
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {mem.isGlobal ? <Globe size={11} /> : '📍'}
                      {mem.isGlobal ? 'GLOBAL BUSINESS' : (mem.projectId || 'LOT UNASSIGNED')}
                    </span>

                    {/* Category Pill */}
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--color-zinc-800)',
                        color: 'var(--color-zinc-300)',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        textTransform: 'uppercase'
                      }}
                    >
                      {mem.memoryType || mem.category || 'fact'}
                    </span>

                    {/* Importance Badge */}
                    {mem.importance === 'critical' && (
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          fontSize: '0.68rem',
                          fontWeight: 800
                        }}
                      >
                        ⚡ CRITICAL
                      </span>
                    )}

                    {/* Source Badge */}
                    <span
                      style={{
                        fontSize: '0.68rem',
                        color: 'var(--color-zinc-400)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      {mem.source === 'ai_inferred' ? <Bot size={12} /> : <User size={12} />}
                      {mem.source === 'ai_inferred' ? 'AI Inferred' : 'User Stated'}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setEditingMemory(mem)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-zinc-400)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Edit Memory"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(mem)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Forget / Deactivate Memory"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Memory Text */}
                <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-zinc-100)', lineHeight: 1.4 }}>
                  "{mem.text}"
                </div>

                {/* Tags & Dates Footnote */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--color-zinc-800)', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {Array.isArray(mem.tags) && mem.tags.map((t, idx) => (
                      <span key={idx} style={{ fontSize: '0.68rem', color: 'var(--color-zinc-400)', backgroundColor: 'var(--color-zinc-950)', padding: '1px 6px', borderRadius: '3px' }}>
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.7rem', color: 'var(--color-zinc-400)' }}>
                    {mem.effectiveDate && (
                      <span>Effective: {mem.effectiveDate}</span>
                    )}
                    <span>Saved: {new Date(mem.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>

                    {hasHistory && (
                      <button
                        onClick={() => toggleHistory(mem.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-amber-400)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: 0
                        }}
                      >
                        <History size={12} />
                        <span>History ({mem.changeHistory.length})</span>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Change History Dropdown */}
                {hasHistory && isExpanded && (
                  <div
                    style={{
                      marginTop: '6px',
                      backgroundColor: 'var(--color-zinc-950)',
                      border: '1px solid var(--color-zinc-800)',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-amber-400)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <History size={12} />
                      Audit & Revision History
                    </div>
                    {mem.changeHistory.map((h, hIdx) => (
                      <div key={hIdx} style={{ fontSize: '0.75rem', color: 'var(--color-zinc-300)', borderLeft: '2px solid var(--color-zinc-700)', paddingLeft: '8px' }}>
                        <div style={{ color: 'var(--color-zinc-400)', fontSize: '0.68rem' }}>
                          {new Date(h.timestamp).toLocaleString()} • {h.reason || 'Edited'} by {h.modifiedBy || 'user'}
                        </div>
                        <div style={{ marginTop: '2px', color: 'var(--color-zinc-300)' }}>
                          Previous: <em>"{h.previousText}"</em>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ADD MEMORY MODAL */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-zinc-900)',
              border: '1px solid var(--color-zinc-800)',
              borderTop: '4px solid var(--color-amber-500)',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '480px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--color-zinc-100)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Brain size={18} style={{ color: 'var(--color-amber-400)' }} />
                Add Persistent Memory Note
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Memory / Fact / Agreement</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Painter prefers ACH payment. Or: John quoted $8,500 for electrical rough-in."
                  value={newForm.text}
                  onChange={(e) => setNewForm({ ...newForm, text: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-zinc-700)',
                    backgroundColor: 'var(--color-zinc-950)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    marginTop: '4px',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Category / Type</label>
                  <select
                    value={newForm.category}
                    onChange={(e) => setNewForm({ ...newForm, category: e.target.value, memoryType: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-zinc-700)',
                      backgroundColor: 'var(--color-zinc-950)',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginTop: '4px'
                    }}
                  >
                    <option value="subcontractor">Subcontractor</option>
                    <option value="vendor">Vendor / Supplier</option>
                    <option value="quote">Quote / Estimate</option>
                    <option value="decision">Site Decision</option>
                    <option value="preference">Preference</option>
                    <option value="lesson_learned">Lesson Learned</option>
                    <option value="business_rule">Business Rule</option>
                    <option value="instruction">Instruction</option>
                    <option value="general">General Fact</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Importance</label>
                  <select
                    value={newForm.importance}
                    onChange={(e) => setNewForm({ ...newForm, importance: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-zinc-700)',
                      backgroundColor: 'var(--color-zinc-950)',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginTop: '4px'
                    }}
                  >
                    <option value="critical">⚡ Critical</option>
                    <option value="important">Important</option>
                    <option value="informational">Informational</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Project / Lot Scope</label>
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      id="isGlobalCheck"
                      checked={newForm.isGlobal}
                      onChange={(e) => setNewForm({ ...newForm, isGlobal: e.target.checked })}
                      style={{ accentColor: 'var(--color-amber-500)' }}
                    />
                    <label htmlFor="isGlobalCheck" style={{ fontSize: '0.78rem', color: 'var(--color-zinc-300)', cursor: 'pointer' }}>
                      Global (All Projects)
                    </label>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Effective Date</label>
                  <input
                    type="date"
                    value={newForm.effectiveDate}
                    onChange={(e) => setNewForm({ ...newForm, effectiveDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-zinc-700)',
                      backgroundColor: 'var(--color-zinc-950)',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginTop: '4px'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-zinc-700)',
                    color: 'var(--color-zinc-300)',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'var(--color-amber-500)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Save to Memory
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MEMORY MODAL */}
      {editingMemory && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-zinc-900)',
              border: '1px solid var(--color-zinc-800)',
              borderTop: '4px solid var(--color-amber-500)',
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '480px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--color-zinc-100)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit2 size={18} style={{ color: 'var(--color-amber-400)' }} />
                Edit Memory & Retain Audit Trail
              </h3>
              <button
                onClick={() => setEditingMemory(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-zinc-400)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Updated Memory Text</label>
                <textarea
                  rows={3}
                  value={editingMemory.text}
                  onChange={(e) => setEditingMemory({ ...editingMemory, text: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-zinc-700)',
                    backgroundColor: 'var(--color-zinc-950)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    marginTop: '4px',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-amber-400)' }}>Reason for Change (Audit Log)</label>
                <input
                  type="text"
                  placeholder="e.g. Painter switched from check to ACH preference"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-zinc-700)',
                    backgroundColor: 'var(--color-zinc-950)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    marginTop: '4px'
                  }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Category / Type</label>
                  <select
                    value={editingMemory.category}
                    onChange={(e) => setEditingMemory({ ...editingMemory, category: e.target.value, memoryType: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-zinc-700)',
                      backgroundColor: 'var(--color-zinc-950)',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginTop: '4px'
                    }}
                  >
                    <option value="subcontractor">Subcontractor</option>
                    <option value="vendor">Vendor / Supplier</option>
                    <option value="quote">Quote / Estimate</option>
                    <option value="decision">Site Decision</option>
                    <option value="preference">Preference</option>
                    <option value="lesson_learned">Lesson Learned</option>
                    <option value="business_rule">Business Rule</option>
                    <option value="instruction">Instruction</option>
                    <option value="general">General Fact</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-zinc-400)' }}>Importance</label>
                  <select
                    value={editingMemory.importance}
                    onChange={(e) => setEditingMemory({ ...editingMemory, importance: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-zinc-700)',
                      backgroundColor: 'var(--color-zinc-950)',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginTop: '4px'
                    }}
                  >
                    <option value="critical">⚡ Critical</option>
                    <option value="important">Important</option>
                    <option value="informational">Informational</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditingMemory(null)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-zinc-700)',
                    color: 'var(--color-zinc-300)',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'var(--color-amber-500)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Update Memory
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
