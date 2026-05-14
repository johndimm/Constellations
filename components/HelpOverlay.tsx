"use client";
import React from 'react';
import { HelpCircle, X, Link as LinkIcon } from 'lucide-react';

interface HelpOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onHelpHoverChange?: (value: string | null) => void;
    onOpenPeopleBrowser?: () => void;
    isExtension?: boolean;
}

const HelpOverlay: React.FC<HelpOverlayProps> = ({
    isOpen,
    onClose,
    onHelpHoverChange = (_value: string | null) => { },
    onOpenPeopleBrowser,
    isExtension = false
}) => {
    if (!isOpen) return null;

    const handleHover = (val: string | null) => onHelpHoverChange(val);

    return (
        <div className={`fixed ${isExtension ? 'top-20 left-6 right-6' : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'} z-[10000] max-w-lg w-full bg-slate-900/98 backdrop-blur-xl p-6 rounded-2xl border border-slate-700 shadow-[0_32px_80px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[85vh]`}>
            <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <HelpCircle className="text-indigo-400" size={20} /> Help & Info
                </h3>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="space-y-6 text-sm text-slate-300">
                <section>
                    <p className="text-slate-200 leading-relaxed">
                        <strong>Constellations</strong> is an interactive graph for exploring lives, events, and their hidden connections.
                    </p>
                </section>

                {isExtension && (
                    <section className="bg-indigo-900/40 rounded-xl p-4 border border-indigo-500/30">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2">How to use</h4>
                        <p className="text-slate-300">
                            Select any text on a web page, right-click, and choose <strong className="text-white">Graph '&lt;selection&gt;' on Constellations</strong>.
                        </p>
                    </section>
                )}

                <section className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Controls</h4>
                    <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-xs leading-tight">
                        <span className="font-bold text-slate-100">Click</span>
                        <span className="text-slate-400">Select a node or connection</span>

                        <span className="font-bold text-slate-100">Dbl-Click</span>
                        <span className="text-slate-400">Open node context menu</span>

                        <span className="font-bold text-slate-100">Drag</span>
                        <span className="text-slate-400">Move nodes (Graph mode)</span>

                        <span className="font-bold text-slate-100">Scroll</span>
                        <span className="text-slate-400">Zoom in/out</span>

                        <span className="font-bold text-slate-100">Arrows</span>
                        <span className="text-slate-400">Move between timeline events</span>
                    </div>
                </section>

                {!isExtension && (
                    <section>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Features</h4>
                        <div className="space-y-2">
                            <p>
                                <strong>Browse People:</strong> Filter Wikipedia's database:{" "}
                                <button
                                    className="text-indigo-400 hover:text-indigo-300 font-semibold underline"
                                    onClick={(e) => { e.preventDefault(); if (onOpenPeopleBrowser) onOpenPeopleBrowser(); onClose(); }}
                                >
                                    Open Browser
                                </button>
                            </p>
                            <ul className="list-disc pl-5 space-y-1 text-slate-400">
                                <li><strong>Explore:</strong> Search and expand connections.</li>
                                <li><strong>Connect:</strong> Find paths between two entities.</li>
                            </ul>
                        </div>
                    </section>
                )}

                <section className="pt-4 border-t border-slate-800 space-y-3">
                    <a
                        href="/doc/journal.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
                    >
                        <LinkIcon size={14} className="text-slate-500" />
                        <span>Development Journal</span>
                    </a>
                    <a
                        href="/doc/prompt.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
                    >
                        <LinkIcon size={14} className="text-slate-500" />
                        <span>Regeneration Prompt</span>
                    </a>
                    <a
                        href="/doc/api_queries.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
                    >
                        <LinkIcon size={14} className="text-slate-500" />
                        <span>Example API queries</span>
                    </a>
                    <a
                        href="/paper/rendered/paper.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
                    >
                        <LinkIcon size={14} className="text-slate-500" />
                        <span>Technical Paper (PDF)</span>
                    </a>
                    <a
                        href="https://www.linkedin.com/in/johndimm/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-amber-500 hover:text-amber-400 transition-colors"
                    >
                        <LinkIcon size={14} />
                        <span>Follow John Dimm on LinkedIn</span>
                    </a>

                    {isExtension ? (
                        <a
                            href="https://constellations-delta.vercel.app"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            <LinkIcon size={14} />
                            <span>Visit Standalone Website</span>
                        </a>
                    ) : (
                        <a
                            href="https://chromewebstore.google.com/detail/nphipbpoephgjgapmeanccnaikljggkg"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            <LinkIcon size={14} />
                            <span>Install Chrome Extension</span>
                        </a>
                    )}
                </section>
            </div>
        </div>
    );
};

export default HelpOverlay;
