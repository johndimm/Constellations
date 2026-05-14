"use client";
import React from 'react';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import { GraphNode } from '../types';

interface AppHeaderProps {
    showHeader: boolean;
    panelCollapsed: boolean;
    setPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    selectedNode: GraphNode | null;
    sidebarCollapsed: boolean;
    setSidebarToggleSignal: React.Dispatch<React.SetStateAction<number>>;
    /** When set, shows a top-right control that leaves full-screen (e.g. back to player). */
    onClose?: () => void;
    /**
     * When set (e.g. `/` or `/player`), the close control is a real `href` link so navigation works
     * even if pointer-event layering blocked the old button. `onClick` can still run for cleanup.
     */
    closeHref?: string;
    /**
     * When the host app shows its own top bar (e.g. Trailer Vision nav, ~44px), set so this header
     * does not sit at viewport top:0 and steal clicks from the host nav. Use `top-11` for 2.75rem.
     */
    offsetTopClass?: string;
}

const AppHeader: React.FC<AppHeaderProps> = ({
    showHeader,
    panelCollapsed,
    setPanelCollapsed,
    selectedNode,
    sidebarCollapsed,
    setSidebarToggleSignal,
    onClose,
    closeHref,
    offsetTopClass = "top-0",
}) => {
    if (!showHeader) return null;

    const showLeave = closeHref || onClose;

    return (
        <header
            className={`absolute left-0 right-0 z-[200] h-14 max-h-14 min-h-14 shrink-0 pointer-events-auto bg-slate-900/95 backdrop-blur flex items-center justify-between px-2 sm:px-3 py-2 gap-2 overflow-x-hidden max-w-full ${offsetTopClass}`}
        >
            <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
                <button
                    type="button"
                    onClick={() => setPanelCollapsed(c => !c)}
                    className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                    title={
                        panelCollapsed
                            ? "Show left panel — search, save/load, graph options"
                            : "Hide left panel"
                    }
                    aria-label={panelCollapsed ? "Show control panel" : "Hide control panel"}
                >
                    {panelCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
                <span className="text-base sm:text-lg font-bold text-red-500 whitespace-nowrap">
                    Constellations
                </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 mr-1">
                {selectedNode && (
                    <button
                        type="button"
                        onClick={() => {
                            setSidebarToggleSignal((s) => s + 1);
                        }}
                        className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white transition flex-shrink-0"
                        title={
                            sidebarCollapsed
                                ? "Show right details (selected node on graph)"
                                : "Hide right details"
                        }
                        aria-label={sidebarCollapsed ? "Show details panel" : "Hide details panel"}
                    >
                        {sidebarCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                    </button>
                )}
                {showLeave && closeHref && (
                    <a
                        href={closeHref}
                        onClick={onClose}
                        className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-600 transition flex-shrink-0"
                        title="Return to the main app"
                        aria-label="Return to the main app"
                    >
                        <X size={20} strokeWidth={2} />
                    </a>
                )}
                {showLeave && !closeHref && onClose && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose();
                        }}
                        className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-800/80 border border-slate-700 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-600 transition flex-shrink-0"
                        title="Leave full screen and return to Trailer Vision"
                        aria-label="Close constellations"
                    >
                        <X size={20} strokeWidth={2} />
                    </button>
                )}
            </div>
        </header>
    );
};

export default AppHeader;
