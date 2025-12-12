import React, { useState, useEffect } from 'react';
import { Search, Info, Github, HelpCircle, Minimize2, Maximize2, AlertCircle, Key } from 'lucide-react';

interface ControlPanelProps {
  onSearch: (term: string) => void;
  isProcessing: boolean;
  isCompact: boolean;
  onToggleCompact: () => void;
  error?: string | null;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  onSearch, 
  isProcessing,
  isCompact,
  onToggleCompact,
  error
}) => {
  const [input, setInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  // Clear input when search completes successfully (optional, but good UX)
  // keeping input for now so user sees what they searched

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim());
    }
  };

  const handleChangeKey = () => {
    if ((window as any).aistudio) {
        (window as any).aistudio.openSelectKey();
    }
  };

  const EXAMPLES = [
    "The Godfather",
    "Watergate Scandal",
    "Trump's Second Administration",
    "The Manhattan Project"
  ];

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 w-full max-w-md pointer-events-none">
      <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Constellations
          </h1>
          <div className="flex gap-2">
            <button
              onClick={handleChangeKey}
              className="text-slate-400 hover:text-yellow-400 transition-colors"
              title="Change API Key"
            >
              <Key size={20} />
            </button>
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-white transition-colors"
              title="View on GitHub"
            >
              <Github size={20} />
            </a>
            <button 
                onClick={onToggleCompact}
                className="text-slate-400 hover:text-white transition-colors"
                title={isCompact ? "Expand View" : "Compact View"}
            >
                {isCompact ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
            </button>
            <button 
                onClick={() => setShowHelp(!showHelp)}
                className="text-slate-400 hover:text-white transition-colors"
                title="Help"
            >
                <HelpCircle size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative mb-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter an event (e.g., The Godfather)..."
            className="w-full bg-slate-800 border border-slate-600 text-white pl-10 pr-4 py-3 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all placeholder-slate-500"
            disabled={isProcessing}
          />
          <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
          <button 
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="absolute right-2 top-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Exploring...' : 'Start'}
          </button>
        </form>

        {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-200 text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>{error}</p>
            </div>
        )}

        <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(ex => (
                <button
                    key={ex}
                    onClick={() => {
                        setInput(ex);
                        onSearch(ex);
                    }}
                    disabled={isProcessing}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full border border-slate-700 transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-white text-left"
                >
                    {ex}
                </button>
            ))}
        </div>
      </div>

      {showHelp && (
        <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto text-slate-300 text-sm space-y-2 animate-in fade-in slide-in-from-top-4">
          <p><strong className="text-white">How it works:</strong></p>
          <ul className="list-disc pl-4 space-y-1">
            <li><strong>Nodes</strong> are events, movies, projects, battles, or schools.</li>
            <li><strong>Edges</strong> (lines) are people connecting these nodes.</li>
            <li>Click a node to discover more connections via the Gemini AI.</li>
            <li>Click a person (on the line) to see other things they worked on.</li>
            <li>Use the <strong>minimize</strong> button to pull nodes closer together.</li>
            <li>Drag nodes to rearrange the graph.</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;