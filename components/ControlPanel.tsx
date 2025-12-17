import React, { useState, useEffect } from 'react';
import { Search, Github, HelpCircle, Minimize2, Maximize2, AlertCircle, Scissors, Calendar, Network, X, Link as LinkIcon, ArrowRight, Type, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

interface ControlPanelProps {
  searchMode: 'explore' | 'connect';
  setSearchMode: (mode: 'explore' | 'connect') => void;
  exploreTerm: string;
  setExploreTerm: (term: string) => void;
  pathStart: string;
  setPathStart: (term: string) => void;
  pathEnd: string;
  setPathEnd: (term: string) => void;

  onSearch: (term: string) => void;
  onPathSearch: (start: string, end: string) => void;
  onClear: () => void;
  isProcessing: boolean;
  isCompact: boolean;
  onToggleCompact: () => void;
  isTimelineMode: boolean;
  onToggleTimeline: () => void;
  isTextOnly: boolean;
  onToggleTextOnly: () => void;
  onPrune?: () => void;
  error?: string | null;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  searchMode,
  setSearchMode,
  exploreTerm,
  setExploreTerm,
  pathStart,
  setPathStart,
  pathEnd,
  setPathEnd,

  onSearch, 
  onPathSearch,
  onClear,
  isProcessing,
  isCompact,
  onToggleCompact,
  isTimelineMode,
  onToggleTimeline,
  isTextOnly,
  onToggleTextOnly,
  onPrune,
  error
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchMode === 'explore') {
        if (exploreTerm.trim()) {
            onSearch(exploreTerm.trim());
            setHasStarted(true);
            if (window.innerWidth < 768) setIsCollapsed(true);
        }
    } else {
        if (pathStart.trim() && pathEnd.trim()) {
            onPathSearch(pathStart.trim(), pathEnd.trim());
            setHasStarted(true);
            if (window.innerWidth < 768) setIsCollapsed(true);
        }
    }
  };

  const EXAMPLES = [
    "The Godfather",
    "Watergate Scandal",
    "Zodiac Killer",
    "The Manhattan Project"
  ];

  return (
    <div 
      className={`absolute top-4 left-4 z-40 flex flex-col gap-2 transition-transform duration-300 ease-in-out pointer-events-none ${
        isCollapsed ? '-translate-x-[calc(100%+1rem)]' : 'translate-x-0'
      } w-[calc(100vw-3rem)] max-w-[28rem]`}
    >
      <div className="bg-slate-900/95 backdrop-blur-xl p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto relative">
        {/* Toggle Handle */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-12 top-0 w-10 h-10 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors shadow-xl"
          title={isCollapsed ? "Expand Search" : "Collapse Search"}
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>

        <div className="flex items-center justify-between mb-4 gap-2">
          <h1 className="text-xl font-bold text-red-500 whitespace-nowrap overflow-visible flex-shrink-0">
            Constellations
          </h1>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button 
                onClick={onToggleTimeline}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all border shrink-0 ${
                  isTimelineMode 
                    ? 'bg-amber-500 text-slate-900 border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400' 
                    : 'bg-slate-800 text-slate-300 border-slate-600 hover:border-amber-400 hover:text-amber-400'
                }`}
            >
                {isTimelineMode ? <Network size={14} /> : <Calendar size={14} />}
            </button>

            <div className="h-5 w-px bg-slate-700 shrink-0"></div>

            <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={onToggleTextOnly} className={`p-1.5 ${isTextOnly ? 'text-indigo-400' : 'text-slate-400 hover:text-white'}`}>
                    <Type size={16} />
                </button>
                <button onClick={onToggleCompact} className="text-slate-400 hover:text-white p-1.5">
                    {isCompact ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                </button>
                <button onClick={onClear} className="text-slate-400 hover:text-red-400 p-1.5">
                    <Trash2 size={16} />
                </button>
                <button onClick={() => setShowHelp(!showHelp)} className="text-slate-400 hover:text-white p-1.5">
                    <HelpCircle size={16} />
                </button>
            </div>
          </div>
        </div>

        <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
            <div className="flex border-b border-slate-700 mb-4">
                <button onClick={() => setSearchMode('explore')} className={`flex-1 pb-2 text-sm font-medium transition-colors ${searchMode === 'explore' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-400 hover:text-slate-200'}`}>
                    <Search size={14} className="inline mr-1.5 mb-0.5" /> Explore
                </button>
                <button onClick={() => setSearchMode('connect')} className={`flex-1 pb-2 text-sm font-medium transition-colors ${searchMode === 'connect' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-400 hover:text-slate-200'}`}>
                    <LinkIcon size={14} className="inline mr-1.5 mb-0.5" /> Connect
                </button>
            </div>

            <form onSubmit={handleSubmit} className="relative mb-4 space-y-3">
              {searchMode === 'explore' ? (
                  <div className="relative">
                    <input type="text" value={exploreTerm} onChange={(e) => setExploreTerm(e.target.value)} placeholder="Enter an event..." className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-10 py-3 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" disabled={isProcessing} />
                    <Search className="absolute left-3 top-3.5 text-slate-400" size={16} />
                  </div>
              ) : (
                  <div className="flex flex-col gap-2">
                      <input type="text" value={pathStart} onChange={(e) => setPathStart(e.target.value)} placeholder="Start Person/Event..." className="w-full bg-slate-800 border border-slate-600 text-white px-4 py-2.5 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" disabled={isProcessing} />
                      <div className="flex justify-center -my-2"><ArrowRight size={14} className="text-slate-500" /></div>
                      <input type="text" value={pathEnd} onChange={(e) => setPathEnd(e.target.value)} placeholder="End Person/Event..." className="w-full bg-slate-800 border border-slate-600 text-white px-4 py-2.5 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" disabled={isProcessing} />
                  </div>
              )}
              
              <div className="flex justify-end">
                  <button type="submit" disabled={isProcessing} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isProcessing ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                    {isProcessing ? 'Processing...' : (searchMode === 'explore' ? 'Explore' : 'Connect')}
                  </button>
              </div>
            </form>

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            {searchMode === 'explore' && (!hasStarted || isHovered) && (
                <div className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map(ex => (
                        <button key={ex} onClick={() => { setExploreTerm(ex); onSearch(ex); setHasStarted(true); if (window.innerWidth < 768) setIsCollapsed(true); }} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-full border border-slate-700 transition-colors">
                            {ex}
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;