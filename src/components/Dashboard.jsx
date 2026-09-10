import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, FileSpreadsheet, X } from 'lucide-react';
import { STATUS_MESSAGES, getDriveErrorMessage, getUploadErrorMessage, isAuthError } from '../services/appErrors';
import {
  getCachedDashboardSpreadsheetId,
  loadCachedDashboard,
  listDashboardPhasePhotos,
  loadProjectDashboardFromFolder,
  persistDashboardCache,
  persistDashboardSpreadsheetId,
  uploadDashboardPhasePhoto
} from '../services/dashboardDrive';
import DashboardContractorSearch from './DashboardContractorSearch';
import DashboardKpiCards from './DashboardKpiCards';
import DashboardPhotoReminders from './DashboardPhotoReminders';
import DashboardPhotoGallery from './DashboardPhotoGallery';
import DashboardTradeSections from './DashboardTradeSections';
import { auditSpreadsheetHealth } from '../services/spreadsheetHealth';

export default function Dashboard({ googleToken, activeProject, selectedFolder, onSessionExpired, onRequestConnect, onShowToast }) {
  const [data, setData] = useState(() => loadCachedDashboard(localStorage, activeProject?.id));
  const [isCached, setIsCached] = useState(() => Boolean(loadCachedDashboard(localStorage, activeProject?.id)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sheetWarnings, setSheetWarnings] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSub, setSelectedSub] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState({});

  // Inspection Photos & Reminders State
  const [activeGalleryPhase, setActiveGalleryPhase] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);

  const [dismissedReminders, setDismissedReminders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`jobscan_dismissed_reminders_${activeProject?.id}`) || '{}');
    } catch {
      return {};
    }
  });

  const [snoozedReminders, setSnoozedReminders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`jobscan_snoozed_reminders_${activeProject?.id}`) || '{}');
    } catch {
      return {};
    }
  });

  // Load photos lazily when active gallery phase opens
  useEffect(() => {
    const loadPhotos = async () => {
      if (!googleToken || !selectedFolder || !activeGalleryPhase) return;
      setLoadingPhotos(true);
      try {
        const list = await listDashboardPhasePhotos({
          accessToken: googleToken,
          projectFolderId: selectedFolder.id,
          phase: activeGalleryPhase
        });
        setPhotos(list);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingPhotos(false);
      }
    };
    loadPhotos();
  }, [activeGalleryPhase, googleToken, selectedFolder]);

  // Handle snapping/uploading a photo on-site
  const handlePhotoUpload = async (e, targetPhase = activeGalleryPhase) => {
    const file = e.target.files[0];
    if (!file || !targetPhase) return;

    setActiveGalleryPhase(targetPhase);

    setUploadingPhoto(true);
    try {
      const updatedList = await uploadDashboardPhasePhoto({
        accessToken: googleToken,
        projectFolderId: selectedFolder.id,
        phase: targetPhase,
        file
      });
      setPhotos(updatedList);
    } catch (err) {
      console.error(err);
      setError(getUploadErrorMessage(err, 'photo'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const dismissReminder = (phaseName) => {
    const updated = { ...dismissedReminders, [phaseName]: true };
    setDismissedReminders(updated);
    localStorage.setItem(`jobscan_dismissed_reminders_${activeProject?.id}`, JSON.stringify(updated));
  };

  const snoozeReminder = (phaseName) => {
    // Snooze for 24 hours
    const snoozeUntil = Date.now() + 24 * 60 * 60 * 1000;
    const updated = { ...snoozedReminders, [phaseName]: snoozeUntil };
    setSnoozedReminders(updated);
    localStorage.setItem(`jobscan_snoozed_reminders_${activeProject?.id}`, JSON.stringify(updated));
  };

  // Get active reminder candidates
  const getActiveReminders = () => {
    if (!data?.subcontractors || !Array.isArray(data.subcontractors)) return [];

    // Check if Drywall & Sheetrock is Complete or In Progress
    const drywallSub = data.subcontractors.find(sub => String(sub?.phase || '').toLowerCase().includes('drywall'));
    const isDrywallActive = drywallSub &&
      (String(drywallSub?.status || '').toLowerCase().includes('progress') || String(drywallSub?.status || '').toLowerCase().includes('complete') || String(drywallSub?.status || '').toLowerCase().includes('done'));

    return data.subcontractors.filter(sub => {
      if (!sub) return false;
      const status = String(sub.status || '').trim().toLowerCase();
      const isActive = status.includes('progress') || (status.includes('started') && !status.includes('not'));
      if (!isActive) return false;

      // If drywall is active/done, silence rough-ins
      const phaseName = String(sub.phase || '').toLowerCase();
      if (isDrywallActive) {
        const isRoughIn = phaseName.includes('plumbing') ||
          phaseName.includes('electrical') ||
          phaseName.includes('hvac') ||
          phaseName.includes('insulation') ||
          phaseName.includes('framing') ||
          phaseName.includes('foundation');
        if (isRoughIn) return false;
      }

      // Check if user dismissed it permanently
      if (sub.phase && dismissedReminders[sub.phase]) return false;

      // Check if user snoozed it (and 24 hrs hasn't passed)
      const snoozeUntil = sub.phase ? (snoozedReminders[sub.phase] || 0) : 0;
      if (Date.now() < snoozeUntil) return false;

      return true;
    });
  };

  const activeReminders = getActiveReminders();

  const getPhaseReminderTip = (phaseName) => {
    const name = phaseName.toLowerCase();
    if (name.includes('foundation')) {
      return 'Remember to capture photos of the rebar grids and plumbing sleeves before concrete is poured!';
    }
    if (name.includes('framing')) {
      return 'Take photos of studs, headers, and load-bearing columns before closing them up!';
    }
    if (name.includes('plumbing')) {
      return 'Snap photos of PEX runs, drainage slopes, and supply lines behind the walls!';
    }
    if (name.includes('electrical')) {
      return 'Photograph junction boxes, conduit routes, and panel layouts before drywall hides them!';
    }
    if (name.includes('hvac')) {
      return 'Document duct paths, line sets, and boot locations for future reference!';
    }
    if (name.includes('insulation')) {
      return 'Verify and document full insulation coverage behind batts or spray foam!';
    }
    if (name.includes('tile')) {
      return 'Take pictures of water-proofing pans and mud beds before laying tile!';
    }
    return `Ensure structural, layout, or utility work is fully photographed for reference!`;
  };

  // Fetch dashboard data
  const loadDashboardData = async (forceInteractive = false) => {
    const cached = loadCachedDashboard(localStorage, activeProject?.id);

    if (!googleToken) {
      if (cached) {
        setData(cached);
        setIsCached(true);
        setError(null);
      } else {
        setError('Please connect your Google account in Settings to load the dashboard.');
      }
      if (forceInteractive && onRequestConnect) {
        onRequestConnect({ interactive: true });
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const cachedSpreadsheetId = getCachedDashboardSpreadsheetId(localStorage, activeProject?.id);
      const { spreadsheetId, data: parsedData } = await loadProjectDashboardFromFolder({
        accessToken: googleToken,
        projectFolderId: selectedFolder.id,
        cachedSpreadsheetId
      });
      if (spreadsheetId !== cachedSpreadsheetId) {
        persistDashboardSpreadsheetId(localStorage, activeProject.id, spreadsheetId);
      }
      setData(parsedData);
      setIsCached(false);
      const healthAudit = auditSpreadsheetHealth(parsedData);
      setSheetWarnings(healthAudit.warnings);

      // Cache values for offline usage
      persistDashboardCache(localStorage, activeProject.id, parsedData);

    } catch (err) {
      console.error(err);
      if (isAuthError(err)) {
        if (cached) {
          setData(cached);
          setIsCached(true);
          setError(null);
        }
        if (forceInteractive && onRequestConnect) {
          onRequestConnect({ interactive: true });
        } else if (onSessionExpired) {
          onSessionExpired({ interactive: false });
        }
        return;
      }
      
      const rawError = getDriveErrorMessage(err, 'load dashboard data');
      const isMissingSpreadsheet = String(err?.message || '').toLowerCase().includes('no spreadsheet found');
      const isFailedFetch = String(err?.message || '').toLowerCase().includes('failed to fetch');

      let customError;
      if (isMissingSpreadsheet) {
        customError = `No financial spreadsheet found in Google Drive folder for "${activeProject?.name || 'this project'}".`;
      } else if (isFailedFetch) {
        customError = 'Unable to connect to live Google Sheet (session may have expired or signal is offline).';
      } else {
        customError = rawError;
      }

      // If user deliberately clicked Refresh and it failed to fetch, prompt to renew token
      if (forceInteractive && isFailedFetch && onRequestConnect) {
        onRequestConnect({ interactive: true });
      }

      // Try to load cached data offline
      if (cached) {
        setData(cached);
        setIsCached(true);
        setError(`Showing saved snapshot: ${customError}`);
      } else {
        setData(null);
        setError(customError);
      }
    } finally {
      setLoading(false);
    }
  };

  // Load on mount or active project change
  useEffect(() => {
    const cached = loadCachedDashboard(localStorage, activeProject?.id);
    if (cached) {
      setData(cached);
      setIsCached(true);
    } else {
      setData(null);
      setIsCached(false);
    }
    setError(null);
    setSheetWarnings([]);
    setSelectedSub(null);

    if (activeProject && selectedFolder) {
      loadDashboardData();
    } else if (activeProject && !selectedFolder) {
      setError(`No Google Drive folder linked to project "${activeProject.name}". Go to Settings to link a Drive folder.`);
    } else {
      setError('Please select an active project in Settings to load the dashboard.');
    }
  }, [activeProject?.id, selectedFolder?.id, googleToken]);

  // Autocomplete suggestions for contractor search
  const suggestions = (data?.subcontractors && Array.isArray(data.subcontractors))
    ? data.subcontractors.filter(sub => {
      if (!sub) return false;
      const query = String(searchTerm || '').toLowerCase();
      const payee = String(sub.payee || '').toLowerCase();
      const phase = String(sub.phase || '').toLowerCase();
      const category = String(sub.category || '').toLowerCase();
      return (
        payee.includes(query) ||
        phase.includes(query) ||
        category.includes(query)
      );
    })
    : [];

  const toggleCategory = (catName) => {
    setExpandedCategories(prev => ({
      ...prev,
      [catName]: !prev[catName]
    }));
  };

  const selectSubcontractor = (sub) => {
    setSelectedSub(sub);
    setSearchTerm('');
    // Smooth scroll the lookup box directly to the top edge of the viewport
    setTimeout(() => {
      const el = document.getElementById('contractor-lookup-container');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 80);
  };

  // Status badge styling
  const getStatusStyle = (status) => {
    const clean = String(status || '').trim().toLowerCase();
    if (clean.includes('complete') || clean.includes('done')) {
      return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' };
    }
    if (clean.includes('progress') || (clean.includes('started') && !clean.includes('not'))) {
      return { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' };
    }
    return { bg: 'rgba(113, 113, 122, 0.15)', text: '#a1a1aa', border: 'rgba(113, 113, 122, 0.3)' };
  };

  // Helper to format currency values safely
  const formatCurrency = (val) => {
    if (typeof val === 'number') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    }
    // If it's already a formatted string, return as-is
    if (String(val).startsWith('$')) return val;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  };

  if (!activeProject) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-zinc-400)' }}>
        <div className="settings-card" style={{ border: '1px solid var(--color-zinc-800)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AlertCircle size={32} style={{ color: 'var(--color-amber-500)', margin: '0 auto' }} />
          <h3 style={{ fontWeight: 700, color: '#fff' }}>No Project Selected</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-zinc-500)', lineHeight: '1.4' }}>
            Go to Settings and create or select an active project profile linked to a Google Drive folder to load your spreadsheet financial data.
          </p>
        </div>
      </div>
    );
  }

  if (!data && !googleToken) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-zinc-400)' }}>
        <div className="settings-card" style={{ border: '1px solid var(--color-zinc-800)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AlertCircle size={32} style={{ color: 'var(--color-amber-500)', margin: '0 auto' }} />
          <h3 style={{ fontWeight: 700, color: '#fff' }}>Google Drive Connection Required</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-zinc-500)', lineHeight: '1.4' }}>
            The dashboard reads financial data directly from your Google spreadsheet in real-time. Connect your Google account to view this page.
          </p>
          <button
            onClick={() => onRequestConnect?.({ interactive: true })}
            className="btn btn-primary"
            style={{ width: 'auto', margin: '6px auto 0', padding: '8px 16px', fontSize: '0.85rem' }}
          >
            Connect Google Drive
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff' }}>Financial Dashboard</h2>
            {isCached && (
              <span style={{ 
                fontSize: '0.7rem', 
                padding: '2px 8px', 
                borderRadius: '12px', 
                backgroundColor: 'rgba(245, 158, 11, 0.12)', 
                color: 'var(--color-amber-400)', 
                border: '1px solid rgba(245, 158, 11, 0.25)',
                fontWeight: 600
              }}>
                Saved Snapshot
              </span>
            )}
          </div>
          {data?.projectInfo?.address && (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-zinc-500)', marginTop: '2px' }}>
              {data.projectInfo.address.toLowerCase().startsWith('n/a')
                ? data.projectInfo.cityStateZip || ''
                : `${data.projectInfo.address}${data.projectInfo.cityStateZip ? `, ${data.projectInfo.cityStateZip}` : ''}`}
            </p>
          )}
        </div>
        <button
          onClick={() => loadDashboardData(true)}
          className="btn btn-secondary"
          style={{ width: 'auto', padding: '6px 10px', height: '32px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          {loading ? STATUS_MESSAGES.refreshing : STATUS_MESSAGES.refresh}
        </button>
      </div>

      {error && !data && (
        <div className="settings-card" style={{
          border: '1px solid rgba(245, 158, 11, 0.35)',
          backgroundColor: 'rgba(245, 158, 11, 0.04)',
          padding: '24px 18px',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          textAlign: 'center',
          margin: '12px 0'
        }}>
          <div style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            color: 'var(--color-amber-500)',
            padding: '12px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FileSpreadsheet size={28} />
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff' }}>No Spreadsheet Found in Drive Folder</h3>
          <p style={{ fontSize: '0.84rem', color: 'var(--color-zinc-300)', maxWidth: '440px', lineHeight: '1.5', margin: 0 }}>
            The Google Drive folder for <strong style={{ color: 'var(--color-amber-400)' }}>"{activeProject?.name || 'this project'}"</strong> does not contain a tracking spreadsheet.
          </p>
          <div style={{
            fontSize: '0.78rem',
            color: 'var(--color-zinc-300)',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            padding: '12px 14px',
            maxWidth: '460px',
            textAlign: 'left',
            marginTop: '4px',
            lineHeight: '1.4'
          }}>
            💡 <strong>How to fix:</strong> Move or copy your project expense spreadsheet into this project's Google Drive folder, then click <strong>Refresh</strong> above.
          </div>
        </div>
      )}

      {error && data && (
        <div
          style={{
            backgroundColor: 'rgba(24, 24, 27, 0.95)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '10px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '0.8rem',
            color: 'var(--color-zinc-300)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <AlertCircle size={15} style={{ color: 'var(--color-amber-400)', flexShrink: 0 }} />
            <span style={{ lineHeight: 1.4 }}>
              {error}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {onRequestConnect && (
              <button
                type="button"
                onClick={() => onRequestConnect({ interactive: true })}
                className="btn btn-secondary"
                style={{
                  width: 'auto',
                  padding: '4px 10px',
                  fontSize: '0.72rem',
                  height: '28px',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: 'var(--color-amber-400)',
                  backgroundColor: 'rgba(245, 158, 11, 0.08)',
                  whiteSpace: 'nowrap'
                }}
              >
                Reconnect Drive
              </button>
            )}
            <button
              type="button"
              onClick={() => setError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-zinc-400)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px'
              }}
              title="Dismiss alert"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {sheetWarnings.length > 0 && (
        <div style={{
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '10px',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-amber-400)', fontWeight: 700, fontSize: '0.82rem' }}>
            <AlertCircle size={16} />
            <span>Google Sheet Structure Audit Notice</span>
          </div>
          {sheetWarnings.map((warn, i) => (
            <p key={i} style={{ fontSize: '0.74rem', color: 'var(--color-zinc-300)', margin: 0, lineHeight: '1.4' }}>
              • {warn}
            </p>
          ))}
        </div>
      )}

      {/* Loading Placeholder */}
      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '40px 0', alignItems: 'center' }}>
          <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-zinc-500)' }}>{STATUS_MESSAGES.loadingDashboard}</span>
        </div>
      )}

      {data && (
        <>
          <DashboardKpiCards
            projectInfo={data?.projectInfo || {}}
            formatCurrency={formatCurrency}
          />

          <DashboardPhotoReminders
            reminders={activeReminders}
            getPhaseReminderTip={getPhaseReminderTip}
            onSnoozeReminder={snoozeReminder}
            onDismissReminder={dismissReminder}
            onPhotoUpload={handlePhotoUpload}
          />

          <DashboardContractorSearch
            searchTerm={searchTerm}
            suggestions={suggestions}
            selectedSub={selectedSub}
            formatCurrency={formatCurrency}
            getStatusStyle={getStatusStyle}
            onSearchTermChange={(value) => {
              setSearchTerm(value);
              setSelectedSub(null);
            }}
            onSelectSubcontractor={selectSubcontractor}
            onClearSelection={() => setSelectedSub(null)}
            onViewPhasePhotos={setActiveGalleryPhase}
            onShowToast={onShowToast}
          />

          {/* Trade Phase Categories Accordion List */}
          <DashboardTradeSections
            categories={data?.categories || []}
            subcontractors={data?.subcontractors || []}
            expandedCategories={expandedCategories}
            onToggleCategory={toggleCategory}
            onSelectSubcontractor={selectSubcontractor}
            formatCurrency={formatCurrency}
          />
        </>
      )}
      <DashboardPhotoGallery
        activeGalleryPhase={activeGalleryPhase}
        photos={photos}
        loadingPhotos={loadingPhotos}
        uploadingPhoto={uploadingPhoto}
        fullscreenPhoto={fullscreenPhoto}
        onCloseGallery={() => setActiveGalleryPhase(null)}
        onPhotoUpload={handlePhotoUpload}
        onOpenPhoto={setFullscreenPhoto}
        onClosePhoto={() => setFullscreenPhoto(null)}
        getPhaseReminderTip={getPhaseReminderTip}
      />
    </div>
  );
}
