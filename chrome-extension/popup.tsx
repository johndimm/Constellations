import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

const Popup = () => {
    const [query, setQuery] = useState('');

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        // Save query to storage
        // @ts-ignore
        await chrome.storage.local.set({
            pendingQuery: query.trim(),
            timestamp: Date.now()
        });

        // Open side panel in current window
        // @ts-ignore
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            // @ts-ignore
            await chrome.sidePanel.open({ tabId: tab.id });
            window.close(); // Close popup
        }
    };

    return (
        <div className="p-6 bg-gray-900 text-white h-full flex flex-col justify-center">
            <h1 className="text-2xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                Constellations
            </h1>
            <p className="text-sm text-gray-400 mb-6">
                Enter a topic to start exploring the knowledge graph.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col gap-3">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Oppenheimer, Tacos, ..."
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500"
                    autoFocus
                />
                <button
                    type="submit"
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                >
                    Explore
                </button>
            </form>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
