import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  Check,
  Upload,
  ArrowRight,
  FileText,
  Video,
  Image as ImageIcon,
  Loader2,
  X,
  Clock,
  History,
  RotateCcw,
  Copy,
  AlertTriangle,
  Trash2,
  Menu
} from 'lucide-react';
import { ResultViewer } from './ResultViewer';
import {
  processLocalization,
  verifyClaudeConnection,
  verifyOpenAIConnection,
  lookupWord,
  getHistory,
  saveToHistory,
  loadHistoryResult,
  deleteHistoryItem,
  isSRTFile,
  readFileAsText,
  processSRTLocalization,
  type SRTLocalizationResult
} from './translationService';
import {
  analyzeDialectFromAudio,
  analyzeDialectFromTranscript,
  saveDialectProfileToR2,
  loadExistingDialectProfile,
} from './dialectService';
import {
  LocalizationResult,
  TARGET_LANGUAGES,
  TranslationMode,
  FormalityLevel,
  TRANSLATION_MODES,
  FORMALITY_OPTIONS,
  DictionaryLookup,
  TranslationHistoryItem,
  DialectProfile,
} from './types';
import { KnowledgeUploadPortal } from './KnowledgeUploadPortal';

const R2_ASSETS = 'https://pub-3907c38bb1b4451db0ac41139e7ac3c0.r2.dev/assets';
const ASSETS = {
  heroVideo: `${R2_ASSETS}/hero-v2.mp4`,
  laptopHand: `${R2_ASSETS}/laptop-and-hand-v4.png`,
  dualIntelligence: `${R2_ASSETS}/claude-openai-bg.png`,
};

// ============================================
// HAMBURGER MENU COMPONENT
// ============================================

const HamburgerMenu: React.FC<{
  polarisLinks?: Array<{ label: string; onClick: () => void }>;
  variant?: 'light' | 'dark';
}> = ({ polarisLinks, variant = 'dark' }) => {
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

  const iconColor = variant === 'dark' ? 'text-white' : 'text-neutral-900';
  const bgHover = variant === 'dark' ? 'hover:bg-white/10' : 'hover:bg-neutral-100';

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Navigation menu"
        className={`flex items-center justify-center w-11 h-11 rounded-xl ${bgHover} transition-colors`}
      >
        {open ? <X className={`w-5 h-5 ${iconColor}`} /> : <Menu className={`w-5 h-5 ${iconColor}`} />}
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
          {/* Polaris tool links */}
          {polarisLinks && polarisLinks.length > 0 && (
            <>
              <p className="px-5 pt-4 pb-2 text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">Polaris</p>
              {polarisLinks.map((link) => (
                <button
                  key={link.label}
                  onClick={() => { link.onClick(); setOpen(false); }}
                  className="block w-full text-left px-5 py-3 text-sm font-semibold text-neutral-300 hover:text-white hover:bg-white/8 transition-colors"
                >
                  {link.label}
                </button>
              ))}
            </>
          )}

        </div>
      )}
    </div>
  );
};

export default function PolarisApp() {
  const [currentView, setCurrentView] = useState<'landing' | 'tool' | 'admin'>('landing');
  return (
    <>
      {currentView === 'landing' ? (
        <LandingPage onNavigateToTool={() => { setCurrentView('tool'); window.scrollTo({ top: 0 }); }} />
      ) : currentView === 'admin' ? (
        <KnowledgeUploadPortal onNavigateHome={() => setCurrentView('tool')} />
      ) : (
        <ToolPage onNavigateHome={() => setCurrentView('landing')} onNavigateToAdmin={() => setCurrentView('admin')} />
      )}
    </>
  );
}

const Header: React.FC<{ onNavigateHome: () => void; onNavigateToTool: () => void }> = ({
  onNavigateHome,
  onNavigateToTool,
}) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-black/90 backdrop-blur-xl border-b border-white/10' : 'bg-transparent'
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
        <button
          onClick={onNavigateHome}
          className="text-white font-black text-lg sm:text-xl tracking-tight hover:opacity-80 uppercase"
        >
          POLARIS
        </button>
        <div className="flex items-center gap-4 sm:gap-8">
          <button onClick={onNavigateToTool} className="hidden sm:block text-white/70 hover:text-white text-base font-medium">
            Try it
          </button>
          <button className="hidden sm:block px-6 py-2.5 text-base font-medium text-white bg-white/10 hover:bg-white/20 rounded-full">
            Sign In
          </button>
          <HamburgerMenu
            polarisLinks={[
              { label: 'Start Translating', onClick: onNavigateToTool },
            ]}
          />
        </div>
      </div>
    </header>
  );
};

// Language Marquee - Slow scrolling "Hello" in 8 languages
const LanguageMarquee: React.FC = () => {
  const greetings = ['Hello', 'Hallo', 'Bonjour', 'Hola', '\u3053\u3093\u306B\u3061\u306F', '\u4F60\u597D', '\uC548\uB155\uD558\uC138\uC694', 'Ciao'];

  return (
    <div className="w-full bg-white overflow-hidden relative" style={{ height: '320px' }}>
      <div
        className="absolute left-0 flex"
        style={{
          top: '50%',
          animation: 'marquee 50s linear infinite',
        }}
      >
        {/* First set of 8 */}
        <div className="flex items-center flex-shrink-0 gap-36 px-12">
          {greetings.map((greeting, i) => (
            <span
              key={`a-${i}`}
              className="text-4xl md:text-5xl lg:text-6xl font-semibold text-neutral-900 whitespace-nowrap flex-shrink-0"
              style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' }}
            >
              {greeting}
            </span>
          ))}
        </div>
        {/* Second set of 8 (identical, for seamless loop) */}
        <div className="flex items-center flex-shrink-0 gap-36 px-12">
          {greetings.map((greeting, i) => (
            <span
              key={`b-${i}`}
              className="text-4xl md:text-5xl lg:text-6xl font-semibold text-neutral-900 whitespace-nowrap flex-shrink-0"
              style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' }}
            >
              {greeting}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0) translateY(-50%); }
          100% { transform: translateX(-50%) translateY(-50%); }
        }
      `}</style>
    </div>
  );
};

const LandingPage: React.FC<{ onNavigateToTool: () => void }> = ({ onNavigateToTool }) => {
  const [scrollY, setScrollY] = useState(0);
  const [glacierVisible, setGlacierVisible] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);
  const glacierRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target === glacierRef.current && entry.isIntersecting) setGlacierVisible(true);
          if (entry.target === ctaRef.current && entry.isIntersecting) setCtaVisible(true);
        });
      },
      { threshold: 0.15 }
    );
    if (glacierRef.current) observer.observe(glacierRef.current);
    if (ctaRef.current) observer.observe(ctaRef.current);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, []);

  const heroOpacity = Math.max(0, 1 - scrollY / 700);
  const heroScale = 1 + scrollY / 1500;
  const heroY = scrollY * 0.1;
  const heroBlur = Math.min(8, scrollY / 20);

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Header onNavigateHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })} onNavigateToTool={onNavigateToTool} />

      <section className="relative min-h-[80vh] flex items-center justify-center px-4 sm:px-12 pt-10 bg-black">
        <div
          className="text-center max-w-[1600px] mx-auto w-full"
          style={{
            opacity: heroOpacity,
            transform: `scale(${heroScale}) translateY(${-heroY}px)`,
            filter: `blur(${heroBlur}px)`,
            transition: 'filter 0.1s ease-out',
          }}
        >
          <p
            className="text-sm md:text-base lg:text-lg font-bold tracking-[0.5em] text-white uppercase mb-6"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' }}
          >
            INTRODUCING
          </p>
          <h1 className="text-[3rem] sm:text-[4rem] md:text-[5.5rem] lg:text-[7rem] font-black tracking-tight leading-none mb-6 px-4 uppercase">
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent block">
              Polaris
            </span>
          </h1>
          <p className="text-base md:text-lg lg:text-xl text-neutral-400 font-medium max-w-3xl mx-auto mb-10">
            The True North for enterprise-grade localization and high-fidelity verification.
          </p>
          <button
            onClick={onNavigateToTool}
            className="group px-8 py-3.5 bg-white text-black font-bold text-base rounded-full hover:bg-white/90 hover:scale-105 transition-all shadow-2xl"
          >
            Start Translating
          </button>
        </div>
      </section>

      <div className="-mt-16">
        <LanguageMarquee />
      </div>

      <section className="relative w-full bg-black overflow-hidden flex flex-col items-center">
        <div className="w-full max-w-[1400px] text-center pt-32 px-8 z-10">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-black leading-none uppercase tracking-tighter mb-6">
            <span className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">Global. </span>
            <span className="text-neutral-400">Local. </span>
            <span className="text-blue-500">Seamless.</span>
          </h2>
          <p className="text-lg md:text-xl text-neutral-400 font-medium max-w-3xl mx-auto leading-relaxed mb-2">
            Polaris combines global reach with local nuance, turning complex multilingual reviews into a single, seamless workflow
            you can rely on.
          </p>
        </div>

        <div className="w-full max-w-[1400px] grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-10 pt-12 sm:pt-16 pb-20 sm:pb-32 px-4 sm:px-8 z-10">
          <div className="text-center animate-reveal" style={{ animationDelay: '0.1s' }}>
            <p className="text-5xl md:text-6xl lg:text-7xl font-black" style={{ color: '#ffffff', textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
              30<span className="text-blue-400">+</span>
            </p>
            <p className="text-lg font-bold tracking-[0.3em] text-neutral-300 uppercase mt-4">Languages</p>
          </div>
          <div className="text-center animate-reveal" style={{ animationDelay: '0.2s' }}>
            <p className="text-5xl md:text-6xl lg:text-7xl font-black" style={{ color: '#ffffff', textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
              100<span className="text-blue-400">%</span>
            </p>
            <p className="text-lg font-bold tracking-[0.3em] text-neutral-300 uppercase mt-4">Accuracy</p>
          </div>
          <div className="text-center animate-reveal" style={{ animationDelay: '0.3s' }}>
            <p className="text-5xl md:text-6xl lg:text-7xl font-black" style={{ color: '#ffffff', textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
              2<span className="text-blue-400">x</span>
            </p>
            <p className="text-lg font-bold tracking-[0.3em] text-neutral-300 uppercase mt-4">Models</p>
          </div>
          <div className="text-center animate-reveal" style={{ animationDelay: '0.4s' }}>
            <p className="text-5xl md:text-6xl lg:text-7xl font-black" style={{ color: '#ffffff', textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>3</p>
            <p className="text-lg font-bold tracking-[0.3em] text-neutral-300 uppercase mt-4">QA Rounds</p>
          </div>
        </div>
      </section>

      <section className="relative w-screen bg-black overflow-hidden min-h-[80vh] flex items-center">
        <img src={ASSETS.dualIntelligence} alt="Dual AI Background" className="absolute inset-0 w-full h-full object-cover" />
        <div className="relative z-10 w-full px-8 md:pl-[5%]">
          <div className="text-left">
            <p className="text-base md:text-lg font-bold tracking-[0.5em] text-blue-500 uppercase mb-6">Dual Intelligence</p>
            <h2 className="text-5xl md:text-7xl font-black text-white leading-none uppercase tracking-tighter mb-4 whitespace-nowrap">
              Two minds.
            </h2>
            <h2 className="text-5xl md:text-7xl font-black text-neutral-500 leading-none uppercase tracking-tighter mb-8 whitespace-nowrap">
              One mission.
            </h2>
            <p className="text-lg md:text-xl text-neutral-400 font-medium leading-relaxed max-w-[500px]">
              Claude translates. ChatGPT verifies. Together, they achieve what neither could alone.
            </p>
          </div>
        </div>
      </section>

      <section className="pt-40 pb-28 bg-white">
        <div className="max-w-[1400px] mx-auto px-8">
          <div className="text-center mb-20">
            <p className="text-lg md:text-xl font-semibold tracking-[0.3em] text-neutral-400 uppercase mb-6">The Process</p>
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-black text-neutral-900 leading-none uppercase">
              Translate. Verify.
              <br />
              <span className="bg-gradient-to-r from-blue-500 to-blue-400 bg-clip-text text-transparent">Perfect.</span>
            </h2>
          </div>
          <div className="space-y-6">
            {[
              { num: '01', title: 'Upload anything', desc: 'Text, documents, video, audio. Our engine extracts and processes it all.' },
              { num: '02', title: 'Intelligent translation', desc: 'Claude translates with full context awareness, applying industry glossaries and cultural rules.' },
              { num: '03', title: 'Back-translation check', desc: 'The translation is converted back to English. If meaning drifted, we catch it.' },
              { num: '04', title: 'GPT-5.2 audit', desc: 'Every word is scrutinized. Terminology, tone, accuracy-nothing escapes review.' },
              { num: '05', title: 'Consensus or iterate', desc: 'If both models agree: ship it. If not: revise and retry. Up to 3 rounds until perfect.' },
            ].map((step, i) => {
              // Alternating: even rows → number(white) | text(grey), odd rows → text(grey) | number(white)
              const isReversed = i % 2 === 1;
              return (
                <div
                  key={i}
                  className={`flex flex-col md:flex-row items-stretch rounded-2xl overflow-hidden ${
                    isReversed ? 'md:flex-row-reverse' : ''
                  }`}
                >
                  {/* Number side - white background */}
                  <div className="w-full md:w-1/2 flex justify-center items-center py-14 px-8 bg-white">
                    <span className="text-[100px] md:text-[130px] font-black leading-none bg-gradient-to-br from-blue-600 via-blue-400 to-blue-200 bg-clip-text text-transparent block">
                      {step.num}
                    </span>
                  </div>
                  {/* Text side - grey background */}
                  <div className="w-full md:w-1/2 flex flex-col justify-center py-14 px-8 md:px-14 bg-neutral-100">
                    <h3 className="text-3xl md:text-4xl font-black text-neutral-900 mb-4 leading-tight">{step.title}</h3>
                    <p className="text-lg text-neutral-600 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section ref={glacierRef} className="py-24 bg-black relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.15)_0%,_transparent_70%)]" />
        </div>
        <div
          className={`max-w-[1400px] mx-auto px-8 relative z-10 transition-all duration-[1200ms] ease-out transform ${
            glacierVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-24'
          }`}
        >
          <div className="text-center mb-20">
            <p className="text-base md:text-lg font-semibold tracking-[0.3em] text-blue-400 uppercase mb-6">Glacier Core</p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-white leading-none uppercase tracking-tighter">
              Architecture of <br />
              <span className="text-neutral-500">Silence.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="group relative p-10 rounded-[32px] bg-neutral-900/40 backdrop-blur-3xl border border-white/15 transition-all duration-500 hover:border-blue-500/40">
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-14 h-14 mb-8 border-2 border-blue-400 rounded-2xl flex items-center justify-center">
                  <div className="w-5 h-5 bg-blue-400 rounded-sm" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">Isolated Intelligence</h3>
                <p className="text-lg text-neutral-400 leading-relaxed font-medium">
                  Local optimization cycles. Your data is used exclusively to sharpen your specific outputs, never shared with external models.
                </p>
              </div>
            </div>
            <div className="group relative p-10 rounded-[32px] bg-neutral-900/40 backdrop-blur-3xl border border-white/15 transition-all duration-500 hover:border-purple-500/40">
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-14 h-14 mb-8 border-2 border-purple-400 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-ping" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">Neural Governance</h3>
                <p className="text-lg text-neutral-400 leading-relaxed font-medium">
                  Enterprise-grade audit logs. Dual-modality intelligence scrutinizes every segment for regulatory compliance.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={ctaRef} className="py-24 bg-white relative overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-neutral-50 to-white opacity-40 pointer-events-none" />

        <div
          className={`text-center max-w-[1500px] mx-auto px-8 transition-all duration-[1200ms] ease-out transform z-10 ${
            ctaVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-24'
          }`}
        >
          <p className="text-sm font-bold tracking-[0.5em] text-neutral-500 uppercase mb-8 drop-shadow-[0_10px_2px_rgba(0,0,0,0.08)]">
            The Future is Polaris
          </p>

          <h2
            className="text-4xl md:text-[6rem] font-black text-black mb-14 leading-[0.9] uppercase tracking-tighter
            drop-shadow-[0_12px_2px_rgba(0,0,0,0.06)]
            drop-shadow-[0_24px_6px_rgba(0,0,0,0.12)]"
          >
            READY TO GO <br />
            GLOBAL?
          </h2>

          <button
            onClick={onNavigateToTool}
            className="group relative px-10 py-4 bg-black text-white font-bold text-base rounded-full transition-all duration-500
              hover:scale-105 hover:-translate-y-2 hover:bg-neutral-900 active:scale-95
              shadow-[0_15px_10px_-8px_rgba(0,0,0,0.25)]
              hover:shadow-[0_25px_10px_-10px_rgba(0,0,0,0.2)]"
          >
            Start Translating
          </button>
        </div>
      </section>

      <footer className="py-8 bg-black border-t border-white/10">
        <div className="max-w-[1400px] mx-auto px-8 flex items-center justify-between">
          <span className="text-sm font-bold text-white tracking-widest uppercase">POLARIS</span>
          <p className="text-neutral-500 text-xs font-medium tracking-wider uppercase">&copy; 2026 Polaris Global</p>
        </div>
      </footer>

      <style>{`
        @keyframes reveal {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-reveal {
          animation: reveal 1s ease-out forwards;
          opacity: 0;
        }
        .video-smooth-loop { object-fit: cover; }
      `}</style>
    </div>
  );
};

// ===== TOOL PAGE - KEEPING ALL ORIGINAL FUNCTIONALITY WITH POLARIS STYLING =====
const ToolPage: React.FC<{ onNavigateHome: () => void; onNavigateToAdmin: () => void }> = ({ onNavigateHome, onNavigateToAdmin }) => {
  const [sourceTab, setSourceTab] = useState<'text' | 'documents' | 'media'>('text');
  const [textInput, setTextInput] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [translationMode, setTranslationMode] = useState<TranslationMode>('cybersecurity');
  const [formalityLevel, setFormalityLevel] = useState<FormalityLevel>('formal');
  const [customPrompt, setCustomPrompt] = useState('');
  const [formalityDropdownOpen, setFormalityDropdownOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [processingDetail, setProcessingDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, LocalizationResult> | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<'connected' | 'disconnected' | 'testing'>('testing');
  const [openaiStatus, setOpenaiStatus] = useState<'connected' | 'disconnected' | 'testing'>('testing');
  const [dictionaryLookup, setDictionaryLookup] = useState<DictionaryLookup | null>(null);
  const [showDictionary, setShowDictionary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<TranslationHistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [showModeTooltip, setShowModeTooltip] = useState<string | null>(null);
  const [cardsVisible, setCardsVisible] = useState(false);
  const [srtMode, setSrtMode] = useState(false);
  const [srtResults, setSrtResults] = useState<Record<string, SRTLocalizationResult> | null>(null);
  const [dialectMode, setDialectMode] = useState(false);
  const [dialectFile, setDialectFile] = useState<File | null>(null);
  const [dialectTranscript, setDialectTranscript] = useState('');
  const [dialectInputMode, setDialectInputMode] = useState<'audio' | 'transcript'>('audio');
  const [dialectTitle, setDialectTitle] = useState('');
  const [dialectLanguage, setDialectLanguage] = useState('');
  const [dialectProfile, setDialectProfile] = useState<DialectProfile | null>(null);
  const [dialectSaved, setDialectSaved] = useState(false);
  const [dialectExisting, setDialectExisting] = useState<DialectProfile | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const dialectInputRef = useRef<HTMLInputElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const formalityDropdownRef = useRef<HTMLDivElement>(null);

  const stats =
    result && Object.values(result)[0]
      ? {
          status: Object.values(result)[0].verification?.status || 'UNKNOWN',
          score:
            Object.values(result)[0].consensusData?.finalScore ||
            Object.values(result)[0].verification?.technical_accuracy_score ||
            0,
          rounds: Object.values(result)[0].consensusData?.totalRounds || 0,
          time: (Object.values(result)[0].metadata.processing_time_ms / 1000).toFixed(1) || '0',
          segments: Object.values(result)[0].segments?.length || 0,
        }
      : null;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(e.target as Node)) setLanguageDropdownOpen(false);
      if (formalityDropdownRef.current && !formalityDropdownRef.current.contains(e.target as Node)) setFormalityDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const test = async () => {
      const g = await verifyClaudeConnection();
      setClaudeStatus(g.success ? 'connected' : 'disconnected');
      const o = await verifyOpenAIConnection();
      setOpenaiStatus(o.success ? 'connected' : 'disconnected');
    };
    test();
    setHistoryItems(getHistory().items || []);
  }, []);

  useEffect(() => {
    if (result) setTimeout(() => setCardsVisible(true), 100);
    else setCardsVisible(false);
  }, [result]);

  const handleReset = () => {
    setTextInput('');
    setExtractedText('');
    setUploadedFile(null);
    setProjectTitle('');
    setTargetLanguages([]);
    setError(null);
    setResult(null);
    setCardsVisible(false);
    setSourceTab('text');
    setTranslationMode('cybersecurity');
    setFormalityLevel('formal');
    setCustomPrompt('');
    setShowDictionary(false);
    setDictionaryLookup(null);
    setSrtMode(false);
    setSrtResults(null);
    setDialectMode(false);
    setDialectFile(null);
    setDialectTranscript('');
    setDialectTitle('');
    setDialectLanguage('');
    setDialectProfile(null);
    setDialectSaved(false);
    setDialectExisting(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setError(null);
    if (!projectTitle) setProjectTitle(file.name.replace(/\.[^/.]+$/, ''));

    if (isSRTFile(file)) {
      setSrtMode(true);
      const text = await readFileAsText(file);
      setExtractedText(text);
      return;
    }

    setSrtMode(false);
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'txt' || ext === 'md') setExtractedText(await file.text());
    else setExtractedText('');
  };

  const handleTranslate = async () => {
    if (!textInput.trim() && !uploadedFile) {
      setError('Please enter text or upload a file');
      return;
    }
    if (targetLanguages.length === 0) {
      setError('Please select a target language');
      return;
    }
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setCardsVisible(false);

    try {
      // processLocalization expects 8 arguments
      const results = await processLocalization(
        uploadedFile || textInput,
        sourceTab === 'media' ? 'video' : 'text',
        [],
        targetLanguages,
        translationMode,
        formalityLevel,
        translationMode === 'custom' ? customPrompt : undefined,
        (stage, detail) => {
          setProcessingStage(stage);
          setProcessingDetail(detail || '');
        }
      );

      setResult(results);
      Object.entries(results).forEach(([lang, res]) => saveToHistory(res, lang));
      const updatedHistory = getHistory().items || [];
      setHistoryItems(updatedHistory);
      if (updatedHistory.length > 0) setActiveHistoryId(updatedHistory[0].id);
    } catch (err: any) {
      setError(err.message || 'Translation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSRTTranslate = async () => {
    if (!uploadedFile || !srtMode) return;
    if (targetLanguages.length === 0) {
      setError('Please select at least one target language');
      return;
    }
    setIsProcessing(true);
    setError(null);
    setSrtResults(null);
    setResult(null);

    try {
      const srtContent = extractedText || await readFileAsText(uploadedFile);
      const results = await processSRTLocalization(
        srtContent,
        targetLanguages,
        translationMode,
        formalityLevel,
        translationMode === 'custom' ? customPrompt : undefined,
        (stage, detail) => {
          setProcessingStage(stage);
          setProcessingDetail(detail || '');
        }
      );
      setSrtResults(results);
    } catch (err: any) {
      setError(err.message || 'SRT translation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadSRT = (lang: string, srtContent: string) => {
    const baseName = uploadedFile?.name.replace(/\.srt$/i, '') || 'translation';
    const langSlug = lang.toLowerCase().replace(/[^a-z]/g, '-');
    const filename = `${baseName}_${langSlug}.srt`;
    const blob = new Blob([srtContent], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllSRT = () => {
    if (!srtResults) return;
    Object.entries(srtResults).forEach(([lang, res]) => {
      setTimeout(() => handleDownloadSRT(lang, res.srtContent), 100);
    });
  };

  const handleDialectFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDialectFile(file);
    if (!dialectTitle) setDialectTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const handleDialectAnalyze = async () => {
    if (!dialectLanguage) {
      setError('Select a language for dialect analysis');
      return;
    }
    if (dialectInputMode === 'audio' && !dialectFile) {
      setError('Upload an audio file for analysis');
      return;
    }
    if (dialectInputMode === 'transcript' && !dialectTranscript.trim()) {
      setError('Paste a transcript for analysis');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setDialectProfile(null);
    setDialectSaved(false);

    try {
      let profile: DialectProfile;
      if (dialectInputMode === 'audio' && dialectFile) {
        profile = await analyzeDialectFromAudio(
          dialectFile,
          dialectLanguage,
          (stage, detail) => {
            setProcessingStage(stage);
            setProcessingDetail(detail || '');
          }
        );
      } else {
        profile = await analyzeDialectFromTranscript(
          dialectTranscript,
          dialectLanguage,
          dialectTitle || 'Untitled',
          (stage, detail) => {
            setProcessingStage(stage);
            setProcessingDetail(detail || '');
          }
        );
      }
      setDialectProfile(profile);
    } catch (err: any) {
      setError(err.message || 'Dialect analysis failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDialectSave = async () => {
    if (!dialectProfile || !dialectLanguage) return;
    setIsProcessing(true);
    setError(null);

    try {
      await saveDialectProfileToR2(dialectProfile, dialectLanguage);
      setDialectSaved(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save dialect profile to R2');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDialectLoadExisting = async () => {
    if (!dialectLanguage) return;
    try {
      const existing = await loadExistingDialectProfile(dialectLanguage);
      setDialectExisting(existing);
    } catch {
      setDialectExisting(null);
    }
  };

  // Keeps your existing lookup logic, but now App passes it the correct target language via wrapper
  const handleWordSelect = async (word: string, targetLang: string) => {
    try {
      const lookup = await lookupWord(word, targetLang);
      setDictionaryLookup(lookup);
      setShowDictionary(true);
    } catch (err) {
      console.error('Dictionary lookup failed:', err);
    }
  };

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const handleWordReplace = (original: string, replacement: string) => {
    if (!result) return;
    const updated = { ...result };
    const safe = escapeRegExp(original);

    Object.keys(updated).forEach((lang) => {
      updated[lang] = {
        ...updated[lang],
        finalScript: updated[lang].finalScript.replace(new RegExp(`\\b${safe}\\b`, 'g'), replacement),
      };
    });

    setResult(updated);
  };

  // === EDIT HANDLERS ===

  const handleSourceEdit = (newSource: string) => {
    if (!result) return;
    const updated = { ...result };
    Object.keys(updated).forEach((lang) => {
      updated[lang] = {
        ...updated[lang],
        originalFormat: newSource,
      };
    });
    setResult(updated);
    setTextInput(newSource);
  };

  const handleTargetEdit = (newTarget: string) => {
    if (!result) return;
    const updated = { ...result };
    Object.keys(updated).forEach((lang) => {
      updated[lang] = {
        ...updated[lang],
        finalScript: newTarget,
        segments: updated[lang].segments.length > 0
          ? [{ id: updated[lang].segments[0].id, source: updated[lang].originalFormat, target: newTarget }]
          : updated[lang].segments,
      };
    });
    setResult(updated);
  };

  const handleRetranslate = async (newSource: string) => {
    if (isProcessing) return;
    setTextInput(newSource);
    // Trigger re-translation with updated source
    setResult(null);
    setIsProcessing(true);
    setProcessingStage('translating');
    setProcessingDetail('Re-translating with edited source...');
    try {
      const results = await processLocalization(
        newSource,
        'text',
        [],
        targetLanguages,
        translationMode,
        formalityLevel,
        translationMode === 'custom' ? customPrompt : undefined,
        (stage: string, detail?: string) => {
          setProcessingStage(stage);
          if (detail) setProcessingDetail(detail);
        }
      );
      setResult(results);
    } catch (err: any) {
      console.error('Re-translation failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // === HISTORY HANDLERS ===

  const handleLoadHistory = (historyItem: TranslationHistoryItem) => {
    const stored = loadHistoryResult(historyItem.id);
    if (!stored) return;
    setResult({ [stored.lang]: stored.result });
    setActiveHistoryId(historyItem.id);
    // Check if this item was previously approved
    if (stored.approved) {
      setApprovedIds((prev) => new Set(prev).add(historyItem.id));
    }
    setShowHistory(false);
  };

  const handleDeleteHistory = (historyItemId: string) => {
    deleteHistoryItem(historyItemId);
    setHistoryItems(getHistory().items || []);
    if (activeHistoryId === historyItemId) {
      setActiveHistoryId(null);
    }
  };

  // === APPROVAL HANDLER ===

  const handleApprove = (approvedContent: LocalizationResult, lang: string) => {
    if (!activeHistoryId) return;

    // Mark as approved in state
    setApprovedIds((prev) => new Set(prev).add(activeHistoryId));

    // Build the training payload - captures the AI vs human diff
    const trainingRecord = {
      id: `approved-${Date.now()}`,
      historyId: activeHistoryId,
      approvedAt: new Date().toISOString(),
      targetLanguage: lang,
      sourceText: approvedContent.originalFormat,
      aiTranslation: approvedContent.originalAITranslation || approvedContent.finalScript,
      approvedTranslation: approvedContent.finalScript,
      score: approvedContent.consensusData?.finalScore || approvedContent.verification?.technical_accuracy_score || 0,
      rounds: approvedContent.consensusData?.totalRounds || 1,
      mode: approvedContent.metadata?.translation_mode || 'general',
      formality: approvedContent.metadata?.formality_level || 'formal',
      humanEdited: approvedContent.originalAITranslation !== approvedContent.finalScript,
      culturalFlags: approvedContent.culturalAnalysis?.items?.length || 0,
    };

    // Save to localStorage as backup, then flush to R2
    try {
      const queue = JSON.parse(localStorage.getItem('te_approval_queue') || '[]');
      queue.push(trainingRecord);
      localStorage.setItem('te_approval_queue', JSON.stringify(queue));

      fetch('/api/kb-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'flush-approvals',
          language: lang,
          data: { approvals: [trainingRecord] },
        }),
      })
        .then((res) => {
          if (res.ok) {
            try {
              const currentQueue = JSON.parse(localStorage.getItem('te_approval_queue') || '[]');
              const filtered = currentQueue.filter((r: any) => r.id !== trainingRecord.id);
              localStorage.setItem('te_approval_queue', JSON.stringify(filtered));
            } catch { /* ignore cleanup errors */ }
          }
        })
        .catch(() => {});
    } catch { /* localStorage full - ignore for now */ }

    // Mark in history metadata
    try {
      const stored = localStorage.getItem(`te_result_${activeHistoryId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.approved = true;
        parsed.approvedAt = trainingRecord.approvedAt;
        localStorage.setItem(`te_result_${activeHistoryId}`, JSON.stringify(parsed));
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      {/* Header with Polaris styling */}
      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
          <button onClick={onNavigateHome} className="text-white font-black text-lg sm:text-xl tracking-tight hover:opacity-80 uppercase">
            POLARIS
          </button>
          <div className="flex items-center gap-2 sm:gap-6">
            {/* Status dots, always visible but compact on mobile */}
            <div className="flex items-center gap-3 sm:gap-6 px-3 sm:px-6 py-2 bg-white/5 rounded-full border border-white/10">
              <StatusDot status={claudeStatus} label="Claude" />
              <StatusDot status={openaiStatus} label="OpenAI" />
            </div>
            {/* Desktop-only toolbar buttons */}
            <button onClick={() => setShowHistory(true)} className="hidden md:flex items-center gap-2 p-3 hover:bg-white/10 rounded-xl transition-colors">
              <Clock className="w-5 h-5 text-white" />
              <span className="text-white text-sm font-medium">History</span>
            </button>
            <button onClick={onNavigateToAdmin} className="hidden md:flex items-center gap-2 p-3 hover:bg-white/10 rounded-xl transition-colors">
              <Upload className="w-5 h-5 text-white" />
              <span className="text-white text-sm font-medium">Knowledge</span>
            </button>
            <button onClick={handleReset} className="hidden md:flex items-center gap-2 p-3 hover:bg-white/10 rounded-xl transition-colors">
              <RotateCcw className="w-5 h-5 text-white" />
              <span className="text-white text-sm font-medium">Reset</span>
            </button>
            {/* Hamburger menu (always visible, essential on mobile) */}
            <HamburgerMenu
              polarisLinks={[
                { label: 'History', onClick: () => setShowHistory(true) },
                { label: 'Knowledge Portal', onClick: onNavigateToAdmin },
                { label: 'Reset', onClick: handleReset },
                { label: 'Home', onClick: onNavigateHome },
              ]}
            />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        {/* Hero Section with Pulsating POLARIS */}
        <div className="text-center mb-6 sm:mb-10">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-neutral-900 leading-none mb-4 tracking-tight uppercase select-none">
            POL
            <span className="inline-block pulsate-ai">A</span>R
            <span className="inline-block pulsate-ai" style={{ animationDelay: '0.5s' }}>
              I
            </span>
            S
          </h1>
        </div>

        {/* Configuration Section - Enhanced Polaris Styling */}
        <div className="bg-white rounded-2xl sm:rounded-[28px] shadow-2xl shadow-neutral-900/10 border border-neutral-200 overflow-visible mb-6 sm:mb-10">
          <div className="p-4 sm:p-8 border-b border-neutral-200 bg-gradient-to-br from-neutral-50 to-white">
            <h2 className="text-xl sm:text-2xl font-black text-neutral-900 mb-4 sm:mb-6 tracking-tight uppercase">Configure Translation</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Project Title */}
              <div>
                <label className="block text-sm font-bold text-neutral-700 mb-3 uppercase tracking-wider">Project Title</label>
                <input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="My Translation Project"
                  className="w-full px-5 py-4 text-lg bg-white border-2 border-neutral-200 rounded-2xl focus:outline-none focus:border-blue-500 transition-all font-medium text-neutral-900 placeholder:text-neutral-400"
                />
              </div>

              {/* Target Language */}
              <div className="relative">
                <label className="block text-sm font-bold text-neutral-700 mb-3 uppercase tracking-wider">
                  Target Language{srtMode ? 's' : ''} *
                  {srtMode && <span className="ml-2 text-xs font-medium text-blue-500 normal-case tracking-normal">(select multiple for batch SRT)</span>}
                </label>
                <div ref={languageDropdownRef} className="relative">
                  <button
                    onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                    className="w-full px-5 py-4 text-lg bg-white border-2 border-neutral-200 rounded-2xl hover:border-blue-400 transition-all flex items-center justify-between font-medium"
                  >
                    <span className={targetLanguages.length === 0 ? 'text-neutral-400' : 'text-neutral-900'}>
                      {targetLanguages.length === 0 ? 'Select language' : targetLanguages.join(', ')}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-neutral-500 transition-transform ${languageDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {languageDropdownOpen && (
                    <div className="absolute mt-2 w-full bg-white border-2 border-neutral-200 rounded-2xl shadow-2xl max-h-80 overflow-y-auto z-50">
                      {TARGET_LANGUAGES.map((lang) => (
                        <button
                          key={lang}
                          onClick={() => {
                            if (srtMode) {
                              setTargetLanguages((prev) =>
                                prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
                              );
                            } else {
                              setTargetLanguages([lang]);
                              setLanguageDropdownOpen(false);
                            }
                          }}
                          className="w-full px-5 py-4 text-left hover:bg-blue-50 flex items-center justify-between transition-colors"
                        >
                          <span className="font-medium text-neutral-900">{lang}</span>
                          {targetLanguages.includes(lang) && <Check className="w-5 h-5 text-blue-500" />}
                        </button>
                      ))}
                      {srtMode && (
                        <div className="border-t border-neutral-200 px-5 py-3">
                          <button
                            onClick={() => setLanguageDropdownOpen(false)}
                            className="w-full py-2 text-center font-bold text-blue-600 hover:text-blue-700 text-sm uppercase tracking-wider"
                          >
                            Done ({targetLanguages.length} selected)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Translation Mode */}
              <div>
                <label className="block text-sm font-bold text-neutral-700 mb-3 uppercase tracking-wider">Translation Mode</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 overflow-visible">
                  {TRANSLATION_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setTranslationMode(mode.id)}
                      onMouseEnter={() => setShowModeTooltip(mode.id)}
                      onMouseLeave={() => setShowModeTooltip(null)}
                      className={`relative overflow-visible px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${
                        translationMode === mode.id
                          ? 'bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-500/25'
                          : 'bg-white text-neutral-700 border-neutral-200 hover:border-blue-300'
                      }`}
                    >
                      {mode.label}
                      {showModeTooltip === mode.id && (
                        <div className="fixed-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-neutral-900 text-white text-sm rounded-lg whitespace-normal w-72 z-[100] shadow-xl pointer-events-none">
                          {mode.description}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-900" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                {translationMode === 'custom' && (
                  <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-200 rounded-2xl">
                    <label className="block text-sm font-bold text-neutral-700 mb-2">Custom Instructions</label>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Describe your specific translation requirements, industry terminology, or upload a glossary..."
                      className="w-full px-4 py-3 border border-neutral-300 rounded-xl focus:outline-none focus:border-blue-500 text-base resize-none"
                      rows={3}
                    />
                    <label className="block text-sm font-bold text-neutral-700 mt-3 mb-2">Upload Glossary (Optional)</label>
                    <input type="file" accept=".txt,.csv,.xlsx,.json" className="w-full text-sm" />
                  </div>
                )}
              </div>

              {/* Tone (was Formality Level) */}
              <div className="relative">
                <label className="block text-sm font-bold text-neutral-700 mb-3 uppercase tracking-wider">Tone</label>
                <div ref={formalityDropdownRef} className="relative">
                  <button
                    onClick={() => setFormalityDropdownOpen(!formalityDropdownOpen)}
                    className="w-full px-5 py-4 text-lg bg-white border-2 border-neutral-200 rounded-2xl hover:border-blue-400 transition-all flex items-center justify-between font-medium"
                  >
                    <span className="text-neutral-900">{FORMALITY_OPTIONS.find((f) => f.id === formalityLevel)?.label}</span>
                    <ChevronDown className={`w-5 h-5 text-neutral-500 transition-transform ${formalityDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {formalityDropdownOpen && (
                    <div className="absolute mt-2 w-full bg-white border-2 border-neutral-200 rounded-2xl shadow-2xl overflow-hidden z-50">
                      {FORMALITY_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            setFormalityLevel(option.id);
                            setFormalityDropdownOpen(false);
                          }}
                          className="w-full px-5 py-4 text-left hover:bg-blue-50 transition-colors"
                        >
                          <p className="font-semibold text-neutral-900">{option.label}</p>
                          <p className="text-sm text-neutral-600">{option.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Source Input with enhanced styling */}
          <div className="p-4 sm:p-8">
            <div className="flex gap-2 sm:gap-3 mb-4 sm:mb-6">
              {(['text', 'documents', 'media'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setSourceTab(tab); setSrtMode(false); setDialectMode(false); }}
                  className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base uppercase tracking-wide transition-all ${
                    sourceTab === tab && !srtMode && !dialectMode ? 'bg-neutral-900 text-white shadow-lg' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
              <button
                onClick={() => { setSourceTab('documents'); setSrtMode(true); setDialectMode(false); setUploadedFile(null); setExtractedText(''); }}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base uppercase tracking-wide transition-all ${
                  srtMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                SRT
              </button>
              <button
                onClick={() => { setDialectMode(true); setSrtMode(false); setUploadedFile(null); setExtractedText(''); }}
                className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base uppercase tracking-wide transition-all ${
                  dialectMode ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                Dialect
              </button>
            </div>

            {dialectMode ? (
              <div className="flex flex-col rounded-2xl border-2 border-purple-200 overflow-hidden" style={{ minHeight: '400px' }}>
                <div className="px-6 py-4 bg-purple-50 border-b-2 border-purple-200">
                  <span className="text-lg font-bold text-purple-900 uppercase tracking-wide">Dialect Calibration</span>
                  <p className="text-sm text-purple-600 mt-1">Analyze native-speaker reference material to build a dialect profile for more natural translations</p>
                </div>
                <div className="p-6 bg-white space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-bold text-neutral-700 mb-2 uppercase tracking-wider">Target Language *</label>
                      <select
                        value={dialectLanguage}
                        onChange={(e) => { setDialectLanguage(e.target.value); setDialectExisting(null); }}
                        className="w-full px-4 py-3 text-base bg-white border-2 border-neutral-200 rounded-xl focus:outline-none focus:border-purple-500 font-medium text-neutral-900"
                      >
                        <option value="">Select language...</option>
                        {TARGET_LANGUAGES.map((lang) => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </select>
                      {dialectLanguage && !dialectExisting && (
                        <button
                          onClick={handleDialectLoadExisting}
                          className="mt-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
                        >
                          Check for existing profile
                        </button>
                      )}
                      {dialectExisting && (
                        <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                          <p className="text-sm font-bold text-purple-800">Existing profile found</p>
                          <p className="text-xs text-purple-600 mt-1">
                            Analyzed: {dialectExisting.source_material.analyzed_date} | Source: {dialectExisting.source_material.title}
                          </p>
                          <p className="text-xs text-purple-500 mt-1">New analysis will replace this profile.</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-neutral-700 mb-2 uppercase tracking-wider">Reference Title</label>
                      <input
                        type="text"
                        value={dialectTitle}
                        onChange={(e) => setDialectTitle(e.target.value)}
                        placeholder="e.g. DACH Security Awareness Training"
                        className="w-full px-4 py-3 text-base bg-white border-2 border-neutral-200 rounded-xl focus:outline-none focus:border-purple-500 font-medium text-neutral-900 placeholder:text-neutral-400"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex gap-3 mb-4">
                      {(['audio', 'transcript'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setDialectInputMode(mode)}
                          className={`px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wide transition-all ${
                            dialectInputMode === mode
                              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }`}
                        >
                          {mode === 'audio' ? 'Audio File' : 'Paste Transcript'}
                        </button>
                      ))}
                    </div>

                    {dialectInputMode === 'audio' ? (
                      <div>
                        <input
                          ref={dialectInputRef}
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac,.mp3,.wav,.m4a,.ogg,.flac"
                          onChange={handleDialectFileUpload}
                          className="hidden"
                        />
                        {dialectFile ? (
                          <div className="flex items-center gap-4 p-4 bg-purple-50 border-2 border-purple-200 rounded-xl">
                            <svg className="w-10 h-10 text-purple-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-neutral-900 truncate">{dialectFile.name}</p>
                              <p className="text-sm text-neutral-500">{(dialectFile.size / (1024 * 1024)).toFixed(1)} MB</p>
                            </div>
                            <button
                              onClick={() => setDialectFile(null)}
                              className="text-red-500 hover:text-red-600 font-bold text-sm"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => dialectInputRef.current?.click()}
                            className="w-full flex flex-col items-center gap-4 p-10 border-4 border-dashed border-purple-300 rounded-2xl hover:border-purple-500 hover:bg-purple-50/50 transition-all"
                          >
                            <svg className="w-12 h-12 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                            <div className="text-center">
                              <p className="text-lg font-bold text-neutral-700">Upload audio file</p>
                              <p className="text-sm text-neutral-500 mt-1">MP3, WAV, M4A, OGG, FLAC</p>
                            </div>
                          </button>
                        )}
                      </div>
                    ) : (
                      <textarea
                        value={dialectTranscript}
                        onChange={(e) => setDialectTranscript(e.target.value)}
                        placeholder="Paste a transcript of a native speaker discussing cybersecurity topics. The more natural speech patterns present, the better the dialect profile will be."
                        className="w-full px-4 py-3 border-2 border-neutral-200 rounded-xl focus:outline-none focus:border-purple-500 text-base resize-none font-mono text-neutral-900 placeholder:text-neutral-400"
                        rows={8}
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : srtMode ? (
              <div className="flex flex-col rounded-2xl border-2 border-blue-200 overflow-hidden" style={{ minHeight: '400px' }}>
                <div className="px-6 py-4 bg-blue-50 border-b-2 border-blue-200 flex items-center justify-between">
                  <div>
                    <span className="text-lg font-bold text-blue-900 uppercase tracking-wide">SRT Subtitle Translation</span>
                    <p className="text-sm text-blue-600 mt-1">Upload an English .srt file to generate translated subtitles</p>
                  </div>
                  {targetLanguages.length > 0 && (
                    <span className="px-3 py-1 bg-blue-600 text-white text-sm font-bold rounded-full">
                      {targetLanguages.length} language{targetLanguages.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-center p-10 bg-white">
                  <input
                    ref={srtInputRef}
                    type="file"
                    accept=".srt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {isProcessing ? (
                    <div className="text-center">
                      <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto mb-6" />
                      <p className="text-2xl font-bold text-neutral-700 mb-2">{processingStage}</p>
                      <p className="text-lg text-neutral-500">{processingDetail}</p>
                    </div>
                  ) : uploadedFile ? (
                    <div className="text-center w-full max-w-2xl">
                      <svg className="w-20 h-20 mx-auto mb-6 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="2" y1="13" x2="10" y2="13" />
                        <line x1="2" y1="17" x2="8" y2="17" />
                        <line x1="2" y1="9" x2="6" y2="9" />
                      </svg>
                      <p className="text-2xl font-bold text-neutral-900 mb-2">{uploadedFile.name}</p>
                      <p className="text-lg text-neutral-500 mb-4">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                      {extractedText && (
                        <div className="mt-4 p-4 bg-neutral-50 rounded-2xl max-h-48 overflow-y-auto text-left font-mono text-sm text-neutral-600 whitespace-pre-wrap">
                          {extractedText.substring(0, 1500)}
                          {extractedText.length > 1500 ? '\n...' : ''}
                        </div>
                      )}
                      <button
                        onClick={() => { setUploadedFile(null); setExtractedText(''); setSrtResults(null); }}
                        className="mt-6 px-6 py-3 text-red-500 hover:text-red-600 text-lg font-bold transition-colors"
                      >
                        Remove File
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => srtInputRef.current?.click()}
                      className="flex flex-col items-center gap-6 p-16 border-4 border-dashed border-blue-300 rounded-3xl hover:border-blue-500 hover:bg-blue-50/50 transition-all"
                    >
                      <svg className="w-16 h-16 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="2" y1="13" x2="10" y2="13" />
                        <line x1="2" y1="17" x2="8" y2="17" />
                        <line x1="2" y1="9" x2="6" y2="9" />
                      </svg>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-neutral-700 mb-2">Upload SRT file</p>
                        <p className="text-lg text-neutral-500">English master subtitle file (.srt)</p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            ) : sourceTab === 'text' ? (
              <div className="flex flex-col rounded-2xl border-2 border-neutral-200 overflow-hidden" style={{ minHeight: '400px' }}>
                <div className="px-6 py-4 bg-neutral-50 border-b-2 border-neutral-200">
                  <span className="text-lg font-bold text-neutral-700 uppercase tracking-wide">Source Text</span>
                </div>
                <div className="flex-1 p-6 overflow-y-auto bg-white" style={{ minHeight: '350px' }}>
                  {isProcessing ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto mb-6" />
                        <p className="text-2xl font-bold text-neutral-700 mb-2">{processingStage}</p>
                        <p className="text-lg text-neutral-500">{processingDetail}</p>
                      </div>
                    </div>
                  ) : result ? (
                    <p className="text-xl text-neutral-900 whitespace-pre-wrap leading-relaxed">{Object.values(result)[0]?.finalScript}</p>
                  ) : (
                    <textarea
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Enter text to translate..."
                      className="w-full h-full min-h-[350px] resize-none bg-transparent text-xl text-neutral-900 placeholder:text-neutral-400 focus:outline-none leading-relaxed"
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col rounded-2xl border-2 border-neutral-200 overflow-hidden" style={{ minHeight: '400px' }}>
                <div className="px-6 py-4 bg-neutral-50 border-b-2 border-neutral-200">
                  <span className="text-lg font-bold text-neutral-700 uppercase tracking-wide">
                    {sourceTab === 'documents' ? 'Upload Document' : 'Upload Media'}
                  </span>
                  {sourceTab === 'media' && (
                    <p className="text-sm text-neutral-500 mt-1">
                      Supports: Video (MP4, MOV, AVI), Audio (MP3, WAV, M4A), Images (PNG, JPG, JPEG)
                    </p>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-center p-10 bg-white">
                  <input
                    ref={sourceTab === 'documents' ? fileInputRef : mediaInputRef}
                    type="file"
                    accept={sourceTab === 'documents' ? '.txt,.md,.pdf,.png,.jpg,.jpeg,.doc,.docx' : 'video/*,audio/*,image/png,image/jpeg,image/jpg'}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {uploadedFile ? (
                    <div className="text-center">
                      {sourceTab === 'documents' ? (
                        <FileText className="w-20 h-20 text-blue-500 mx-auto mb-6" />
                      ) : uploadedFile.type.startsWith('video/') ? (
                        <Video className="w-20 h-20 text-blue-500 mx-auto mb-6" />
                      ) : uploadedFile.type.startsWith('image/') ? (
                        <ImageIcon className="w-20 h-20 text-blue-500 mx-auto mb-6" />
                      ) : (
                        <Video className="w-20 h-20 text-blue-500 mx-auto mb-6" />
                      )}
                      <p className="text-2xl font-bold text-neutral-900 mb-2">{uploadedFile.name}</p>
                      <p className="text-lg text-neutral-500 mb-6">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                      {extractedText && (
                        <div className="mt-6 p-6 bg-neutral-50 rounded-2xl max-w-2xl max-h-48 overflow-y-auto text-left">
                          <p className="text-base text-neutral-600 whitespace-pre-wrap leading-relaxed">
                            {extractedText.substring(0, 1000)}
                            {extractedText.length > 1000 ? '...' : ''}
                          </p>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setUploadedFile(null);
                          setExtractedText('');
                        }}
                        className="mt-6 px-6 py-3 text-red-500 hover:text-red-600 text-lg font-bold transition-colors"
                      >
                        Remove File
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => (sourceTab === 'documents' ? fileInputRef : mediaInputRef).current?.click()}
                      className="flex flex-col items-center gap-6 p-16 border-4 border-dashed border-neutral-300 rounded-3xl hover:border-blue-400 hover:bg-blue-50/50 transition-all"
                    >
                      {sourceTab === 'documents' ? (
                        <Upload className="w-16 h-16 text-neutral-400" />
                      ) : (
                        <div className="flex gap-4">
                          <Video className="w-16 h-16 text-neutral-400" />
                          <ImageIcon className="w-16 h-16 text-neutral-400" />
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-2xl font-bold text-neutral-700 mb-2">
                          {sourceTab === 'documents' ? 'Upload a document' : 'Upload media file'}
                        </p>
                        <p className="text-lg text-neutral-500">{sourceTab === 'documents' ? 'PDF, Word (.docx), TXT, images' : 'Video, Audio, or Image files'}</p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-8 p-6 bg-red-50 border-2 border-red-200 rounded-2xl">
                <div className="flex items-start gap-4">
                  <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-black text-red-800 text-xl mb-2">Issue Detected</p>
                    <p className="text-red-700 whitespace-pre-wrap text-lg leading-relaxed">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {dialectMode ? (
              !dialectProfile && (
                <div className="mt-12 flex justify-center">
                  <button
                    onClick={handleDialectAnalyze}
                    disabled={isProcessing || !dialectLanguage || (dialectInputMode === 'audio' ? !dialectFile : !dialectTranscript.trim())}
                    className="px-12 py-5 bg-purple-600 hover:bg-purple-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black text-lg rounded-full transition-all flex items-center gap-3 shadow-2xl shadow-purple-600/20 hover:scale-105 disabled:hover:scale-100 uppercase tracking-wide"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-7 h-7 animate-spin" />
                        {processingStage === 'encoding' ? 'Encoding...' : processingStage === 'analyzing' ? 'Analyzing...' : 'Processing...'}
                      </>
                    ) : (
                      <>
                        Analyze Dialect
                        <ArrowRight className="w-7 h-7" />
                      </>
                    )}
                  </button>
                </div>
              )
            ) : srtMode ? (
              !srtResults && (
                <div className="mt-12 flex justify-center">
                  <button
                    onClick={handleSRTTranslate}
                    disabled={isProcessing || !uploadedFile || targetLanguages.length === 0}
                    className="px-12 py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black text-lg rounded-full transition-all flex items-center gap-3 shadow-2xl shadow-blue-600/20 hover:scale-105 disabled:hover:scale-100 uppercase tracking-wide"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-7 h-7 animate-spin" />
                        Generating SRT...
                      </>
                    ) : (
                      <>
                        Generate SRT
                        <ArrowRight className="w-7 h-7" />
                      </>
                    )}
                  </button>
                </div>
              )
            ) : (
              !result && (
                <div className="mt-12 flex justify-center">
                  <button
                    onClick={handleTranslate}
                    disabled={isProcessing || (!textInput.trim() && !uploadedFile) || targetLanguages.length === 0}
                    className="px-12 py-5 bg-black hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black text-lg rounded-full transition-all flex items-center gap-3 shadow-2xl shadow-black/20 hover:scale-105 disabled:hover:scale-100 uppercase tracking-wide"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-7 h-7 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Translate
                        <ArrowRight className="w-7 h-7" />
                      </>
                    )}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards with Polaris enhanced animation */}
      {result && stats && (
        <div className="bg-gradient-to-br from-neutral-50 to-white py-20">
          <div className="max-w-6xl mx-auto px-8">
            <p className="text-center text-neutral-500 text-lg mb-12 font-medium">
              Source: {uploadedFile?.name || 'Text input'} → {targetLanguages[0] || 'Target Language'}
            </p>
            <div className="flex justify-center items-center gap-6 flex-wrap">
              {[
                {
                  label: 'Status',
                  value: stats.status || 'PROCESSING',
                  color:
                    stats.status === 'PASS' || stats.status === 'FLAGGED'
                      ? 'text-emerald-500'
                      : stats.status === 'FAIL'
                      ? 'text-red-500'
                      : 'text-neutral-800',
                },
                {
                  label: 'Score',
                  value: `${stats.score || 0}/100`,
                  color: (stats.score || 0) >= 95 ? 'text-emerald-500' : (stats.score || 0) >= 85 ? 'text-amber-500' : 'text-red-500',
                },
                { label: 'Rounds', value: `${stats.rounds || 0}/3`, color: 'text-neutral-800' },
                { label: 'Time', value: `${stats.time || '0'}s`, color: 'text-neutral-800' },
                { label: 'Segments', value: (stats.segments || 0).toString(), color: 'text-neutral-800' },
              ].map((stat, i) => (
                <div
                  key={stat.label}
                  className={`rounded-3xl p-7 min-w-[150px] text-center transform transition-all duration-700 ease-out ${
                    cardsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
                  }`}
                  style={{
                    transitionDelay: `${i * 150}ms`,
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(147,197,253,0.15) 100%)',
                    border: '3px solid',
                    borderImage: 'linear-gradient(135deg, #3b82f6 0%, #93c5fd 100%) 1',
                    boxShadow: cardsVisible ? '0 12px 40px rgba(59,130,246,0.15)' : 'none',
                  }}
                >
                  <p className={`text-3xl font-black tracking-tight ${stat.color} mb-2`} style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
                    {stat.value}
                  </p>
                  <p className="text-sm font-bold text-neutral-500 uppercase tracking-[0.2em]">{stat.label}</p>
                </div>
              ))}
            </div>
            {stats.segments > 0 && (
              <p className="text-center text-neutral-500 text-sm mt-8">
                Segments are individual units of text (sentences, subtitles, or paragraphs) processed separately for maximum accuracy
              </p>
            )}
          </div>
        </div>
      )}

      {/* Results Section */}
      {result &&
        Object.entries(result).map(([lang, content]) => (
          <div key={lang} className="bg-neutral-100 py-16">
            <div className="max-w-6xl mx-auto px-8">
              <ResultViewer
                content={content}
                targetLanguage={lang}
                onWordSelect={(word, _language, _context) => handleWordSelect(word, lang)}
                onWordReplace={handleWordReplace}
                onSourceEdit={handleSourceEdit}
                onTargetEdit={handleTargetEdit}
                onRetranslate={handleRetranslate}
                projectTitle={projectTitle}
                sourceFileName={uploadedFile?.name}
                sourceType={sourceTab === 'media' ? 'media' : uploadedFile ? 'document' : 'text'}
                onApprove={handleApprove}
                isApproved={activeHistoryId ? approvedIds.has(activeHistoryId) : false}
              />
            </div>
          </div>
        ))}

      {srtResults && (
        <div className="bg-gradient-to-br from-blue-50 to-white py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-8">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="text-3xl font-black text-neutral-900 uppercase tracking-tight">SRT Results</h2>
                <p className="text-neutral-500 mt-2">
                  {uploadedFile?.name} translated into {Object.keys(srtResults).length} language{Object.keys(srtResults).length !== 1 ? 's' : ''}
                </p>
              </div>
              {Object.keys(srtResults).length > 1 && (
                <button
                  onClick={handleDownloadAllSRT}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full transition-all flex items-center gap-2 shadow-lg"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download All
                </button>
              )}
            </div>

            <div className="space-y-6">
              {Object.entries(srtResults).map(([lang, res]) => {
                const v = res.validationSummary;
                const allPass = v.failingCues === 0 && v.warningCues === 0;
                const hasFailures = v.failingCues > 0;

                return (
                  <div key={lang} className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                    <div className="px-6 py-5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-4 h-4 rounded-full ${allPass ? 'bg-emerald-500' : hasFailures ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <h3 className="text-xl font-black text-neutral-900 uppercase tracking-tight">{lang}</h3>
                        <span className="text-sm text-neutral-500">
                          {(res.processingTimeMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <button
                        onClick={() => handleDownloadSRT(lang, res.srtContent)}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-full transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download .srt
                      </button>
                    </div>

                    <div className="p-6">
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                        {[
                          { label: 'Cues', value: v.totalCues.toString(), color: 'text-neutral-800' },
                          { label: 'Passing', value: v.passingCues.toString(), color: 'text-emerald-600' },
                          { label: 'Warnings', value: v.warningCues.toString(), color: v.warningCues > 0 ? 'text-amber-600' : 'text-neutral-400' },
                          { label: 'Failures', value: v.failingCues.toString(), color: v.failingCues > 0 ? 'text-red-600' : 'text-neutral-400' },
                          { label: 'Avg CPS', value: v.avgCps.toFixed(1), color: 'text-neutral-800' },
                          { label: 'Max CPS', value: v.maxCps.toFixed(1), color: v.maxCps > 18 ? 'text-red-600' : 'text-neutral-800' },
                          { label: 'Abbrevs', value: v.srtShortSubstitutions.toString(), color: v.srtShortSubstitutions > 0 ? 'text-blue-600' : 'text-neutral-400' },
                        ].map((stat) => (
                          <div key={stat.label} className="text-center p-3 bg-neutral-50 rounded-xl">
                            <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                            <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mt-1">{stat.label}</p>
                          </div>
                        ))}
                      </div>

                      {v.recommendations.length > 0 && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                          <p className="font-bold text-amber-800 text-sm uppercase tracking-wider mb-2">Recommendations</p>
                          <ul className="space-y-1">
                            {v.recommendations.map((rec, i) => (
                              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <details className="group">
                        <summary className="cursor-pointer text-sm font-bold text-neutral-500 hover:text-neutral-700 uppercase tracking-wider flex items-center gap-2">
                          <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
                          Preview SRT output
                        </summary>
                        <div className="mt-4 p-4 bg-neutral-900 rounded-xl max-h-64 overflow-y-auto">
                          <pre className="text-sm text-neutral-300 font-mono whitespace-pre-wrap">{res.srtContent.substring(0, 3000)}{res.srtContent.length > 3000 ? '\n...' : ''}</pre>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {dialectProfile && (
        <div className="bg-gradient-to-br from-purple-50 to-white py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-8">
            <div className="flex items-center justify-between mb-10">
              <div>
                <h2 className="text-3xl font-black text-neutral-900 uppercase tracking-tight">Dialect Profile</h2>
                <p className="text-neutral-500 mt-2">
                  {dialectProfile.language} | Source: {dialectProfile.source_material.title} | Analyzed: {dialectProfile.source_material.analyzed_date}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {dialectSaved ? (
                  <span className="px-5 py-2.5 bg-emerald-100 text-emerald-700 font-bold text-sm rounded-full flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved to R2
                  </span>
                ) : (
                  <button
                    onClick={handleDialectSave}
                    disabled={isProcessing}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-neutral-300 text-white font-bold rounded-full transition-all flex items-center gap-2 shadow-lg"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                    Save to R2
                  </button>
                )}
                <button
                  onClick={() => {
                    const json = JSON.stringify(dialectProfile, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `dialect_profile_${dialectProfile.language.toLowerCase().replace(/[^a-z]/g, '-')}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="px-6 py-3 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold rounded-full transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download JSON
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Pacing */}
              <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                  <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Speech Pacing</h3>
                </div>
                <div className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  {[
                    { label: 'WPM Avg', value: dialectProfile.pacing.words_per_minute_avg.toString() },
                    { label: 'WPM Range', value: `${dialectProfile.pacing.words_per_minute_range[0]}-${dialectProfile.pacing.words_per_minute_range[1]}` },
                    { label: 'Pause Freq', value: dialectProfile.pacing.pause_frequency },
                    { label: 'Pause Avg', value: `${dialectProfile.pacing.pause_duration_avg_ms}ms` },
                    { label: 'Sentence Len', value: `${dialectProfile.pacing.sentence_length_avg_words} words` },
                    { label: 'Preferred CPS', value: dialectProfile.subtitle_pacing.preferred_cps.toString() },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center p-3 bg-neutral-50 rounded-xl">
                      <p className="text-xl font-black text-neutral-800">{stat.value}</p>
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mt-1">{stat.label}</p>
                    </div>
                  ))}
                </div>
                {dialectProfile.pacing.emphasis_pattern && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-neutral-600"><span className="font-bold">Emphasis:</span> {dialectProfile.pacing.emphasis_pattern}</p>
                  </div>
                )}
              </div>

              {/* Register */}
              <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                  <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Register and Tone</h3>
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { label: 'Formality', value: dialectProfile.register.formality_level },
                    { label: 'Address Form', value: dialectProfile.register.address_form },
                    { label: 'Directness', value: dialectProfile.register.directness },
                    { label: 'Humor', value: dialectProfile.register.humor_frequency },
                    { label: 'Hedging', value: dialectProfile.register.hedging_language },
                  ].filter(s => s.value).map((stat) => (
                    <div key={stat.label} className="p-4 bg-neutral-50 rounded-xl">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">{stat.label}</p>
                      <p className="text-base font-medium text-neutral-800">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Terminology */}
              <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                  <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Terminology in Practice</h3>
                </div>
                <div className="p-6 space-y-4">
                  {dialectProfile.terminology_in_practice.terms_used_as_english_loanwords.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-neutral-700 mb-2 uppercase tracking-wider">English Loanwords (kept as-is)</p>
                      <div className="flex flex-wrap gap-2">
                        {dialectProfile.terminology_in_practice.terms_used_as_english_loanwords.map((term, i) => (
                          <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg border border-blue-200">
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {dialectProfile.terminology_in_practice.terms_always_translated.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-neutral-700 mb-2 uppercase tracking-wider">Always Translated</p>
                      <div className="space-y-2">
                        {dialectProfile.terminology_in_practice.terms_always_translated.map((term, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-neutral-50 rounded-lg">
                            <span className="text-sm font-medium text-neutral-600">{term.en}</span>
                            <ArrowRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-neutral-900">{term.spoken_as}</span>
                            {term.note && <span className="text-xs text-neutral-500 ml-auto">({term.note})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {dialectProfile.terminology_in_practice.terms_with_regional_variation.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-neutral-700 mb-2 uppercase tracking-wider">Regional Variations</p>
                      <div className="space-y-2">
                        {dialectProfile.terminology_in_practice.terms_with_regional_variation.map((term, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-neutral-50 rounded-lg">
                            <span className="text-sm font-medium text-neutral-600">{term.en}</span>
                            <ArrowRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                            <span className="text-sm text-neutral-700">std: {term.standard}</span>
                            <span className="text-sm font-bold text-purple-700">spoken: {term.spoken}</span>
                            {term.note && <span className="text-xs text-neutral-500 ml-auto">({term.note})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Idioms */}
              {dialectProfile.idioms_observed.length > 0 && (
                <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                  <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                    <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Idioms Observed</h3>
                  </div>
                  <div className="p-6 space-y-3">
                    {dialectProfile.idioms_observed.map((idiom, i) => (
                      <div key={i} className="p-4 bg-neutral-50 rounded-xl">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-base font-bold text-neutral-900">{idiom.spoken_form}</p>
                            <p className="text-sm text-neutral-600 mt-1">EN: "{idiom.english_equivalent}"</p>
                            <p className="text-xs text-neutral-500 mt-1">Context: {idiom.context}</p>
                          </div>
                          <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-1 rounded-md flex-shrink-0">
                            {idiom.frequency}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice Characteristics */}
              <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                  <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Voice Characteristics</h3>
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { label: 'Pitch Range', value: dialectProfile.voice_characteristics.pitch_range },
                    { label: 'Speaking Style', value: dialectProfile.voice_characteristics.speaking_style },
                    { label: 'Energy Level', value: dialectProfile.voice_characteristics.energy_level },
                    { label: 'Accent Region', value: dialectProfile.voice_characteristics.accent_region },
                    { label: 'Breathing', value: dialectProfile.voice_characteristics.breathing_pattern },
                  ].filter(s => s.value).map((stat) => (
                    <div key={stat.label} className="p-4 bg-neutral-50 rounded-xl">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">{stat.label}</p>
                      <p className="text-base font-medium text-neutral-800">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subtitle Pacing */}
              <div className="bg-white rounded-2xl border-2 border-neutral-200 overflow-hidden shadow-lg">
                <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
                  <h3 className="text-lg font-black text-neutral-900 uppercase tracking-tight">Subtitle Pacing</h3>
                </div>
                <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-neutral-50 rounded-xl">
                    <p className="text-xl font-black text-neutral-800">{dialectProfile.subtitle_pacing.natural_cps_range[0]}-{dialectProfile.subtitle_pacing.natural_cps_range[1]}</p>
                    <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mt-1">CPS Range</p>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-xl border border-purple-200">
                    <p className="text-xl font-black text-purple-700">{dialectProfile.subtitle_pacing.preferred_cps}</p>
                    <p className="text-xs font-bold text-purple-500 uppercase tracking-wider mt-1">Preferred CPS</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl col-span-2">
                    <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Line Breaks</p>
                    <p className="text-sm font-medium text-neutral-800">{dialectProfile.subtitle_pacing.line_break_preference}</p>
                    {dialectProfile.subtitle_pacing.compound_noun_handling && (
                      <>
                        <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1 mt-2">Compound Nouns</p>
                        <p className="text-sm font-medium text-neutral-800">{dialectProfile.subtitle_pacing.compound_noun_handling}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Raw JSON Preview */}
              <details className="group">
                <summary className="cursor-pointer text-sm font-bold text-neutral-500 hover:text-neutral-700 uppercase tracking-wider flex items-center gap-2">
                  <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
                  View raw JSON
                </summary>
                <div className="mt-4 p-4 bg-neutral-900 rounded-xl max-h-96 overflow-y-auto">
                  <pre className="text-sm text-neutral-300 font-mono whitespace-pre-wrap">{JSON.stringify(dialectProfile, null, 2)}</pre>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {showDictionary && dictionaryLookup && (
        <DictionaryModal lookup={dictionaryLookup} onClose={() => setShowDictionary(false)} onReplace={handleWordReplace} />
      )}
      {showHistory && <HistorySidebar items={historyItems} activeId={activeHistoryId} approvedIds={approvedIds} onLoad={handleLoadHistory} onDelete={handleDeleteHistory} onClose={() => setShowHistory(false)} />}

      <style>{`
        @keyframes pulsate {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        .pulsate-ai {
          animation: pulsate 2s ease-in-out infinite;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
    </div>
  );
};

const StatusDot: React.FC<{ status: 'connected' | 'disconnected' | 'testing'; label: string }> = ({ status, label }) => (
  <div className="flex items-center gap-3">
    <div
      className={`w-3 h-3 rounded-full ${
        status === 'connected' ? 'bg-emerald-500' : status === 'testing' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
      }`}
    />
    <span className="text-base text-white font-medium">{label}</span>
  </div>
);

const DictionaryModal: React.FC<{ lookup: DictionaryLookup; onClose: () => void; onReplace: (original: string, replacement: string) => void }> = ({
  lookup,
  onClose,
  onReplace,
}) => {
  const [activeTab, setActiveTab] = useState<'alternatives' | 'dictionary'>('alternatives');
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-8 border-b border-neutral-200">
          <div className="flex items-center gap-5">
            <span className="font-black text-2xl text-neutral-900">{lookup.sourceWord}</span>
            <ArrowRight className="w-6 h-6 text-neutral-400" />
            <span className="font-black text-2xl text-blue-600">{lookup.targetWord}</span>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-neutral-100 rounded-xl transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex border-b border-neutral-200">
          {['alternatives', 'dictionary'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex-1 py-5 text-lg font-bold uppercase tracking-wide transition-all ${
                activeTab === tab ? 'text-blue-600 border-b-3 border-blue-600' : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="p-8 max-h-96 overflow-y-auto">
          {activeTab === 'alternatives' ? (
            <div className="space-y-4">
              {lookup.targetEntry?.alternatives?.length > 0 ? (
                lookup.targetEntry.alternatives.map((alt, i) => (
                  <div key={i} className="flex items-center justify-between p-5 bg-neutral-50 rounded-2xl hover:bg-neutral-100 transition-colors">
                    <span className="font-bold text-xl text-neutral-900">{alt}</span>
                    <button
                      onClick={() => {
                        onReplace(lookup.targetWord, alt);
                        onClose();
                      }}
                      className="px-5 py-3 text-base font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                    >
                      Replace
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-neutral-500 text-center py-12 text-xl">No alternatives found</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-neutral-500 text-lg font-medium">{lookup.targetEntry?.partOfSpeech}</p>
              {lookup.targetEntry?.definitions?.map((def, i) => (
                <p key={i} className="text-neutral-700 text-xl leading-relaxed">
                  {i + 1}. {def}
                </p>
              )) || <p className="text-neutral-500 text-center py-12 text-xl">No definitions found</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const HistorySidebar: React.FC<{
  items: TranslationHistoryItem[];
  activeId: string | null;
  approvedIds: Set<string>;
  onLoad: (item: TranslationHistoryItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}> = ({ items, activeId, approvedIds, onLoad, onDelete, onClose }) => (
  <div className="fixed inset-0 z-50 flex" onClick={onClose}>
    <div className="flex-1 bg-black/40 backdrop-blur-sm" />
    <div className="w-[460px] bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between p-8 border-b border-neutral-200">
        <div className="flex items-center gap-4">
          <Clock className="w-7 h-7 text-neutral-500" />
          <h2 className="font-black text-2xl text-neutral-900 uppercase tracking-tight">History</h2>
        </div>
        <button onClick={onClose} className="p-3 hover:bg-neutral-100 rounded-xl transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        {items.length === 0 ? (
          <div className="text-center py-20 text-neutral-500">
            <History className="w-20 h-20 mx-auto mb-6 opacity-50" />
            <p className="text-xl font-medium">No translations yet</p>
          </div>
        ) : (
          <div className="space-y-5">
            {items.map((item) => {
              const isCurrent = item.id === activeId;
              const isItemApproved = approvedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => onLoad(item)}
                  className={`p-6 rounded-2xl cursor-pointer transition-all ${
                    isCurrent
                      ? 'bg-blue-50 border-2 border-blue-300 shadow-sm'
                      : 'bg-neutral-50 border-2 border-transparent hover:bg-neutral-100 hover:border-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-neutral-500 font-medium">
                        {new Date(item.timestamp).toLocaleDateString()}{' '}
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isCurrent && (
                        <span className="px-2.5 py-0.5 text-xs font-black bg-blue-600 text-white rounded-full uppercase tracking-wide">
                          Current
                        </span>
                      )}
                      {isItemApproved && (
                        <span className="px-2.5 py-0.5 text-xs font-black bg-emerald-600 text-white rounded-full uppercase tracking-wide">
                          Approved
                        </span>
                      )}
                      {!isItemApproved && (
                        <span className="px-2.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-600 rounded-full uppercase tracking-wide">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-black px-3 py-1.5 rounded-full ${
                          item.status === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {item.score}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(item.id);
                        }}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        style={{ opacity: 0.4 }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                  <p className="text-base font-bold text-neutral-900 truncate mb-1">{item.sourcePreview}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-neutral-500 font-medium uppercase tracking-wide">{item.targetLanguage}</span>
                    <span className="text-xs text-neutral-400">|</span>
                    <span className="text-xs text-neutral-500">{item.mode}</span>
                    <span className="text-xs text-neutral-400">|</span>
                    <span className="text-xs text-neutral-500">{item.formality}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);