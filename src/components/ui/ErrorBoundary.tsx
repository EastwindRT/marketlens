import React from 'react';

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/commit errors so a single page crash can't blank the whole
 * app. Without this, a thrown error during render unmounts the entire tree
 * under the nearest Suspense boundary, which looks like a blank screen.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? 'route', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || String(this.state.error);
    return (
      <div
        style={{
          maxWidth: 480,
          margin: '60px auto 0',
          padding: '24px 20px',
          borderRadius: 14,
          background: 'var(--bg-surface)',
          border: '1px solid rgba(246,70,93,0.3)',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-down)', margin: 0 }}>
          Something went wrong loading this page.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, fontFamily: 'Roboto Mono, monospace' }}>
          {msg.slice(0, 220)}
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            borderRadius: 10,
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <button
          onClick={() => { window.location.href = '/'; }}
          style={{
            marginTop: 10,
            marginLeft: 8,
            padding: '8px 16px',
            borderRadius: 10,
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Go home
        </button>
      </div>
    );
  }
}
