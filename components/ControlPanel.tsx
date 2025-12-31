import React, { useState, useEffect } from 'react';
import { Search, Github, HelpCircle, Minimize2, Maximize2, Maximize, Plus, AlertCircle, Scissors, Calendar, Network, X, Link as LinkIcon, ArrowRight, Type, Trash2, ChevronLeft, ChevronRight, Download, Upload, Share2, Copy } from 'lucide-react';

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
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  onDeleteGraph: (name: string) => void;
  onImport: (data: any) => void; // New prop for importing
  savedGraphs: string[];
  helpHover: string | null;
  onHelpHoverChange: (value: string | null) => void;
  isCollapsed: boolean;
  onSetCollapsed: (val: boolean) => void;
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
  error,
  onSave,
  onLoad,
  onDeleteGraph,
  onImport,
  savedGraphs,
  helpHover,
  onHelpHoverChange,
  isCollapsed,
  onSetCollapsed
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Save/Load/Share State
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [saveName, setSaveName] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchMode === 'explore') {
      if (exploreTerm.trim()) {
        onSearch(exploreTerm.trim());
        setHasStarted(true);
        if (window.innerWidth < 768) onSetCollapsed(true);
      }
    } else {
      if (pathStart.trim() && pathEnd.trim()) {
        onPathSearch(pathStart.trim(), pathEnd.trim());
        setHasStarted(true);
        if (window.innerWidth < 768) onSetCollapsed(true);
      }
    }
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveName.trim()) {
      onSave(saveName.trim());
      setSaveName('');
      setShowSave(false);
    }
  };

  const handleExport = () => {
    // We need the current graph data. Ideally passed down, but we can grab from what we know or ask parent.
    // Actually, onSave usually saves *current* state. 
    // To export, we probably need access to the current `nodes` and `links` or a way to get them.
    // BUT we don't have them in props here.
    // Solution: Let the PARENT handle the export triggered by a callback, OR pass the data down.
    // Adding `onExport` prop is safer. 
    // Wait, the prompt says "Export as JSON and send it". 
    // I can modify `onSave` to optionally accept an "export" flag? Or just add `onExport` prop.
    // Let's add `onExportRequest` prop to `ControlPanel` and implement it in `App`.

    // Changing approach slightly: I will add `onExport` to props in the NEXT step (App.tsx updates),
    // but for now I will structure this file to expect it.
    // Actually I can keep local logic if I pass the data down? No, passing all nodes/links to ControlPanel causes rerenders.
    // Best: `onExport` callback.
  };

  // Re-thinking export: User clicks "Export", App.tsx gathers data and downloads it.
  // So I need an `onExport` prop. I will add it to the interface above in a sec (or assume it exists and fix App later).
  // Actually, I can fix the interface now.

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Basic validation
        if (json.nodes && json.links) {
          onImport(json);
          setShowLoad(false);
        } else {
          alert("Invalid graph JSON");
        }
      } catch (err) {
        console.error(err);
        alert("Failed to parse JSON");
      }
    };
    reader.readAsText(file);
  };

  const EXAMPLES = [
    "The Godfather",
    "Watergate Scandal",
    "Giant Steps",
    "Napoleon Bonaparte"
  ];

  // Header actions portal removed; all actions live in the control panel for mobile space
  const headerActions = null;

  return (
    <>
      {headerActions}
      <div
        className={`absolute left-0 right-0 mx-auto z-40 flex flex-col gap-2 transition-transform duration-300 ease-in-out pointer-events-none ${isCollapsed ? '-translate-x-[calc(100%+1rem)]' : 'translate-x-0'} top-16`}
        style={{ width: 'calc(100% - 1.5rem)', maxWidth: '34rem' }}
      >
        <div className="bg-slate-900/95 backdrop-blur-xl p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto relative">
          {/* Primary actions (panel-local) */}
          <div className="flex flex-wrap gap-2 mb-2 text-xs">
            <button
              onClick={() => {
                let defaultName = "";
                if (searchMode === 'explore' && exploreTerm) {
                  defaultName = exploreTerm;
                } else if (searchMode === 'connect' && pathStart && pathEnd) {
                  defaultName = `${pathStart} to ${pathEnd}`;
                } else {
                  defaultName = `Graph ${new Date().toLocaleTimeString()}`;
                }
                setSaveName(defaultName);
                setShowSave(true);
                setShowLoad(false);
                setShowShare(false);
                setShowHelp(false);
                onHelpHoverChange(null);
              }}
              className={`px-3 py-1 rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-amber-300 ${helpHover === 'save' ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900' : ''}`}
              title="Save Graph"
            >
              SAVE
            </button>
            <button
              onClick={() => {
                setShowLoad(true);
                setShowSave(false);
                setShowShare(false);
                setShowHelp(false);
              }}
              className={`px-3 py-1 rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-amber-300 ${helpHover === 'load' ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900' : ''}`}
              title="Load Graph"
            >
              LOAD
            </button>
            <button
              onClick={() => {
                setShowShare(!showShare);
                setShowSave(false);
                setShowLoad(false);
                setShowHelp(false);
                onHelpHoverChange(null);
              }}
              className={`px-3 py-1 rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-amber-300 ${helpHover === 'share' ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900' : ''}`}
              title="Share Graph"
            >
              SHARE
            </button>
            <button
              onClick={onClear}
              className={`px-3 py-1 rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-red-300 flex items-center gap-1`}
              title="Clear Graph"
            >
              <Trash2 size={14} /> CLEAR
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <button
              onClick={onToggleTimeline}
              className={`flex items-center gap-1 px-2 py-1 rounded-md uppercase tracking-wider transition-all border shrink-0 ${isTimelineMode
                ? 'bg-amber-500 text-slate-900 border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-300 border-slate-600 hover:border-amber-400 hover:text-amber-400'
                }`}
              title="Toggle Timeline/Network View"
            >
              {isTimelineMode ? <Network size={14} /> : <Calendar size={14} />}
            </button>
            <button
              onClick={onToggleCompact}
              className="text-slate-300 hover:text-white p-1.5 rounded-md border border-slate-700 bg-slate-800/80"
              title="Toggle Compact Mode"
            >
              {isCompact ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
            <button
              onClick={onToggleTextOnly}
              className={`p-1.5 rounded-md border border-slate-700 bg-slate-800/80 ${isTextOnly ? 'text-indigo-400' : 'text-slate-300 hover:text-white'}`}
              title="Toggle Text-Only Mode"
            >
              <Type size={16} />
            </button>
            <button
              onClick={() => {
                setShowHelp(!showHelp);
                setShowSave(false);
                setShowLoad(false);
                setShowShare(false);
              }}
              className={`px-3 py-1 rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:text-white flex items-center gap-1 ${helpHover === 'help' ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900' : ''}`}
              title="Help & Info"
            >
              <HelpCircle size={14} /> HELP
            </button>
          </div>

          {/* Help Dialog */}
          {showHelp && (
            <div className="mb-4 bg-slate-800 p-4 rounded-lg border border-slate-600 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[60vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <HelpCircle size={14} /> Help & Info
                </h3>
                <button onClick={() => { setShowHelp(false); onHelpHoverChange(null); }}><X size={14} className="text-slate-400" /></button>
              </div>
              <div className="space-y-3 text-xs text-slate-300">
                <p className="text-sm text-white">
                  <strong>New here?</strong> Start fast with a ready-made graph:{" "}
                  <a className="text-slate-200 hover:text-white font-semibold" href="/graphs/index.html">/graphs/index.html</a>
                </p>
                <div className="grid gap-2 text-xs text-slate-200">
                  <div className="bg-slate-700/40 rounded-lg p-2 border border-slate-700">
                    <div className="font-semibold text-white mb-1">Toolbar (top left)</div>
                    <div className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-[11px] leading-tight">
                      <span
                        onMouseEnter={() => onHelpHoverChange('save')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Save</strong>
                      </span>
                      <span className="text-slate-300">Store the current graph locally</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('load')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Load</strong>
                      </span>
                      <span className="text-slate-300">Open a previously saved graph</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('share')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Share</strong>
                      </span>
                      <span className="text-slate-300">Copy link/JSON or download</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('timeline')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Timeline</strong>
                      </span>
                      <span className="text-slate-300">Switch to time view</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('compact')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Compact</strong>
                      </span>
                      <span className="text-slate-300">Tighter layout</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('text')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Text-only</strong>
                      </span>
                      <span className="text-slate-300">Hide images</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('clear')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Clear</strong>
                      </span>
                      <span className="text-slate-300">Remove all nodes</span>
                    </div>
                  </div>
                  <div className="bg-slate-700/40 rounded-lg p-2 border border-slate-700">
                    <div className="font-semibold text-white mb-1">Sidebar (top right, when a node is selected)</div>
                    <div className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-[11px] leading-tight">
                      <span
                        onMouseEnter={() => onHelpHoverChange('expand')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Expand all</strong>
                      </span>
                      <span className="text-slate-300">Expand unexpanded neighbors of the selected node</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('add')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Add more</strong>
                      </span>
                      <span className="text-slate-300">Fetch more links from this node</span>
                      <span
                        onMouseEnter={() => onHelpHoverChange('delete')}
                        onMouseLeave={() => onHelpHoverChange(null)}
                        className="cursor-default"
                      >
                        <strong>Delete</strong>
                      </span>
                      <span className="text-slate-300">Remove node and orphaned branches</span>
                    </div>
                  </div>
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Explore:</strong> Find entities and expand their connections.</li>
                  <li><strong>Connect:</strong> Discover the hidden path between any two points.</li>
                  <li><strong>Timeline:</strong> View events and lives across the river of time.</li>
                </ul>
                <div className="pt-2 border-t border-slate-700 flex flex-col gap-2">
                  <a
                    href="https://www.linkedin.com/in/johndimm/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition-colors font-medium"
                  >
                    <LinkIcon size={14} /> Created by John Dimm
                  </a>
                  <div className="flex justify-between items-center">
                    <a
                      href="https://github.com/johndimm/Constellations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                    >
                      <Github size={14} /> View on GitHub
                    </a>
                    <span className="text-[10px] text-slate-500 italic">v1.2.0</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Share Dialog */}
          {showShare && (
            <div className="mb-4 bg-slate-800 p-3 rounded-lg border border-slate-600 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Share2 size={14} /> Share Graph
                </h3>
                <button onClick={() => setShowShare(false)}><X size={14} className="text-slate-400" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => onSave('__COPY_LINK__')}
                  className="flex flex-col items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg transition-colors border border-slate-600"
                >
                  <LinkIcon size={20} className="text-orange-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-center">Copy Link</span>
                </button>
                <button
                  onClick={() => onSave('__COPY__')}
                  className="flex flex-col items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg transition-colors border border-slate-600"
                >
                  <Copy size={20} className="text-purple-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-center">Copy JSON</span>
                </button>
                <button
                  onClick={() => onSave('__EXPORT__')}
                  className="flex flex-col items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg transition-colors border border-slate-600"
                >
                  <Download size={20} className="text-indigo-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-center">Download File</span>
                </button>
              </div>
              <p className="mt-3 text-[10px] text-slate-400 text-center italic">
                Share the JSON data with others to let them view your graph.
              </p>
            </div>
          )}

          {/* Save Dialog */}
          {showSave && (
            <div className="mb-4 bg-slate-800 p-3 rounded-lg border border-slate-600">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-white">Save Graph</h3>
                <button onClick={() => setShowSave(false)}><X size={14} className="text-slate-400" /></button>
              </div>
              <form onSubmit={handleSaveSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Graph Name..."
                  className="flex-1 bg-slate-900 border border-slate-700 text-white px-2 py-1 rounded text-sm focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
                <button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm font-medium">
                  Save
                </button>
                {/* Export Button (Downloads current as JSON) */}
                <button
                  type="button"
                  onClick={() => onSave('__EXPORT__')} // Special signal to export
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded text-sm font-medium flex items-center"
                  title="Export as JSON"
                >
                  <Download size={14} />
                </button>
              </form>
            </div>
          )}

          {/* Load Dialog */}
          {showLoad && (
            <div className="mb-4 bg-slate-800 p-3 rounded-lg border border-slate-600 max-h-60 overflow-y-auto">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-white">Load Graph</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-slate-400 hover:text-blue-400 flex items-center gap-1 text-xs"
                    title="Import JSON"
                  >
                    <Upload size={14} /> Import
                  </button>
                  <button onClick={() => setShowLoad(false)}><X size={14} className="text-slate-400" /></button>
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".json"
                className="hidden"
              />

              {savedGraphs.length === 0 ? (
                <p className="text-slate-400 text-xs italic">No saved graphs.</p>
              ) : (
                <div className="space-y-1">
                  {savedGraphs.map(name => (
                    <div key={name} className="flex justify-between items-center bg-slate-900 p-2 rounded hover:bg-slate-700 group transition-colors">
                      <button
                        onClick={() => { onLoad(name); setShowLoad(false); }}
                        className="text-white text-sm text-left flex-1"
                      >
                        {name}
                      </button>
                      <button
                        onClick={() => onDeleteGraph(name)}
                        className="text-slate-400 hover:text-red-400 transition-colors p-1"
                        title="Delete Graph"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type="text" value={exploreTerm} onChange={(e) => setExploreTerm(e.target.value)} placeholder="Enter a person or event..." className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-8 py-3 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" disabled={isProcessing} />
                    <Search className="absolute left-3 top-3.5 text-slate-400" size={16} />
                    {exploreTerm && (
                      <button type="button" onClick={() => setExploreTerm('')} className="absolute right-2 top-3.5 text-slate-400 hover:text-white">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <button type="submit" disabled={isProcessing} className={`px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all shadow-lg ${isProcessing ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'}`}>
                    {isProcessing ? '...' : 'GO'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <input type="text" value={pathStart} onChange={(e) => setPathStart(e.target.value)} placeholder="Start Person/Event..." className="w-full bg-slate-800 border border-slate-600 text-white px-4 py-2.5 pr-8 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" disabled={isProcessing} />
                    {pathStart && (
                      <button type="button" onClick={() => setPathStart('')} className="absolute right-2 top-2.5 text-slate-400 hover:text-white">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="flex justify-center -my-2"><ArrowRight size={14} className="text-slate-500" /></div>
                  <div className="relative">
                    <input type="text" value={pathEnd} onChange={(e) => setPathEnd(e.target.value)} placeholder="End Person/Event..." className="w-full bg-slate-800 border border-slate-600 text-white px-4 py-2.5 pr-8 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" disabled={isProcessing} />
                    {pathEnd && (
                      <button type="button" onClick={() => setPathEnd('')} className="absolute right-2 top-2.5 text-slate-400 hover:text-white">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <button type="submit" disabled={isProcessing} className={`w-full mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isProcessing ? 'bg-slate-700 text-slate-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                    {isProcessing ? 'Processing... ' : 'Find Connection'}
                  </button>
                </div>
              )}
            </form>

            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

            {searchMode === 'explore' && (!hasStarted || isHovered) && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map(ex => (
                  <button key={ex} onClick={() => { setExploreTerm(ex); onSearch(ex); setHasStarted(true); if (window.innerWidth < 768) onSetCollapsed(true); }} className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-full border border-slate-700 transition-colors">
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ControlPanel;
