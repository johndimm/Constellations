import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { GraphLink, GraphNode } from '../types';
import '../index.css';

const EvidencePopup = ({ link, onClose }: { link: GraphLink | null; onClose: () => void }) => {
    if (!link) return null;
    const evidence = link.evidence;
    const snippet = evidence?.snippet || '';
    const pageTitle = evidence?.pageTitle || '';
    const url = evidence?.url || '';
    return (
        <div
            style={{
                position: 'fixed',
                left: '16px',
                bottom: '16px',
                zIndex: 999995,
                width: '320px',
                maxWidth: 'calc(100vw - 32px)',
                background: 'rgba(15, 23, 42, 0.98)',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '12px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.4)'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '11px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#94a3b8' }}>
                    Evidence
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#cbd5f5',
                        fontSize: '16px',
                        cursor: 'pointer'
                    }}
                    aria-label="Close evidence"
                >
                    ×
                </button>
            </div>
            {link.label && (
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                    {link.label}
                </div>
            )}
            {pageTitle && (
                <div style={{ fontSize: '12px', color: '#cbd5f5', marginBottom: '6px' }}>
                    From: {pageTitle}
                </div>
            )}
            {snippet ? (
                <div style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    “{snippet}”
                </div>
            ) : (
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>
                    No evidence snippet available for this edge yet.
                </div>
            )}
            {url && (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: '8px', fontSize: '12px', color: '#fbbf24' }}
                >
                    View Source
                </a>
            )}
        </div>
    );
};

const openWikiInActiveTab = (title?: string | null) => {
    if (!title) return;
    const safe = title.replace(/ /g, '_');
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safe)}`;
    // @ts-ignore
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs.length ? tabs[0] : null;
        if (!tab?.id) return;
        // @ts-ignore
        chrome.tabs.update(tab.id, { url });
    });
};

const SidePanelApp = () => {
    const [externalSearch, setExternalSearch] = useState<{ term: string; id: number } | null>(null);

    useEffect(() => {
        const loadQuery = async () => {
            // @ts-ignore
            const data = await chrome.storage.local.get(['pendingQuery', 'timestamp']);
            if (data.pendingQuery) {
                setExternalSearch({ term: data.pendingQuery, id: Date.now() });
                // @ts-ignore
                chrome.storage.local.remove(['pendingQuery', 'timestamp']);
            }
        };
        loadQuery();

        // @ts-ignore
        const listener = (changes, area) => {
            if (area === 'local' && changes.pendingQuery?.newValue) {
                setExternalSearch({ term: changes.pendingQuery.newValue, id: Date.now() });
            }
        };
        // @ts-ignore
        chrome.storage.onChanged.addListener(listener);
        // @ts-ignore
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    return (
        <App
            mode="extension"
            hideHeader={true}
            hideControlPanel={true}
            hideSidebar={true}
            externalSearch={externalSearch}
            onExternalSearchConsumed={(id) => {
                setExternalSearch(prev => (prev?.id === id ? null : prev));
            }}
            onNodeNavigate={(node: GraphNode) => openWikiInActiveTab(node.title)}
            renderEvidencePopup={(link, onClose) => (
                <EvidencePopup link={link} onClose={onClose} />
            )}
        />
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<SidePanelApp />);
