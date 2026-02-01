import React from 'react';
import { ChevronRight, ChevronLeft, Key } from 'lucide-react';
import { GraphNode } from '../types';

interface AppHeaderProps {
    showHeader: boolean;
    panelCollapsed: boolean;
    setPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    showBrowse: boolean;
    handleOpenPeopleBrowser: () => void;
    selectedNode: GraphNode | null;
    sidebarCollapsed: boolean;
    setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    setSidebarToggleSignal: React.Dispatch<React.SetStateAction<number>>;
    onReset: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
    showHeader,
    panelCollapsed,
    setPanelCollapsed,
    showBrowse,
    handleOpenPeopleBrowser,
    selectedNode,
    sidebarCollapsed,
    setSidebarCollapsed,
    setSidebarToggleSignal,
    onReset
}) => {
    if (!showHeader) return null;

    return (
        <header className="fixed top-0 left-0 right-0 z-50 min-h-14 bg-slate-900/95 backdrop-blur border-b border-slate-800 flex items-center justify-between px-2 sm:px-3 py-2 gap-2 overflow-x-hidden max-w-full">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <button
                    onClick={() => setPanelCollapsed(c => !c)}
                    className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                    title={panelCollapsed ? "Show controls" : "Hide controls"}
                >
                    {panelCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        window.location.href = window.location.origin + window.location.pathname;
                    }}
                    className="text-base sm:text-lg font-bold text-red-500 whitespace-nowrap hover:text-red-400 transition-colors"
                >
                    Constellations
                </button>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0 mr-2">
                <button
                    onClick={handleOpenPeopleBrowser}
                    className={`text-sm font-bold uppercase tracking-widest transition-colors ${showBrowse ? 'text-red-500' : 'text-slate-400 hover:text-white'}`}
                >
                    People
                </button>
                {selectedNode && (
                    <button
                        onClick={() => { setSidebarCollapsed(c => !c); setSidebarToggleSignal(s => s + 1); }}
                        className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                        title="Toggle details"
                    >
                        {sidebarCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                    </button>
                )}
            </div>
        </header>
    );
};

export default AppHeader;
