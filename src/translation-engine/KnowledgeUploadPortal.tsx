import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  Upload,
  Mic,
  FileText,
  Video,
  CheckCircle,
  XCircle,
  Subtitles,
  Loader2,
  X,
  Trash2,
  CloudUpload,
  FolderOpen,
  AlertTriangle,
  Info,
  Eye,
  Menu
} from 'lucide-react';
import { extractKnowledgeFromFile, generateMergePreview, type ExtractionResult } from './knowledgeExtractor';

// Knowledge base upload proxy endpoint (Cloudflare R2)
const KB_UPLOAD_URL = '/api/kb-upload';

const IS_DEMO = false;

// Hardcoded sample extraction shown to public visitors in demo mode.
const DEMO_SAMPLE_EXTRACTION: ExtractionResult = {
  glossary: [
    { source: 'wolf', target: 'Wolf', context: 'brand term, never translate', confidence: 1.0 },
    { source: 'sentinel', target: 'Sentinel', context: 'product name', confidence: 1.0 },
    { source: 'threat hunter', target: 'Bedrohungsjäger', context: 'security role', confidence: 0.92 },
    { source: 'managed detection', target: 'verwaltete Erkennung', context: 'service tier', confidence: 0.88 },
  ] as any,
  idioms: [
    { source: 'beat them to the punch', target: 'ihnen zuvorkommen', literal_meaning: 'colloquial: act first', register: 'casual' },
    { source: 'across the board', target: 'auf ganzer Linie', literal_meaning: 'comprehensively', register: 'neutral' },
  ] as any,
  cultural_safeguards: [
    { rule: 'Avoid US-centric sports metaphors', severity: 'medium' },
    { rule: 'Use formal "Sie" in B2B contexts unless brand voice dictates otherwise', severity: 'high' },
  ] as any,
  srt_timing: { avg_chars_per_line: 38, max_lines: 2, min_duration_ms: 1200 } as any,
  metadata: {
    source_type: 'demo',
    extracted_at: new Date().toISOString(),
    note: 'This is a demo preview. No data was committed to the knowledge base.',
  } as any,
};

// ============================================
// TYPES
// ============================================

interface UploadCard {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  acceptedTypes: string;
  acceptLabel: string;
  extractionValue: string[];
  color: string;
  uploadFolder: string;
}

interface QueuedFile {
  id: string;
  file: File;
  cardId: string;
  status: 'queued' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  extractedInsights?: string;
  extractionResult?: ExtractionResult;
  error?: string;
  committed?: boolean;
  commitStatus?: 'idle' | 'committing' | 'committed' | 'error';
  commitResult?: { glossary?: { added: number; updated: number }; idioms?: { added: number }; safeguards?: { added: number } };
}

// ============================================
// CARD DEFINITIONS
// ============================================

const UPLOAD_CARDS: UploadCard[] = [
  {
    id: 'podcasts',
    title: 'Podcasts & Audio',
    subtitle: 'Native speech patterns',
    description: 'Upload podcasts, radio clips, or audio recordings from reviewers to extract natural phrasing, idioms, and pronunciation patterns.',
    icon: <Mic className="w-7 h-7" />,
    acceptedTypes: 'audio/mpeg,audio/wav,audio/mp4,audio/m4a,audio/ogg,.mp3,.wav,.m4a',
    acceptLabel: 'MP3, WAV, M4A',
    extractionValue: ['Idioms & colloquialisms', 'Natural pacing & cadence', 'Pronunciation patterns', 'Regional dialect markers'],
    color: '#6366f1',
    uploadFolder: 'uploads/audio',
  },
  {
    id: 'srt',
    title: 'SRT Files',
    subtitle: 'Timing & readability',
    description: 'Upload existing subtitle files to learn timing patterns, line-length preferences, and reading speed norms.',
    icon: <Subtitles className="w-7 h-7" />,
    acceptedTypes: '.srt,.vtt,.sub,.ass,text/plain',
    acceptLabel: 'SRT, VTT, SUB',
    extractionValue: ['Line length preferences', 'Reading speed norms', 'Segment break patterns', 'Abbreviation conventions'],
    color: '#0ea5e9',
    uploadFolder: 'uploads/srt',
  },
  {
    id: 'documents',
    title: 'Documents',
    subtitle: 'Terminology in context',
    description: 'Upload business docs, style guides, or reference materials to extract terminology usage, sentence structure, and formality patterns.',
    icon: <FileText className="w-7 h-7" />,
    acceptedTypes: '.txt,.md,.pdf,.doc,.docx,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptLabel: 'PDF, DOCX, TXT, MD, RTF',
    extractionValue: ['Terminology in context', 'Sentence structure', 'Formality registers', 'Industry-specific phrasing'],
    color: '#10b981',
    uploadFolder: 'uploads/documents',
  },
  {
    id: 'video',
    title: 'Video Content',
    subtitle: 'Speech cadence & visuals',
    description: 'Upload training videos or recordings (under 30MB) to analyze speech cadence, regional accents, and visual context for better localization.',
    icon: <Video className="w-7 h-7" />,
    acceptedTypes: 'video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm',
    acceptLabel: 'MP4, MOV, AVI, WebM (max 30MB)',
    extractionValue: ['Speech cadence', 'Regional accents', 'Visual context cues', 'Tone & delivery style'],
    color: '#f59e0b',
    uploadFolder: 'uploads/video',
  },
  {
    id: 'approved',
    title: 'Approved Translations',
    subtitle: 'Reinforcement learning',
    description: 'Upload translations that passed stakeholder review. These become the gold standard the engine learns to replicate.',
    icon: <CheckCircle className="w-7 h-7" />,
    acceptedTypes: '.txt,.md,.pdf,.doc,.docx,.srt,.json,.csv,text/plain',
    acceptLabel: 'TXT, DOCX, SRT, CSV',
    extractionValue: ['Approved terminology', 'Preferred phrasing', 'Tone benchmarks', 'Structural patterns'],
    color: '#22c55e',
    uploadFolder: 'uploads/approved',
  },
  {
    id: 'rejected',
    title: 'Rejected & Feedback',
    subtitle: 'What to avoid',
    description: 'Upload rejected translations or reviewer feedback. The engine learns what NOT to do and which corrections were applied.',
    icon: <XCircle className="w-7 h-7" />,
    acceptedTypes: '.txt,.md,.pdf,.doc,.docx,.srt,.json,.csv,text/plain',
    acceptLabel: 'TXT, DOCX, SRT, CSV',
    extractionValue: ['Common mistakes', 'Reviewer corrections', 'Banned phrasings', 'Tone violations'],
    color: '#ef4444',
    uploadFolder: 'uploads/rejected',
  },
];

// ============================================
// MAIN COMPONENT
// ============================================

const KPHamburgerMenu: React.FC<{
  onNavigateHome: () => void;
}> = ({ onNavigateHome }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Navigation menu"
        className="flex items-center justify-center w-11 h-11 rounded-xl hover:bg-white/10 transition-colors"
      >
        {open ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
      </button>

      {open && (
        <div
          className="absolute top-14 right-0 w-56 rounded-2xl overflow-hidden shadow-2xl border border-white/10 z-[100]"
          style={{
            background: 'rgba(0,0,0,0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <p className="px-5 pt-4 pb-2 text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">Polaris</p>
          <button
            onClick={() => { onNavigateHome(); setOpen(false); }}
            className="block w-full text-left px-5 py-3 text-sm font-semibold text-neutral-300 hover:text-white hover:bg-white/8 transition-colors"
          >
            Back to Translator
          </button>

        </div>
      )}
    </div>
  );
};

export const KnowledgeUploadPortal: React.FC<{ onNavigateHome: () => void }> = ({ onNavigateHome }) => {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('German (Germany)');
  const [showQueue, setShowQueue] = useState(false);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive previewItem from queue so it always reflects latest state
  const previewItem = previewItemId ? queue.find(f => f.id === previewItemId) || null : null;
  const setPreviewItem = (item: QueuedFile | null) => setPreviewItemId(item?.id || null);

  const totalQueued = queue.length;
  const totalComplete = queue.filter(f => f.status === 'complete').length;
  const totalErrors = queue.filter(f => f.status === 'error').length;
  const isUploading = queue.some(f => f.status === 'uploading' || f.status === 'processing');

  const requireAdmin = (callback: () => void) => {
    if (adminUnlocked) { callback(); return; }
    const code = window.prompt('Enter admin code to upload knowledge files:');
    if (code === '1555') {
      setAdminUnlocked(true);
      callback();
    }
  };

  const handleCardClick = (cardId: string) => {
    requireAdmin(() => {
      setActiveCard(cardId);
      setTimeout(() => fileInputRef.current?.click(), 50);
    });
  };

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !activeCard) return;

    const newFiles: QueuedFile[] = Array.from(files).map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      cardId: activeCard,
      status: 'queued' as const,
      progress: 0,
    }));

    setQueue(prev => [...prev, ...newFiles]);
    setShowQueue(true);
    setActiveCard(null);

    // Reset the input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [activeCard]);

  const handleDrop = useCallback((e: React.DragEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!adminUnlocked) {
      const code = window.prompt('Enter admin code to upload knowledge files:');
      if (code !== '1555') return;
      setAdminUnlocked(true);
    }
    const files = e.dataTransfer.files;
    if (!files.length) return;

    const newFiles: QueuedFile[] = Array.from(files).map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      cardId,
      status: 'queued' as const,
      progress: 0,
    }));

    setQueue(prev => [...prev, ...newFiles]);
    setShowQueue(true);
  }, [adminUnlocked]);

  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(f => f.id !== id));
  };

  const clearCompleted = () => {
    setQueue(prev => prev.filter(f => f.status !== 'complete' && f.status !== 'error'));
  };

  // Commit a single extraction result to the knowledge base.
  // In demo mode this is a no-op that just marks the item as "committed"
  // without ever touching storage, so visitors see the full UX.
  const commitToKnowledgeBase = async (item: QueuedFile) => {
    if (!item.extractionResult) return;

    if (IS_DEMO) {
      setQueue(prev => prev.map(f => f.id === item.id ? {
        ...f,
        committed: true,
        commitStatus: 'committed' as const,
        commitResult: { glossary: { added: 4, updated: 0 }, idioms: { added: 2 }, safeguards: { added: 2 } },
      } : f));
      return;
    }

    setQueue(prev => prev.map(f => f.id === item.id ? { ...f, commitStatus: 'committing' as const } : f));

    try {
      const response = await fetch(KB_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit-knowledge',
          language: targetLanguage,
          data: {
            glossary: item.extractionResult.glossary,
            idioms: item.extractionResult.idioms,
            cultural_safeguards: item.extractionResult.cultural_safeguards,
            srt_timing: item.extractionResult.srt_timing,
            metadata: item.extractionResult.metadata,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      setQueue(prev => prev.map(f => f.id === item.id ? {
        ...f,
        committed: true,
        commitStatus: 'committed' as const,
        commitResult: result.results,
      } : f));
    } catch (err: any) {
      setQueue(prev => prev.map(f => f.id === item.id ? {
        ...f,
        commitStatus: 'error' as const,
        error: err.message || 'Commit to knowledge base failed',
      } : f));
    }
  };

  // Commit all completed extractions to R2
  const commitAllToKnowledgeBase = async () => {
    const completedUncommitted = queue.filter(f => f.status === 'complete' && !f.committed && f.extractionResult);
    for (const item of completedUncommitted) {
      await commitToKnowledgeBase(item);
    }
  };

  const processQueue = async () => {
    const pending = queue.filter(f => f.status === 'queued');
    if (pending.length === 0) return;

    // ============================================
    // DEMO MODE: simulate the full extraction + commit flow without ever
    // hitting Claude or R2. Visitors get the same visual journey but no
    // real data is touched.
    // ============================================
    if (IS_DEMO) {
      for (const item of pending) {
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: 'uploading' as const, progress: 20 } : f));
        await new Promise(r => setTimeout(r, 400));
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' as const, progress: 50, extractedInsights: 'Analyzing audio patterns and natural phrasing...' } : f));
        await new Promise(r => setTimeout(r, 800));
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, progress: 80, extractedInsights: 'Extracting glossary terms and idioms...' } : f));
        await new Promise(r => setTimeout(r, 600));
        setQueue(prev => prev.map(f => f.id === item.id ? {
          ...f,
          status: 'complete' as const,
          progress: 100,
          extractionResult: DEMO_SAMPLE_EXTRACTION,
          extractedInsights: 'Demo preview ready. Nothing was saved to the knowledge base.',
          committed: true,
          commitStatus: 'committed' as const,
          commitResult: { glossary: { added: 4, updated: 0 }, idioms: { added: 2 }, safeguards: { added: 2 } },
        } : f));
      }
      return;
    }

    for (const item of pending) {
      // Update status to uploading
      setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: 'uploading' as const, progress: 20 } : f));

      try {
        // Step 1: Extract knowledge using Claude (via proxy)
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' as const, progress: 40 } : f));

        const extractionResult = await extractKnowledgeFromFile(
          item.file,
          item.cardId as any,
          targetLanguage,
          (status) => {
            setQueue(prev => prev.map(f =>
              f.id === item.id ? { ...f, extractedInsights: status, progress: 60 } : f
            ));
          }
        );

        // Step 2: Auto-commit extracted knowledge to R2
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, progress: 80, extractedInsights: 'Committing to knowledge base...' } : f));

        let commitResult = undefined;
        let committed = false;
        try {
          const commitResponse = await fetch(KB_UPLOAD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'commit-knowledge',
              language: targetLanguage,
              data: {
                glossary: extractionResult.glossary,
                idioms: extractionResult.idioms,
                cultural_safeguards: extractionResult.cultural_safeguards,
                srt_timing: extractionResult.srt_timing,
                metadata: extractionResult.metadata,
              },
            }),
          });

          if (commitResponse.ok) {
            const result = await commitResponse.json();
            commitResult = result.results;
            committed = true;
          }
        } catch {
          // Commit failed but extraction succeeded; user can retry commit later
        }

        // Step 3: Complete with extraction results
        const summary = committed
          ? `Committed: ${extractionResult.glossary.length} terms, ${extractionResult.idioms.length} idioms, ${extractionResult.cultural_safeguards.length} cultural notes`
          : `Extracted: ${extractionResult.glossary.length} terms, ${extractionResult.idioms.length} idioms, ${extractionResult.cultural_safeguards.length} cultural notes (commit pending)`;

        setQueue(prev => prev.map(f => f.id === item.id ? {
          ...f,
          status: 'complete' as const,
          progress: 100,
          extractedInsights: summary,
          extractionResult,
          committed,
          commitStatus: committed ? 'committed' as const : 'idle' as const,
          commitResult,
        } : f));

      } catch (err: any) {
        setQueue(prev => prev.map(f => f.id === item.id ? {
          ...f,
          status: 'error' as const,
          progress: 0,
          error: err.message || 'Extraction failed'
        } : f));
      }
    }
  };

  const getCardForFile = (cardId: string) => UPLOAD_CARDS.find(c => c.id === cardId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 text-white">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={activeCard ? UPLOAD_CARDS.find(c => c.id === activeCard)?.acceptedTypes : '*'}
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-neutral-950/90 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-6">
            <button
              onClick={onNavigateHome}
              className="flex items-center gap-2 sm:gap-3 text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-black text-lg sm:text-xl tracking-tight uppercase">POLARIS</span>
            </button>
            <div className="hidden sm:block w-px h-8 bg-white/20" />
            <span className="hidden sm:block text-white/40 font-medium text-base uppercase tracking-widest">Knowledge Portal</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {totalQueued > 0 && (
              <button
                onClick={() => setShowQueue(!showQueue)}
                className="relative flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/15 rounded-full transition-all"
              >
                <CloudUpload className="w-5 h-5" />
                <span className="font-bold text-sm">{totalQueued} file{totalQueued !== 1 ? 's' : ''}</span>
                {totalComplete > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-full">
                    {totalComplete} done
                  </span>
                )}
              </button>
            )}
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="px-5 py-2.5 bg-white/10 border border-white/10 rounded-full text-white text-sm font-medium focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
            >
              <option value="German (Germany)">German (Germany)</option>
              <option value="French (France)">French (France)</option>
              <option value="Spanish (Latin American)">Spanish (Latin American)</option>
              <option value="Japanese">Japanese</option>
              <option value="Chinese (Mandarin)">Chinese (Mandarin)</option>
              <option value="Korean">Korean</option>
              <option value="Italian">Italian</option>
            </select>
            {/* Hamburger menu */}
            <KPHamburgerMenu onNavigateHome={onNavigateHome} />
          </div>
        </div>
      </header>

      {/* Demo mode banner - public visitors only */}
      {IS_DEMO && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/15 to-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center gap-3">
            <Info className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <p className="text-sm sm:text-base text-amber-100/90">
              <span className="font-bold text-amber-300">Demo Mode.</span>{' '}
              This is a live preview of how Polaris extracts knowledge from your assets. Files dropped here are simulated, not stored. The real upload portal is admin-only.
            </p>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-10 sm:pb-16">
        <div className="max-w-3xl">
          <p className="text-blue-400 font-bold text-sm uppercase tracking-[0.4em] mb-6">Knowledge Base Intelligence</p>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-black leading-[0.95] tracking-tight mb-6 sm:mb-8">
            Fuel the
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">engine.</span>
          </h1>
          <p className="text-xl text-neutral-400 leading-relaxed max-w-2xl">
            Upload native content to improve translation accuracy. The more context Polaris has, the sharper it gets. Real speech patterns, approved terminology, and lessons from past corrections.
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 mb-8 sm:mb-12">
        <div className="flex items-start gap-4 p-5 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
          <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-blue-300 text-sm font-medium leading-relaxed">
              Uploaded content is analyzed by Claude to extract patterns, terminology, and preferences. These insights feed directly into the{' '}
              <strong className="text-blue-200">{targetLanguage}</strong> knowledge base, improving glossary accuracy, cultural calibration, and tone matching for every future translation.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Cards Grid */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 pb-20 sm:pb-32">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {UPLOAD_CARDS.map((card) => {
            const filesForCard = queue.filter(f => f.cardId === card.id);
            const completeCount = filesForCard.filter(f => f.status === 'complete').length;

            return (
              <UploadCardComponent
                key={card.id}
                card={card}
                filesCount={filesForCard.length}
                completeCount={completeCount}
                onDrop={(e) => handleDrop(e, card.id)}
                onClick={() => handleCardClick(card.id)}
              />
            );
          })}
        </div>

        {/* Action Buttons */}
        {(queue.filter(f => f.status === 'queued').length > 0 || queue.filter(f => f.status === 'complete' && !f.committed).length > 0) && (
          <div className="flex justify-center gap-4 mt-16 flex-wrap">
            {queue.filter(f => f.status === 'queued').length > 0 && (
              <button
                onClick={processQueue}
                disabled={isUploading}
                className="group px-16 py-6 bg-white text-black font-black text-xl rounded-full hover:bg-white/90 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all shadow-2xl shadow-white/10 uppercase tracking-wide flex items-center gap-4"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6" />
                    Process {queue.filter(f => f.status === 'queued').length} File{queue.filter(f => f.status === 'queued').length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            )}
            {queue.filter(f => f.status === 'complete' && !f.committed).length > 0 && (
              <button
                onClick={commitAllToKnowledgeBase}
                className="group px-12 py-6 bg-emerald-600 text-white font-black text-xl rounded-full hover:bg-emerald-500 hover:scale-105 transition-all shadow-2xl shadow-emerald-500/10 uppercase tracking-wide flex items-center gap-4"
              >
                <CloudUpload className="w-6 h-6" />
                Commit {queue.filter(f => f.status === 'complete' && !f.committed).length} to Knowledge Base
              </button>
            )}
          </div>
        )}
      </div>

      {/* Queue Sidebar */}
      {showQueue && (
        <QueueSidebar
          queue={queue}
          getCardForFile={getCardForFile}
          onRemove={removeFromQueue}
          onClearCompleted={clearCompleted}
          onClose={() => setShowQueue(false)}
          previewItem={previewItem}
          setPreviewItem={setPreviewItem}
          onCommit={commitToKnowledgeBase}
        />
      )}
    </div>
  );
};

// ============================================
// UPLOAD CARD COMPONENT
// ============================================

const UploadCardComponent: React.FC<{
  card: UploadCard;
  filesCount: number;
  completeCount: number;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
}> = ({ card, filesCount, completeCount, onDrop, onClick }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    setIsDragOver(false);
    onDrop(e);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={onClick}
      className={`group relative rounded-3xl border-2 transition-all duration-300 cursor-pointer overflow-hidden ${
        isDragOver
          ? 'border-white/40 bg-white/10 scale-[1.02]'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
      }`}
    >
      {/* Top accent bar */}
      <div
        className="h-1 w-full opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ background: card.color }}
      />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ background: `${card.color}20`, color: card.color }}
          >
            {card.icon}
          </div>
          {filesCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-white/10 rounded-full text-[10px] font-bold text-white/70">
                {filesCount} queued
              </span>
              {completeCount > 0 && (
                <span className="px-2 py-0.5 bg-emerald-500/20 rounded-full text-[10px] font-bold text-emerald-400">
                  {completeCount} done
                </span>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-black text-white mb-0.5 tracking-tight">{card.title}</h3>
        <p className="text-xs font-medium mb-3" style={{ color: card.color }}>{card.subtitle}</p>

        {/* Description */}
        <p className="text-xs text-neutral-400 leading-relaxed mb-4">{card.description}</p>

        {/* Extraction Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {card.extractionValue.map((tag, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/5 text-neutral-400 border border-white/5"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Drop Zone */}
        <div className={`flex items-center justify-center gap-2 py-3 border-2 border-dashed rounded-lg transition-all ${
          isDragOver ? 'border-white/30 bg-white/5' : 'border-white/10 group-hover:border-white/20'
        }`}>
          <Upload className="w-3.5 h-3.5 text-neutral-500" />
          <span className="text-xs text-neutral-500 font-medium">
            Drop files or click to browse
          </span>
        </div>
        <p className="text-[10px] text-neutral-600 mt-2 text-center">{card.acceptLabel}</p>
      </div>
    </div>
  );
};

// ============================================
// QUEUE SIDEBAR
// ============================================

const QueueSidebar: React.FC<{
  queue: QueuedFile[];
  getCardForFile: (cardId: string) => UploadCard | undefined;
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
  onClose: () => void;
  previewItem: QueuedFile | null;
  setPreviewItem: (item: QueuedFile | null) => void;
  onCommit: (item: QueuedFile) => void;
}> = ({ queue, getCardForFile, onRemove, onClearCompleted, onClose, previewItem, setPreviewItem, onCommit }) => {

  const statusIcon = (status: QueuedFile['status']) => {
    switch (status) {
      case 'queued': return <FolderOpen className="w-4 h-4 text-neutral-500" />;
      case 'uploading': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      case 'processing': return <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />;
      case 'complete': return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-400" />;
    }
  };

  const statusLabel = (status: QueuedFile['status']) => {
    switch (status) {
      case 'queued': return 'Queued';
      case 'uploading': return 'Uploading...';
      case 'processing': return 'Extracting insights...';
      case 'complete': return 'Complete';
      case 'error': return 'Failed';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" />
      <div className="w-[460px] bg-neutral-900 border-l border-white/10 flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <CloudUpload className="w-5 h-5 text-blue-400" />
            <h2 className="font-black text-lg text-white uppercase tracking-tight">Upload Queue</h2>
          </div>
          <div className="flex items-center gap-2">
            {queue.some(f => f.status === 'complete' || f.status === 'error') && (
              <button
                onClick={onClearCompleted}
                className="px-3 py-1.5 text-xs font-bold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all"
              >
                Clear done
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Queue List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {queue.length === 0 ? (
            <div className="text-center py-20 text-neutral-500">
              <CloudUpload className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-base font-medium">No files queued</p>
            </div>
          ) : (
            queue.map(item => {
              const card = getCardForFile(item.cardId);
              return (
                <div
                  key={item.id}
                  className="p-4 bg-white/[0.03] border border-white/5 rounded-xl hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{statusIcon(item.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{item.file.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: `${card?.color}20`, color: card?.color }}
                        >
                          {card?.title}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {(item.file.size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">{statusLabel(item.status)}</p>
                      {item.error && (
                        <p className="text-xs text-red-400 mt-1">{item.error}</p>
                      )}
                    </div>
                    {(item.status === 'queued' || item.status === 'error') && (
                      <button
                        onClick={() => onRemove(item.id)}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-neutral-500 hover:text-red-400" />
                      </button>
                    )}
                    {item.status === 'complete' && item.extractionResult && (
                      <div className="flex items-center gap-1.5">
                        {item.committed && (
                          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold">
                            KB
                          </span>
                        )}
                        <button
                          onClick={() => setPreviewItem(item)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors text-xs font-medium"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  {(item.status === 'uploading' || item.status === 'processing') && (
                    <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${item.progress}%`,
                          background: item.status === 'processing'
                            ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
                            : 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer stats */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-500">
          <span>{queue.filter(f => f.status === 'queued').length} pending</span>
          <span>{queue.filter(f => f.status === 'complete').length} complete</span>
          <span>{queue.filter(f => f.status === 'error').length} errors</span>
        </div>
      </div>

      {/* Extraction Preview Modal */}
      {previewItem && previewItem.extractionResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <div className="bg-neutral-900 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-neutral-800">
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">Extraction Results</h3>
                <p className="text-sm text-neutral-400 mt-0.5">{previewItem.file.name}</p>
              </div>
              <button onClick={() => setPreviewItem(null)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                  <div className="text-2xl font-bold text-emerald-400">{previewItem.extractionResult.glossary.length}</div>
                  <div className="text-xs text-neutral-400 mt-1">Glossary Terms</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <div className="text-2xl font-bold text-blue-400">{previewItem.extractionResult.idioms.length}</div>
                  <div className="text-xs text-neutral-400 mt-1">Idioms</div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <div className="text-2xl font-bold text-amber-400">{previewItem.extractionResult.cultural_safeguards.length}</div>
                  <div className="text-xs text-neutral-400 mt-1">Cultural Notes</div>
                </div>
              </div>
              {previewItem.extractionResult.glossary.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-white mb-3">Glossary Terms (Top 20)</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {previewItem.extractionResult.glossary.slice(0, 20).map((term, idx) => (
                      <div key={idx} className="bg-neutral-800/50 rounded-lg p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-neutral-400">{term.en || '--'}</div>
                            <div className="text-white font-medium mt-0.5">{term.de_approved}</div>
                            {term.note && <div className="text-xs text-neutral-500 mt-1">{term.note}</div>}
                          </div>
                          {term.usage_count && term.usage_count > 1 && (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium">{term.usage_count}x</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-neutral-800 flex items-center justify-between">
              <div className="text-xs text-neutral-500">Extracted on {new Date(previewItem.extractionResult.metadata.extraction_date).toLocaleDateString()}</div>
              <div className="flex items-center gap-3">
                {previewItem.committed ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium">
                    <CheckCircle className="w-4 h-4" />
                    Committed to Knowledge Base
                    {previewItem.commitResult && (
                      <span className="text-xs text-emerald-400/70 ml-1">
                        (+{previewItem.commitResult.glossary?.added || 0} terms, +{previewItem.commitResult.idioms?.added || 0} idioms, +{previewItem.commitResult.safeguards?.added || 0} safeguards)
                      </span>
                    )}
                  </div>
                ) : previewItem.commitStatus === 'committing' ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Committing...
                  </div>
                ) : (
                  <button
                    onClick={() => { onCommit(previewItem); }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2"
                  >
                    <CloudUpload className="w-4 h-4" />
                    Commit to Knowledge Base
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
