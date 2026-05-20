// ============================================
// ENUMS AND BASIC TYPES
// ============================================

export enum ContentType {
  TEXT = 'TEXT',
  DOCUMENT = 'DOCUMENT',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  IMAGE = 'IMAGE'
}

export type TranslationMode = 'cybersecurity' | 'general' | 'custom';

export type FormalityLevel = 'formal' | 'informal' | 'enthusiastic' | 'friendly' | 'confident' | 'diplomatic' | 'custom';

export const FORMALITY_OPTIONS: { id: FormalityLevel; label: string; description: string }[] = [
  { id: 'formal', label: 'Formal', description: 'Professional business tone with formal address (Sie/vous)' },
  { id: 'informal', label: 'Informal', description: 'Casual, conversational tone with informal address (du/tu)' },
  { id: 'enthusiastic', label: 'Enthusiastic', description: 'Energetic, excited tone for marketing or motivational content' },
  { id: 'friendly', label: 'Friendly', description: 'Warm, approachable tone that builds rapport' },
  { id: 'confident', label: 'Confident', description: 'Assertive, authoritative tone for leadership content' },
  { id: 'diplomatic', label: 'Diplomatic', description: 'Careful, tactful tone for sensitive communications' },
  { id: 'custom', label: 'Custom', description: 'Define your own tone with a custom prompt' }
];

export const TRANSLATION_MODES: { id: TranslationMode; label: string; description: string }[] = [
  {
    id: 'cybersecurity',
    label: 'Cybersecurity',
    description: 'Uses industry glossary with 200+ terms, cultural safeguards for privacy-sensitive regions, and ISACA/BSI-compliant terminology'
  },
  {
    id: 'general',
    label: 'General',
    description: 'High-quality translation without specialized terminology. Perfect for emails, documents, and everyday content'
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Upload your own glossary and style guide. Ideal for brand-specific terminology or specialized industries'
  }
];

// ============================================
// KNOWLEDGE BASE STRUCTURES
// ============================================

export interface GlossaryFile {
  name: string;
  content: string;
  languageCode: string;
  type: 'glossary' | 'styleguide' | 'dnt';
}

export interface GlossaryEntry {
  en: string;
  target_approved: string;
  phonetic?: string;
  srt_short?: string;
  note?: string;
  addedBy?: 'system' | 'user';
  dateAdded?: string;
}

export interface GlossaryMaster {
  language: string;
  style_rules: {
    register: string;
    address: string;
    ui_formatting: string;
  };
  entries: GlossaryEntry[];
}

export interface CulturalSafeguard {
  category: string;
  risk_term?: string;
  preferred_alternative?: string;
  rule?: string;
  target?: string;
  term?: string;
  forbidden_alternative?: string;
  required_term?: string;
  formatting?: string;
  example?: string;
  reasoning: string;
}

export interface IdiomMapping {
  en_idiom: string;
  target_equivalent: string;
  literal_target: string;
  application: string;
}

export interface QAOverride {
  english_original: string;
  approved_translation: string;
  date_added: string;
  source: string;
}

export interface SRTConstraints {
  constraints: {
    visual_formatting: {
      max_chars_per_line: number;
      max_lines_per_subtitle: number;
      forced_line_breaks: string;
    };
    timing_readability: {
      target_cps: number;
      min_subtitle_duration_sec: number;
      max_subtitle_duration_sec: number;
    };
    technical_enforcement: {
      ui_wrapping: string;
      hyphenation: string;
      mfa_acronym_rule: string;
    };
  };
}

export interface KnowledgeBase {
  glossary: GlossaryMaster;
  cultural_safeguards: { safeguards: CulturalSafeguard[] };
  idiom_map: { idioms: IdiomMapping[] };
  qa_overrides: { qa_updates: QAOverride[]; banned_variants: string[] };
  srt_constraints: SRTConstraints;
}

// ============================================
// CONSENSUS & AUDIT STRUCTURES
// ============================================

export interface AuditError {
  location: string;
  issue: string;
  current: string;
  suggested: string;
  severity: 'critical' | 'major' | 'minor';
  detectedBy: 'GPT-4o' | 'Claude' | 'System';
}

export interface AuditResult {
  status: 'PASS' | 'FAIL' | 'FLAGGED';
  score: number;
  errors: AuditError[];
  suggestions: string[];
  rawNotes: string;
  auditorModel: string;
}

export interface ConsensusRound {
  round: number;
  translation: string;
  backTranslation: string;
  auditResult: AuditResult;
  revisedBasedOn?: string[];
  timestamp: number;
}

export interface ConsensusResult {
  finalTranslation: string;
  finalBackTranslation: string;
  consensusReached: boolean;
  finalScore: number;
  totalRounds: number;
  rounds: ConsensusRound[];
  unresolvedIssues: AuditError[];
  humanReviewRequired: boolean;
  whyNotPerfect?: string;
}

// ============================================
// CULTURAL ANALYSIS
// ============================================

export interface CulturalAnalysisItem {
  id: string;
  timestamp?: string;
  category: 'gesture' | 'attire' | 'symbol' | 'color' | 'text' | 'audio' | 'behavior' | 'object' | 'other';
  element: string;
  concern: string;
  targetCultures: string[];
  severity: 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
  screenshot?: string;
}

export interface CulturalAnalysisReport {
  sourceType: 'video' | 'image' | 'text';
  targetLanguage: string;
  targetCulture: string;
  totalIssuesFound: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  items: CulturalAnalysisItem[];
  overallRiskLevel: 'safe' | 'caution' | 'review-required';
  summary: string;
}

// ============================================
// TRANSLATION OUTPUT STRUCTURES
// ============================================

export interface TranslationSegment {
  id: string;
  source: string;
  target: string;
  back_translation?: string;
  timing?: {
    start: number;
    end: number;
    duration: number;
  };
  used_srt_short?: boolean;
  formatting?: {
    isBold?: boolean;
    isItalic?: boolean;
    isHeading?: number;
    isList?: boolean;
    listType?: 'bullet' | 'numbered';
    indent?: number;
  };
}

export interface CulturalAuditFinding {
  timestamp?: string;
  term_or_phrase: string;
  decision: string;
  reasoning: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface VerificationReport {
  status: 'PASS' | 'FAIL' | 'FLAGGED';
  auditorNotes: string;
  auditorModel: string;
  technical_accuracy_score?: number;
}

export interface LocalizationResult {
  id: string;
  finalScript: string;
  originalFormat: string;
  originalAITranslation?: string;
  srtContent?: string;
  segments: TranslationSegment[];
  back_translation_full: string;
  cultural_audit: CulturalAuditFinding[];
  culturalAnalysis?: CulturalAnalysisReport;
  verification: VerificationReport;
  timingSyncStatus: 'locked' | 'exceeded' | 'optimized';
  consensusData?: ConsensusResult;
  metadata: {
    total_segments: number;
    srt_short_substitutions: number;
    qa_overrides_applied: number;
    processing_time_ms: number;
    consensus_rounds?: number;
    human_review_required?: boolean;
    translation_mode?: TranslationMode;
    formality_level?: FormalityLevel;
    source_type: ContentType;
    source_filename?: string;
  };
}

// ============================================
// DICTIONARY FEATURE
// ============================================

export interface DictionaryEntry {
  word: string;
  language: string;
  partOfSpeech: string;
  gender?: string;
  definitions: string[];
  examples: { source: string; translation: string }[];
  alternatives: string[];
  pronunciation?: string;
}

export interface DictionaryLookup {
  sourceWord: string;
  sourceLanguage: string;
  targetWord: string;
  targetLanguage: string;
  sourceEntry: DictionaryEntry;
  targetEntry: DictionaryEntry;
}

// ============================================
// TRANSLATION HISTORY
// ============================================

export interface TranslationHistoryItem {
  id: string;
  timestamp: number;
  sourceLanguage: string;
  targetLanguage: string;
  sourcePreview: string;
  targetPreview: string;
  sourceType: ContentType;
  fileName?: string;
  score: number;
  status: 'PASS' | 'FAIL' | 'FLAGGED';
  mode: TranslationMode;
  formality: FormalityLevel;
  resultId: string;
}

export interface TranslationHistory {
  items: TranslationHistoryItem[];
  totalCount: number;
  lastUpdated: number;
}

// ============================================
// GLOSSARY MANAGEMENT
// ============================================

export interface UserGlossary {
  id: string;
  name: string;
  description?: string;
  language: string;
  entries: GlossaryEntry[];
  createdAt: number;
  updatedAt: number;
  isDefault: boolean;
}

export interface GlossaryAddRequest {
  sourceText: string;
  targetText: string;
  glossaryId: string;
  note?: string;
}

// ============================================
// APP STATE
// ============================================

export interface ProcessingResult {
  results: Record<string, LocalizationResult>;
  timestamp: number;
}

export interface AppState {
  targetLanguages: string[];
  glossaries: UserGlossary[];
  selectedGlossaryId?: string;
  isProcessing: boolean;
  error: string | null;
  result: ProcessingResult | null;
  processingStage: string;
  processingDetail?: string;
  translationMode: TranslationMode;
  formalityLevel: FormalityLevel;
  customFormalityPrompt?: string;

  connectionStatus: {
    claude: 'connected' | 'disconnected' | 'testing';
    openai: 'connected' | 'disconnected' | 'testing';
  };

  knowledgeBaseStatus?: {
    glossary_terms: number;
    cultural_rules: number;
    idioms: number;
    qa_overrides: number;
  };

  dictionaryLookup?: DictionaryLookup;
  showDictionary: boolean;
  selectedText?: { text: string; language: 'source' | 'target' };

  translationHistory: TranslationHistory;
  showHistory: boolean;

  showGlossaryManager: boolean;
  glossaryEditMode: boolean;

  humanReview?: {
    items: Array<{
      id: string;
      error: AuditError;
      userDecision: 'accept_suggestion' | 'keep_original' | 'custom' | null;
      customValue?: string;
    }>;
    allDecisionsMade: boolean;
  };
}

// ============================================
// TARGET LANGUAGES
// ============================================

export const TARGET_LANGUAGES = [
  "Chinese (Mandarin)",
  "Danish",
  "Dutch",
  "English (UK)",
  "English (US)",
  "Finnish",
  "French (France)",
  "German (Germany)",
  "Italian",
  "Japanese",
  "Korean",
  "Norwegian",
  "Spanish (Latin American)",
  "Swedish",
];

// ============================================
// DIALECT PROFILE (Calibration Pipeline)
// ============================================

export interface DialectSourceMaterial {
  type: 'audio' | 'video' | 'transcript';
  title: string;
  duration_minutes?: number;
  speaker_region?: string;
  speaker_context?: string;
  analyzed_date: string;
}

export interface DialectPacing {
  words_per_minute_avg: number;
  words_per_minute_range: [number, number];
  pause_frequency: string;
  pause_duration_avg_ms: number;
  emphasis_pattern: string;
  sentence_length_avg_words: number;
}

export interface DialectRegister {
  formality_level: string;
  address_form: string;
  humor_frequency: string;
  hedging_language: string;
  directness: string;
}

export interface DialectTermEntry {
  en: string;
  spoken_as: string;
  note?: string;
}

export interface DialectTermVariation {
  en: string;
  standard: string;
  spoken: string;
  note?: string;
}

export interface DialectIdiom {
  context: string;
  english_equivalent: string;
  spoken_form: string;
  frequency: string;
}

export interface DialectSubtitlePacing {
  natural_cps_range: [number, number];
  preferred_cps: number;
  line_break_preference: string;
  compound_noun_handling: string;
}

export interface DialectVoiceCharacteristics {
  pitch_range: string;
  speaking_style: string;
  energy_level: string;
  accent_region: string;
  breathing_pattern: string;
}

export interface DialectProfile {
  language: string;
  profile_version: string;
  source_material: DialectSourceMaterial;
  pacing: DialectPacing;
  register: DialectRegister;
  terminology_in_practice: {
    terms_used_as_english_loanwords: string[];
    terms_always_translated: DialectTermEntry[];
    terms_with_regional_variation: DialectTermVariation[];
  };
  idioms_observed: DialectIdiom[];
  subtitle_pacing: DialectSubtitlePacing;
  voice_characteristics: DialectVoiceCharacteristics;
}

// ============================================
// SUPPORTED FILE TYPES
// ============================================

export const SUPPORTED_FILE_TYPES = {
  documents: ['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf'],
  subtitles: ['.srt'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
  audio: ['.mp3', '.wav', '.m4a', '.ogg', '.flac']
};

export const ACCEPTED_MIME_TYPES = {
  documents: 'text/plain,.md,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf',
  subtitles: '.srt,application/x-subrip,text/srt',
  images: 'image/png,image/jpeg,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/quicktime,video/x-msvideo',
  audio: 'audio/mpeg,audio/wav,audio/mp4,audio/ogg'
};