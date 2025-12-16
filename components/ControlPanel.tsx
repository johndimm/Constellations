import React, { useState } from 'react';
import { Search, Github, HelpCircle, Minimize2, Maximize2, AlertCircle, Scissors, Calendar, Network, X } from 'lucide-react';

interface ControlPanelProps {
  onSearch: (term: string) => void;
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
  isProcessing,
  isCompact,
  onToggleCompact,
  isTimelineMode,
  onToggleTimeline,
  onPrune,
  error
}) => {
  const [input, setInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim());
      setHasStarted(true);
    }
  };

  const handleClear = () => {
    setInput('');
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
            <form onSubmit={handleSubmit} className="relative mb-4">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter an event (e.g., The Godfather)..."
                className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-24 py-3 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all placeholder-slate-500"
                disabled={isProcessing}
              />
              <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
              
              <div className="absolute right-2 top-2 flex items-center gap-2">
                  {input && !isProcessing && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-700/50 transition-colors"
                        title="Clear search"
                    >
                        <X size={16} />
                    </button>
                  )}
                  <button 
                    type="submit"
                    disabled={isProcessing || !input.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {isProcessing ? 'Exploring...' : 'Start'}
                  </button>
              </div>
            </form>

            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-200 text-sm animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            {(!hasStarted || isHovered) && (
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
            <li>Click the <strong className="text-amber-400">TIMELINE</strong> button to align events by year.</li>
            <li>Double-click nodes to expand them further.</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;