import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import IssueCard from './IssueCard';
import IssueFormModal from './IssueFormModal';
import { TRADE_SECTIONS_CONFIG } from '../services/editFormHelpers';

export default function DashboardPunchList({
  issuesState,
  googleToken,
  activeProject,
  subcontractors = [],
  projectInfo = null,
  selectedFolderName = '',
  onSendIssuePacket
}) {
  const {
    issues = [],
    loading,
    syncing,
    error,
    success,
    addIssue,
    updateIssue,
    updateIssueStatus,
    softDeleteIssue,
    triggerSync
  } = issuesState;

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all-active'); // 'all-active' | 'open' | 'in_progress' | 'resolved' | 'all'

  // Filter out soft-deleted issues
  const activeIssues = issues.filter(i => !i.deletedAt);

  // Compute status counts for active issues
  const counts = activeIssues.reduce((acc, issue) => {
    if (issue.status === 'open') acc.open += 1;
    if (issue.status === 'in_progress') acc.inProgress += 1;
    if (issue.status === 'resolved') acc.resolved += 1;
    return acc;
  }, { open: 0, inProgress: 0, resolved: 0 });

  // Apply filters
  const filteredIssues = activeIssues.filter(issue => {
    const matchesCategory = filterCategory === 'all' || issue.category === filterCategory;
    
    let matchesStatus = true;
    if (filterStatus === 'all-active') {
      matchesStatus = issue.status === 'open' || issue.status === 'in_progress';
    } else if (filterStatus !== 'all') {
      matchesStatus = issue.status === filterStatus;
    }

    return matchesCategory && matchesStatus;
  });

  const handleSaveIssue = async (data) => {
    await addIssue(data);
    setShowAddModal(false);
  };

  const handleSaveIssueEdit = async (data) => {
    if (!editingIssue) return;
    await updateIssue(editingIssue.id, data);
    setEditingIssue(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Toast notifications */}
      {error && (
        <div className="status-msg error-msg" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="status-msg success-msg" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
          <CheckCircle2 size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* Summary KPI Widgets */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px'
      }}>
        {/* Open widget */}
        <div style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid var(--color-zinc-800)',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          borderLeft: '4px solid #f87171'
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-400)', fontWeight: 500 }}>Open</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-zinc-100)' }}>{counts.open}</span>
        </div>

        {/* In Progress widget */}
        <div style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid var(--color-zinc-800)',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          borderLeft: '4px solid #F1D7A7'
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-400)', fontWeight: 500 }}>In Progress</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-zinc-100)' }}>{counts.inProgress}</span>
        </div>

        {/* Resolved widget */}
        <div style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px solid var(--color-zinc-800)',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          borderLeft: '4px solid #34d399'
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-400)', fontWeight: 500 }}>Resolved</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-zinc-100)' }}>{counts.resolved}</span>
        </div>
      </div>

      {/* Action Controls & Filters */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {/* Left: Filters */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1, minWidth: '240px' }}>
          {/* Category Filter */}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              backgroundColor: 'var(--color-zinc-900)',
              border: '1px solid var(--color-zinc-800)',
              borderRadius: '8px',
              padding: '6px 10px',
              color: 'var(--color-zinc-200)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              appearance: 'auto',
              flex: 1
            }}
          >
            <option value="all">All Categories</option>
            {Object.keys(TRADE_SECTIONS_CONFIG).map(key => (
              <option key={key} value={key}>{TRADE_SECTIONS_CONFIG[key].label}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              backgroundColor: 'var(--color-zinc-900)',
              border: '1px solid var(--color-zinc-800)',
              borderRadius: '8px',
              padding: '6px 10px',
              color: 'var(--color-zinc-200)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              appearance: 'auto',
              flex: 1
            }}
          >
            <option value="all-active">Active Issues (Open/Progress)</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="all">Show All (Incl. Resolved)</option>
          </select>
        </div>

        {/* Right: Add Issue & Sync */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {googleToken && activeProject?.folderId && (
            <button
              onClick={triggerSync}
              disabled={syncing || loading}
              className="btn btn-secondary"
              style={{
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '34px',
                backgroundColor: 'var(--color-zinc-900)'
              }}
            >
              <RefreshCw size={14} className={syncing || loading ? 'spinner' : ''} />
              <span style={{ fontSize: '0.8rem' }}>Sync</span>
            </button>
          )}

          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
            style={{
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: '34px'
            }}
          >
            <Plus size={16} />
            <span style={{ fontSize: '0.8rem' }}>Add Issue</span>
          </button>
        </div>
      </div>

      {/* Issues List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <div className="spinner" />
        </div>
      ) : filteredIssues.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredIssues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              googleToken={googleToken}
              onUpdateStatus={updateIssueStatus}
              onDelete={softDeleteIssue}
              onEdit={setEditingIssue}
              onSendPacket={onSendIssuePacket}
              onMarkFixed={issuesState.markIssueFixed}
              onVerify={issuesState.verifyIssue}
              onReopen={issuesState.reopenIssue}
            />
          ))}
        </div>
      ) : (
        <div style={{
          backgroundColor: 'var(--color-zinc-900)',
          border: '1px dotted var(--color-zinc-800)',
          borderRadius: '12px',
          padding: '40px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          textAlign: 'center'
        }}>
          <AlertCircle size={24} style={{ color: 'var(--color-zinc-500)' }} />
          <h5 style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-zinc-300)' }}>No issues found</h5>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', maxWidth: '280px' }}>
            {filterCategory !== 'all' || filterStatus !== 'all-active' 
              ? 'No issues match your active filter settings.'
              : 'Everything looks good! Click "+ Add Issue" to log a problem.'}
          </p>
        </div>
      )}

      {/* Add Issue Form Modal */}
      {showAddModal && (
        <IssueFormModal
          issues={issues}
          contacts={issuesState.contacts || {}}
          subcontractors={subcontractors}
          projectInfo={projectInfo}
          projectName={activeProject?.name}
          selectedFolderName={selectedFolderName}
          googleToken={googleToken}
          onSave={handleSaveIssue}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {editingIssue && (
        <IssueFormModal
          issues={issues}
          contacts={issuesState.contacts || {}}
          subcontractors={subcontractors}
          editingIssue={editingIssue}
          projectInfo={projectInfo}
          projectName={activeProject?.name}
          selectedFolderName={selectedFolderName}
          googleToken={googleToken}
          onSave={handleSaveIssueEdit}
          onClose={() => setEditingIssue(null)}
        />
      )}
    </div>
  );
}
