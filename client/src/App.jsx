import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ImportPage from './pages/ImportPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import LedgerPage from './pages/LedgerPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { ToastProvider } from './components/Toast.jsx';

const TABS = [
  ['import', 'Import'],
  ['review', 'Review'],
  ['ledger', 'Ledger'],
  ['settings', 'Settings'],
];

export default function App() {
  const [tab, setTab] = useState('import');
  const [meta, setMeta] = useState(null);
  const [batchId, setBatchId] = useState(null);

  const reloadMeta = useCallback(() => api.get('/api/meta').then(setMeta), []);
  useEffect(() => {
    reloadMeta();
  }, [reloadMeta]);

  const openBatch = (id) => {
    setBatchId(id);
    setTab('review');
  };

  return (
    <ToastProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">₹</span> Finello
          </div>
          <nav className="tabs">
            {TABS.map(([key, label]) => (
              <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
        </header>
        <main className="content">
          {!meta ? (
            <p className="muted">Connecting to the Finello server…</p>
          ) : tab === 'import' ? (
            <ImportPage onOpenBatch={openBatch} />
          ) : tab === 'review' ? (
            <ReviewPage
              batchId={batchId}
              meta={meta}
              reloadMeta={reloadMeta}
              onPickBatch={openBatch}
              onDone={() => {
                setBatchId(null);
                setTab('ledger');
              }}
            />
          ) : tab === 'ledger' ? (
            <LedgerPage meta={meta} reloadMeta={reloadMeta} />
          ) : (
            <SettingsPage meta={meta} reloadMeta={reloadMeta} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
