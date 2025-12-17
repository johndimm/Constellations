import React, { useState } from 'react';
import { Search, Github, HelpCircle, Minimize2, Maximize2, AlertCircle, Scissors, Calendar, Network, X, Link as LinkIcon, ArrowRight } from 'lucide-react';

interface ControlPanelProps {
  onSearch: (term: string) => void;
  onPathSearch: (start: string, end: string) => void;
  isProcessing: boolean;
  isCompact: boolean;
  onToggleCompact: () => void;
  isTimelineMode: boolean;
  onToggleTimeline: () => void;
  onPrune?: () => void;
  error?: string | null;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  onSearch, 
  onPathSearch,
  isProcessing,
  isCompact,
  onToggleCompact,
  isTimelineMode,
  onToggleTimeline,
  onPrune,
  error
}) => {
  const [mode, setMode] = useState<'explore' | 'connect'>('explore');
  const [input, setInput] = useState('');
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  
  const [showHelp, setShowHelp] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'explore') {
        if (input.trim()) {
            onSearch(input.trim());
            setHasStarted(true);
        }
    } else {
        if (startInput.trim() && endInput.trim()) {
            onPathSearch(startInput.trim(), endInput.trim());
            setHasStarted(true);
        }
    }
  };

  const handleClear = () => {
    setInput('');
    setStartInput('');
    setEndInput('');
  };

  const EXAMPLES = [
    "The Godfather",
    "Watergate Scandal",
    "Zodiac Killer",
    "Trump's Second Administration",
    "The Manhattan Project"
  ];

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 w-full max-w-md pointer-events-none">
      <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-red-500 mr-2">
            Constellations
          </h1>
          <div className="flex items-center gap-3">
            <button 
                onClick={onToggleTimeline}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all border ${
                  isTimelineMode 
                    ? 'bg-amber-500 text-slate-900 border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400' 
                    : 'bg-slate-800 text-slate-300 border-slate-600 hover:border-amber-400 hover:text-amber-400'
                }`}
                title={isTimelineMode ? "Switch to Graph View" : "Switch to Timeline View"}
            >
                {isTimelineMode ? <Network size={14} /> : <Calendar size={14} />}
                <span>{isTimelineMode ? "Graph" : "Timeline"}</span>
            </button>

            <div className="h-5 w-px bg-slate-700"></div>

             {/* Mode Toggle */}
            <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                <button
                    onClick={() => setMode('explore')}
                    className={`p-1.5 rounded-md transition-colors ${mode === 'explore' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                    title="Explore Mode"
                >
                    <Search size={16} />
                </button>
                <button
                    onClick={() => setMode('connect')}
                    className={`p-1.5 rounded-md transition-colors ${mode === 'connect' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                    title="Connection Path Mode"
                >
                    <LinkIcon size={16} />
                </button>
            </div>

            <div className="flex items-center gap-2">
                <button 
                    onClick={onToggleCompact}
                    className="text-slate-400 hover:text-white transition-colors p-1"
                    title={isCompact ? "Expand View" : "Compact View"}
                >
                    {isCompact ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
                </button>
                {onPrune && (
                    <button 
                        onClick={onPrune}
                        className="text-slate-400 hover:text-red-400 transition-colors p-1"
                        title="Trim Isolated Nodes"
                    >
                        <Scissors size={18} />
                    </button>
                )}
                <button 
                    onClick={() => setShowHelp(!showHelp)}
                    className="text-slate-400 hover:text-white transition-colors p-1"
                    title="Help"
                >
                    <HelpCircle size={18} />
                </button>
                <a 
                href="https://github.com/johndimm/Constellations" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors p-1"
                title="View on GitHub"
                >
                <Github size={18} />
                </a>
            </div>
          </div>
        </div>

        <div 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <form onSubmit={handleSubmit} className="relative mb-4 space-y-3">
              {mode === 'explore' ? (
                  <div className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Enter an event (e.g., The Godfather)..."
                        className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-10 py-3 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all placeholder-slate-500"
                        disabled={isProcessing}
                    />
                    <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
                    {input && !isProcessing && (
                        <button
                            type="button"
                            onClick={() => setInput('')}
                            className="absolute right-3 top-3.5 text-slate-400 hover:text-white"
                        >
                            <X size={16} />
                        </button>
                    )}
                  </div>
              ) : (
                  <div className="flex flex-col gap-2">
                      <div className="relative">
                        <input
                            type="text"
                            value={startInput}
                            onChange={(e) => setStartInput(e.target.value)}
                            placeholder="Start Person/Event..."
                            className="w-full bg-slate-800 border border-slate-600 text-white pl-9 pr-8 py-2.5 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm placeholder-slate-500"
                            disabled={isProcessing}
                        />
                        <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-indigo-500"></div>
                      </div>
                      
                      <div className="relative flex justify-center -my-2 z-10">
                          <div className="bg-slate-700 rounded-full p-1 border border-slate-600">
                             <ArrowRight size={14} className="text-slate-300" />
                          </div>
                      </div>

                      <div className="relative">
                        <input
                            type="text"
                            value={endInput}
                            onChange={(e) => setEndInput(e.target.value)}
                            placeholder="End Person/Event..."
                            className="w-full bg-slate-800 border border-slate-600 text-white pl-9 pr-8 py-2.5 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm placeholder-slate-500"
                            disabled={isProcessing}
                        />
                         <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-red-500"></div>
                      </div>
                  </div>
              )}
              
              <div className="flex justify-end">
                  <button 
                    type="submit"
                    disabled={isProcessing || (mode === 'explore' ? !input.trim() : (!startInput.trim() || !endInput.trim()))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg hover:shadow-indigo-500/25 ${
                        isProcessing 
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white hover:scale-[1.02]'
                    }`}
                  >
                    {isProcessing ? 'Processing...' : (mode === 'explore' ? 'Start Exploration' : 'Find Connection')}
                  </button>
              </div>
            </form>

            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-200 text-sm animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            {mode === 'explore' && (!hasStarted || isHovered) && (
                <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {EXAMPLES.map(ex => (
                        <button
                            key={ex}
                            onClick={() => {
                                setInput(ex);
                                onSearch(ex);
                                setHasStarted(true);
                            }}
                            disabled={isProcessing}
                            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full border border-slate-700 transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-white text-left"
                        >
                            {ex}
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>

      {showHelp && (
        <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto text-slate-300 text-sm space-y-2 animate-in fade-in slide-in-from-top-4">
          <p><strong className="text-white">How it works:</strong></p>
          <ul className="list-disc pl-4 space-y-1">
            <li><strong>Events</strong> (Blue) connect to <strong>People</strong>.</li>
            <li><strong>People</strong> (Gold) connect to their <strong>Works</strong>.</li>
            <li>Use the <LinkIcon className="inline w-3 h-3" /> icon to find a path between two people or events (Six Degrees style).</li>
            <li>Click the <strong className="text-amber-400">TIMELINE</strong> button to align events by year.</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;