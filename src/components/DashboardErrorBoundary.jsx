import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Dashboard Error Boundary Caught Exception]:', error, errorInfo);
  }

  handleReset = () => {
    const errorMsg = String(this.state.error?.message || this.state.error || '').toLowerCase();
    if (
      errorMsg.includes('default') ||
      errorMsg.includes('chunk') ||
      errorMsg.includes('failed to fetch') ||
      errorMsg.includes('dynamically imported') ||
      errorMsg.includes('loading')
    ) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="settings-card" style={{
          border: '1px solid rgba(239, 68, 68, 0.3)',
          backgroundColor: 'rgba(239, 68, 68, 0.05)',
          padding: '24px',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          textAlign: 'center',
          margin: '20px 0'
        }}>
          <AlertCircle size={36} style={{ color: '#ef4444' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Dashboard Rendering Notice</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)', maxWidth: '420px', lineHeight: '1.4' }}>
            A temporary display error occurred while rendering dashboard metrics:
          </p>
          <div style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            padding: '8px 12px',
            borderRadius: '6px',
            color: '#f87171',
            wordBreak: 'break-all',
            maxHeight: '80px',
            overflowY: 'auto',
            width: '100%',
            maxWidth: '480px'
          }}>
            {String(this.state.error?.message || this.state.error || 'Unknown rendering error')}
          </div>
          <button
            onClick={this.handleReset}
            className="btn btn-primary"
            style={{ width: 'auto', marginTop: '6px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} /> Reload Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
