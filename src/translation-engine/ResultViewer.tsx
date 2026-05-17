import React, { useState, useEffect } from 'react';
import { LocalizationResult } from './types';
import { Download, ChevronDown, ChevronUp, Copy, CheckCircle, Pencil, X, RotateCcw, Save, FileText } from 'lucide-react';

interface ResultViewerProps {
  content: LocalizationResult;
  targetLanguage: string;
  onWordSelect?: (word: string, language: 'source' | 'target', context?: string) => void;
  onWordReplace?: (originalWord: string, newWord: string) => void;
  onSourceEdit?: (newSource: string) => void;
  onTargetEdit?: (newTarget: string) => void;
  onRetranslate?: (newSource: string) => void;
  onApprove?: (content: LocalizationResult, targetLanguage: string) => void;
  isApproved?: boolean;
  projectTitle?: string;
  sourceFileName?: string;
  sourceType?: 'text' | 'document' | 'media';
  tabDescriptions?: Record<string, string>;
}

const TABS = [
  { id: 'final', label: 'Final Translation', description: 'The final translated text ready for use' },
  { id: 'sidebyside', label: 'Side by Side', description: 'Compare original and translated text line by line' },
  { id: 'audit', label: 'Quality Audit', description: 'Detailed quality scores and error analysis from GPT-5.2' },
  { id: 'cultural', label: 'Cultural Analysis', description: 'Cultural sensitivity analysis for target market' },
];

export const ResultViewer: React.FC<ResultViewerProps> = ({
  content,
  targetLanguage,
  onWordSelect,
  onWordReplace,
  onSourceEdit,
  onTargetEdit,
  onRetranslate,
  onApprove,
  isApproved = false,
  projectTitle,
  sourceFileName,
  sourceType = 'text',
}) => {
  const [activeTab, setActiveTab] = useState<string>('final');
  const [showConsensusDetails, setShowConsensusDetails] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  // === EDIT STATE ===
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [editedSource, setEditedSource] = useState('');
  const [editedTarget, setEditedTarget] = useState('');
  const [sourceChanged, setSourceChanged] = useState(false);
  const [showOverridePrompt, setShowOverridePrompt] = useState(false);
  const [pendingTargetEdit, setPendingTargetEdit] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'warning' } | null>(null);
  const [overrideCount, setOverrideCount] = useState(0);

  // Load override count from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('te_qa_overrides');
      if (stored) {
        const parsed = JSON.parse(stored);
        setOverrideCount(Array.isArray(parsed) ? parsed.length : 0);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToast({ message, type });
  };

  // === SOURCE EDIT HANDLERS ===
  const startEditSource = () => {
    setEditedSource(content.originalFormat || '');
    setIsEditingSource(true);
    setSourceChanged(false);
  };

  const cancelEditSource = () => {
    setIsEditingSource(false);
    setEditedSource('');
    setSourceChanged(false);
  };

  const handleSourceChange = (value: string) => {
    setEditedSource(value);
    setSourceChanged(value !== (content.originalFormat || ''));
  };

  const handleRetranslate = () => {
    if (onSourceEdit) onSourceEdit(editedSource);
    if (onRetranslate) onRetranslate(editedSource);
    setIsEditingSource(false);
    setSourceChanged(false);
    showToast('Source updated - re-translating...', 'info');
  };

  // === TARGET EDIT HANDLERS ===
  const startEditTarget = () => {
    setEditedTarget(content.finalScript || '');
    setIsEditingTarget(true);
  };

  const cancelEditTarget = () => {
    setIsEditingTarget(false);
    setEditedTarget('');
    setShowOverridePrompt(false);
  };

  const handleTargetSave = () => {
    if (editedTarget === content.finalScript) {
      cancelEditTarget();
      return;
    }
    // Show the override prompt
    setPendingTargetEdit(editedTarget);
    setShowOverridePrompt(true);
  };

  const applyTargetEditWithOverride = () => {
    // Save to localStorage as structured override
    const override = {
      id: `ovr-${Date.now()}`,
      timestamp: new Date().toISOString(),
      targetLanguage,
      originalTarget: content.finalScript,
      editedTarget: pendingTargetEdit,
      sourceText: content.originalFormat,
      action: 'manual_edit',
    };

    try {
      const existing = JSON.parse(localStorage.getItem('te_qa_overrides') || '[]');
      existing.push(override);
      localStorage.setItem('te_qa_overrides', JSON.stringify(existing));
      setOverrideCount(existing.length);
    } catch { /* ignore */ }

    if (onTargetEdit) onTargetEdit(pendingTargetEdit);
    setIsEditingTarget(false);
    setShowOverridePrompt(false);
    showToast('Translation updated and saved to overrides', 'success');
  };

  const applyTargetEditWithoutOverride = () => {
    if (onTargetEdit) onTargetEdit(pendingTargetEdit);
    setIsEditingTarget(false);
    setShowOverridePrompt(false);
    showToast('Translation updated (not saved to overrides)', 'info');
  };

  const status = content.verification?.status || 'UNKNOWN';
  const score = content.consensusData?.finalScore || content.verification?.technical_accuracy_score || 0;
  const rounds = content.consensusData?.totalRounds || 1;
  const hasSRT = !!content.srtContent;

  // IMPORTANT: show cultural tab if a report exists (even if 0 issues)
  const hasCulturalReport = !!content.culturalAnalysis;
  const culturalCount = content.culturalAnalysis?.totalIssuesFound || 0;

  const handleTextSelection = (e: React.MouseEvent, language: 'source' | 'target') => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length > 0 && selectedText.length < 50 && onWordSelect) {
      let context = '';
      if (selection?.anchorNode?.parentElement) {
        context = selection.anchorNode.parentElement.textContent || '';
        if (context.length > 200) {
          const idx = context.indexOf(selectedText);
          if (idx !== -1) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(context.length, idx + selectedText.length + 100);
            context = context.substring(start, end);
          }
        }
      }
      onWordSelect(selectedText, language, context);
    }
  };

  const downloadSRT = () => {
    if (!content.srtContent) return;
    const blob = new Blob([content.srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const srtName = projectTitle
      ? projectTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : `subtitles_${targetLanguage.replace(/\s/g, '_')}`;
    a.download = `${srtName}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const escapeHtml = (s: string) =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  // HTML Report: Side-by-Side + Cultural Audit + Cultural Analysis
  const generateHTMLReport = () => {
    const sourceInfo = sourceFileName
      ? `<strong>Source File:</strong> ${escapeHtml(sourceFileName)}<br>`
      : '<strong>Source:</strong> Text input<br>';
    const titleInfo = projectTitle ? `<strong>Project:</strong> ${escapeHtml(projectTitle)}<br>` : '';

    const culturalAuditRows =
      (content.cultural_audit || []).length > 0
        ? (content.cultural_audit || [])
            .map(
              (f) => `
      <div class="audit-item ${f.severity}">
        <div class="audit-head">
          <span class="badge ${f.severity}">${escapeHtml(f.severity.toUpperCase())}</span>
          ${f.timestamp ? `<span class="muted">${escapeHtml(f.timestamp)}</span>` : `<span></span>`}
        </div>
        <div style="margin-top:10px;">
          <strong>Term/Phrase:</strong> "${escapeHtml(f.term_or_phrase)}"<br>
          <strong>Decision:</strong> ${escapeHtml(f.decision)}<br>
          <strong>Reasoning:</strong> ${escapeHtml(f.reasoning)}
        </div>
      </div>
    `
            )
            .join('')
        : `<div class="box blue">No cultural audit findings were returned for this run.</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Translation Report - ${escapeHtml(targetLanguage)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 1000px; margin: 0 auto; padding: 40px 24px; }
    h1 { font-size: 36px; font-weight: 700; margin-bottom: 8px; }
    h2 { font-size: 26px; font-weight: 600; margin: 48px 0 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e5e5; }
    h3 { font-size: 18px; font-weight: 700; margin: 18px 0 10px; }
    .meta { color: #666; font-size: 15px; margin-bottom: 32px; line-height: 1.8; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 32px 0; }
    .stat { background: #f9f9f9; padding: 24px; border-radius: 16px; text-align: center; }
    .stat-value { font-size: 42px; font-weight: 700; }
    .stat-value.pass { color: #10b981; }
    .stat-value.fail { color: #ef4444; }
    .stat-label { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .box { background: #f9f9f9; padding: 28px; border-radius: 16px; white-space: pre-wrap; font-size: 16px; margin: 20px 0; line-height: 1.7; }
    .box.blue { background: #eff6ff; }
    .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin: 20px 0; }
    .comparison-col h4 { font-size: 14px; font-weight: 600; color: #666; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .round { background: #f9f9f9; padding: 24px; border-radius: 16px; margin: 16px 0; }
    .round-header { font-weight: 600; font-size: 17px; margin-bottom: 16px; }
    .error { padding: 16px 20px; background: #fef3c7; border-left: 4px solid #f59e0b; margin: 12px 0; border-radius: 0 12px 12px 0; }
    .error.critical { background: #fee2e2; border-color: #ef4444; }
    .error.major { background: #fef3c7; border-color: #f59e0b; }
    .error.minor { background: #f0f9ff; border-color: #3b82f6; }
    .cultural-item { padding: 20px; background: #f9f9f9; border-radius: 16px; margin: 16px 0; border-left: 4px solid #3b82f6; }
    .cultural-item.high { border-color: #ef4444; background: #fef2f2; }
    .cultural-item.medium { border-color: #f59e0b; background: #fffbeb; }
    .cultural-item.low { border-color: #3b82f6; background: #eff6ff; }
    .cultural-item.info { border-color: #94a3b8; background: #f8fafc; }
    .badge { display: inline-block; padding: 4px 14px; border-radius: 100px; font-size: 13px; font-weight: 600; }
    .badge.high { background: #fee2e2; color: #dc2626; }
    .badge.medium { background: #fef3c7; color: #d97706; }
    .badge.low { background: #dbeafe; color: #2563eb; }
    .badge.info { background: #e2e8f0; color: #475569; }
    footer { margin-top: 80px; padding-top: 24px; border-top: 1px solid #e5e5e5; color: #999; font-size: 13px; text-align: center; }
    .muted { color:#666; font-size:13px; }
    .audit-item { padding: 18px 20px; background: #f9f9f9; border-radius: 14px; margin: 12px 0; border-left: 4px solid #94a3b8; }
    .audit-item.critical { border-left-color: #ef4444; background: #fef2f2; }
    .audit-item.warning { border-left-color: #f59e0b; background: #fffbeb; }
    .audit-item.info { border-left-color: #3b82f6; background: #eff6ff; }
    .audit-head { display:flex; justify-content: space-between; align-items:center; }
    .badge.critical { background:#fee2e2; color:#dc2626; }
    .badge.warning { background:#fef3c7; color:#b45309; }
    .badge.info { background:#dbeafe; color:#1d4ed8; }
  </style>
</head>
<body>
  <h1>Translation Report</h1>
  <div class="meta">
    ${titleInfo}
    ${sourceInfo}
    <strong>Target Language:</strong> ${escapeHtml(targetLanguage)}<br>
    <strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}<br>
    <strong>Mode:</strong> ${escapeHtml(content.metadata.translation_mode || 'standard')} | 
    <strong>Formality:</strong> ${escapeHtml(content.metadata.formality_level || 'formal')}
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value ${status === 'PASS' ? 'pass' : 'fail'}">${escapeHtml(status)}</div>
      <div class="stat-label">Status</div>
    </div>
    <div class="stat">
      <div class="stat-value">${escapeHtml(String(score))}</div>
      <div class="stat-label">Score / 100</div>
    </div>
    <div class="stat">
      <div class="stat-value">${escapeHtml(String(rounds))}</div>
      <div class="stat-label">Rounds</div>
    </div>
    <div class="stat">
      <div class="stat-value">${escapeHtml(((content.metadata.processing_time_ms || 0) / 1000).toFixed(1))}s</div>
      <div class="stat-label">Time</div>
    </div>
  </div>

  <h2>Final Translation</h2>
  <div class="box">${escapeHtml(content.finalScript || '')}</div>

  <h2>Side by Side</h2>
  <p class="muted" style="margin-bottom: 12px;">Original vs. translated output.</p>
  <div class="comparison">
    <div class="comparison-col">
      <h4>Original</h4>
      <div class="box">${escapeHtml(content.originalFormat || '')}</div>
    </div>
    <div class="comparison-col">
      <h4>${escapeHtml(targetLanguage)}</h4>
      <div class="box blue">${escapeHtml(content.finalScript || '')}</div>
    </div>
  </div>

  ${
    content.consensusData
      ? `
  <h2>Quality Audit Details</h2>
  <p class="muted" style="margin-bottom: 12px;">GPT-5.2 audited the translation across ${escapeHtml(String(rounds))} round(s).</p>
  ${(content.consensusData.rounds || [])
    .map(
      (round, idx) => `
    <div class="round">
      <div class="round-header">Round ${idx + 1} - Score: ${escapeHtml(String(round.auditResult?.score ?? ' - '))}/100 - ${
        escapeHtml(String(round.auditResult?.errors?.length ?? 0))
      } issue(s)</div>
      ${(round.auditResult?.errors || [])
        .map(
          (err) => `
        <div class="error ${escapeHtml(err.severity)}">
          <strong>[${escapeHtml(err.severity.toUpperCase())}]</strong> ${escapeHtml(err.issue)}<br>
          <span class="muted">Current: \"${escapeHtml(err.current)}\" → Suggested: "${escapeHtml(err.suggested)}"</span>
        </div>
      `
        )
        .join('')}
    </div>
  `
    )
    .join('')}
  ${
    content.consensusData.whyNotPerfect
      ? `
    <div style="background: #fef3c7; padding: 20px 24px; border-radius: 12px; margin-top: 24px;">
      <strong style="font-size: 15px;">Why not 100%?</strong>
      <p style="margin-top: 8px; white-space: pre-wrap; font-size: 15px;">${escapeHtml(content.consensusData.whyNotPerfect)}</p>
    </div>
  `
      : ''
  }
  `
      : ''
  }

  <h2>Cultural Audit (Text)</h2>
  <p class="muted" style="margin-bottom: 12px;">Rules / decisions applied for cultural risk in text.</p>
  ${culturalAuditRows}

  ${
    content.culturalAnalysis
      ? `
  <h2>Cultural Analysis</h2>
  <p class="muted" style="margin-bottom: 12px;">AI analyzed the content for cultural sensitivities.</p>

  <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
    <div class="stat" style="padding: 16px;"><div class="stat-value" style="font-size: 28px;">${escapeHtml(
      String(content.culturalAnalysis.totalIssuesFound || 0)
    )}</div><div class="stat-label">Total</div></div>
    <div class="stat" style="padding: 16px;"><div class="stat-value" style="font-size: 28px; color: #ef4444;">${escapeHtml(
      String(content.culturalAnalysis.highSeverityCount || 0)
    )}</div><div class="stat-label">High</div></div>
    <div class="stat" style="padding: 16px;"><div class="stat-value" style="font-size: 28px; color: #f59e0b;">${escapeHtml(
      String(content.culturalAnalysis.mediumSeverityCount || 0)
    )}</div><div class="stat-label">Medium</div></div>
    <div class="stat" style="padding: 16px;"><div class="stat-value" style="font-size: 28px; color: #3b82f6;">${escapeHtml(
      String(content.culturalAnalysis.lowSeverityCount || 0)
    )}</div><div class="stat-label">Low</div></div>
  </div>

  ${(content.culturalAnalysis.items || [])
    .map(
      (item) => `
    <div class="cultural-item ${escapeHtml(item.severity)}">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <strong style="font-size: 16px;">"${escapeHtml(item.element)}"</strong>
        <span class="badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity.toUpperCase())}</span>
      </div>
      <p style="color: #666; margin-bottom: 12px; font-size: 15px;"><strong>Category:</strong> ${escapeHtml(item.category)}</p>
      <p style="margin-bottom: 12px; font-size: 15px;"><strong>Concern:</strong> ${escapeHtml(item.concern)}</p>
      <p style="color: #059669; font-size: 15px;"><strong>Suggestion:</strong> ${escapeHtml(item.suggestion)}</p>
    </div>
  `
    )
    .join('')}

  ${
    content.culturalAnalysis.summary
      ? `
    <div style="background: #f1f5f9; padding: 18px 22px; border-radius: 12px; margin-top: 18px;">
      <strong style="font-size: 15px;">Summary</strong>
      <p style="margin-top: 8px; white-space: pre-wrap; font-size: 15px;">${escapeHtml(content.culturalAnalysis.summary)}</p>
    </div>
  `
      : ''
  }
  `
      : ''
  }

  <footer>Translation Engine | Powered by Claude + GPT-5.2 | ${escapeHtml(new Date().toLocaleDateString())}</footer>
</body>
</html>`;
  };

  const downloadReport = () => {
    const html = generateHTMLReport();
    const blob = new Blob(['\ufeff' + html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = projectTitle
      ? projectTitle.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').substring(0, 80)
      : `translation_report_${targetLanguage.replace(/\s/g, '_')}`;
    a.download = `${safeName}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = () => {
    const html = generateHTMLReport();
    // Add print-optimized styles to the HTML for clean PDF output
    const printHTML = html.replace('</style>', `
      @media print {
        body { padding: 20px 16px; max-width: 100%; }
        .stats { grid-template-columns: repeat(4, 1fr); }
        .comparison { grid-template-columns: 1fr 1fr; }
        .box { break-inside: avoid; }
        .round { break-inside: avoid; }
        .cultural-item { break-inside: avoid; }
        .audit-item { break-inside: avoid; }
        .error { break-inside: avoid; }
        footer { margin-top: 40px; }
      }
    </style>`);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      // Popup blocked fallback: open in iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-10000px';
      iframe.style.left = '-10000px';
      iframe.style.width = '1000px';
      iframe.style.height = '800px';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(printHTML);
        doc.close();
        setTimeout(() => {
          iframe.contentWindow?.print();
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 500);
      }
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printHTML);
    printWindow.document.close();
    // Wait for content to render before triggering print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        // Close the window after print dialog is dismissed
        printWindow.onafterprint = () => printWindow.close();
      }, 300);
    };
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
      {/* Centered Tabs with Tooltips */}
      <div className="flex justify-center gap-2 p-4 bg-neutral-50 border-b border-neutral-200">
        {TABS.map((tab) => {
          if (tab.id === 'cultural' && !hasCulturalReport) return null;

          return (
            <div key={tab.id} className="relative">
              <button
                onClick={() => setActiveTab(tab.id)}
                onMouseEnter={() => setHoveredTab(tab.id)}
                onMouseLeave={() => setHoveredTab(null)}
                className={`px-6 py-3 text-base font-medium rounded-xl transition-all ${
                  activeTab === tab.id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {tab.label}
                {tab.id === 'cultural' && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-bold bg-orange-500 text-white rounded-full">
                    {culturalCount}
                  </span>
                )}
              </button>

              {hoveredTab === tab.id && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-2 bg-neutral-900 text-white text-sm rounded-xl whitespace-nowrap z-50 shadow-lg">
                  {tab.description}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-neutral-900" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Dictionary Hint */}
      <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-center gap-2">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
        <span className="text-blue-700 text-base">Select any word to look it up and find alternatives</span>
      </div>

      {/* Download Actions */}
      <div className="flex justify-end gap-3 px-6 py-4 border-b border-neutral-200">
        {hasSRT && (
          <button
            onClick={downloadSRT}
            className="flex items-center gap-2 px-4 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
          >
            <Download className="w-5 h-5" />
            Download SRT
          </button>
        )}
        <button
          onClick={downloadReport}
          className="flex items-center gap-2 px-4 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
        >
          <Download className="w-5 h-5" />
          HTML Report
        </button>
        <button
          onClick={downloadPDF}
          className="flex items-center gap-2 px-4 py-2 text-base font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
        >
          <FileText className="w-5 h-5" />
          Download PDF
        </button>
      </div>


      {/* Tab Content */}
      <div className="p-8">
        {activeTab === 'final' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              {overrideCount > 0 && (
                <span className="px-3 py-1.5 bg-purple-50 text-purple-700 text-sm font-medium rounded-full">
                  {overrideCount} override{overrideCount !== 1 ? 's' : ''} saved
                </span>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {!isEditingTarget && (
                  <button
                    onClick={startEditTarget}
                    className="flex items-center gap-2 px-4 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit Translation
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(content.finalScript);
                    showToast('Copied to clipboard', 'info');
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
                >
                  <Copy className="w-5 h-5" />
                  Copy
                </button>
              </div>
            </div>

            {isEditingTarget ? (
              <div>
                <textarea
                  value={editedTarget}
                  onChange={(e) => setEditedTarget(e.target.value)}
                  className="w-full min-h-[200px] p-6 text-lg text-neutral-800 bg-blue-50 border-2 border-blue-300 rounded-2xl focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
                />
                <div className="flex items-center justify-end gap-3 mt-4">
                  <button
                    onClick={cancelEditTarget}
                    className="flex items-center gap-2 px-5 py-2.5 text-base font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handleTargetSave}
                    className="flex items-center gap-2 px-5 py-2.5 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    Save Changes
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="prose prose-lg max-w-none text-neutral-800 whitespace-pre-wrap cursor-text"
                onMouseUp={(e) => handleTextSelection(e, 'target')}
              >
                {content.finalScript}
              </div>
            )}
          </div>
        )}

        {activeTab === 'sidebyside' && (
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-neutral-500 uppercase tracking-wider">Original (English)</h4>
                {!isEditingSource && (
                  <button
                    onClick={startEditSource}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 rounded-lg transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
              </div>
              {isEditingSource ? (
                <div>
                  <textarea
                    value={editedSource}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="w-full min-h-[200px] p-6 text-base text-neutral-700 bg-neutral-50 border-2 border-neutral-300 rounded-2xl focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
                  />
                  <div className="flex items-center justify-end gap-3 mt-3">
                    <button
                      onClick={cancelEditSource}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                    {sourceChanged && (
                      <button
                        onClick={handleRetranslate}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Re-translate
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className="p-6 bg-neutral-50 rounded-2xl text-base text-neutral-700 whitespace-pre-wrap cursor-text"
                  onMouseUp={(e) => handleTextSelection(e, 'source')}
                >
                  {content.originalFormat}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-neutral-500 uppercase tracking-wider">{targetLanguage}</h4>
                {!isEditingTarget && (
                  <button
                    onClick={startEditTarget}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 rounded-lg transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
              </div>
              {isEditingTarget ? (
                <div>
                  <textarea
                    value={editedTarget}
                    onChange={(e) => setEditedTarget(e.target.value)}
                    className="w-full min-h-[200px] p-6 text-base text-neutral-700 bg-blue-50 border-2 border-blue-300 rounded-2xl focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
                  />
                  <div className="flex items-center justify-end gap-3 mt-3">
                    <button
                      onClick={cancelEditTarget}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                    <button
                      onClick={handleTargetSave}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="p-6 bg-blue-50 rounded-2xl text-base text-neutral-700 whitespace-pre-wrap cursor-text"
                  onMouseUp={(e) => handleTextSelection(e, 'target')}
                >
                  {content.finalScript}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div>
            <p className="text-neutral-500 mb-6 text-base">
              GPT-5.2 performed quality audits across {rounds} round(s) to ensure translation accuracy.
            </p>

            {content.consensusData?.rounds.map((round, idx) => (
              <div key={idx} className="mb-6 p-6 bg-neutral-50 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold text-neutral-800">Round {idx + 1}</h4>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-2xl font-bold ${
                        round.auditResult.score >= 95 ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                    >
                      {round.auditResult.score}/100
                    </span>
                    <span className="text-base text-neutral-500">{round.auditResult.errors.length} issue(s)</span>
                  </div>
                </div>

                {round.auditResult.errors.length === 0 ? (
                  <p className="text-emerald-600 text-base flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    No issues found in this round
                  </p>
                ) : (
                  <div className="space-y-3">
                    {round.auditResult.errors.map((err, errIdx) => (
                      <div
                        key={errIdx}
                        className={`p-4 rounded-xl border-l-4 ${
                          err.severity === 'critical'
                            ? 'bg-red-50 border-red-500'
                            : err.severity === 'major'
                            ? 'bg-amber-50 border-amber-500'
                            : 'bg-blue-50 border-blue-500'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span
                            className={`text-sm font-bold uppercase ${
                              err.severity === 'critical'
                                ? 'text-red-600'
                                : err.severity === 'major'
                                ? 'text-amber-600'
                                : 'text-blue-600'
                            }`}
                          >
                            {err.severity}
                          </span>
                        </div>
                        <p className="text-base text-neutral-800 mb-2">{err.issue}</p>
                        <p className="text-sm text-neutral-600">
                          <span className="font-medium">Current:</span> "{err.current}" → <span className="font-medium"> Suggested:</span> "{err.suggested}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Cultural Audit Findings (text) */}
            <div className="mt-10">
              <h4 className="text-lg font-bold text-neutral-800 mb-4">Cultural Audit (Text)</h4>
              {content.cultural_audit?.length ? (
                <div className="space-y-3">
                  {content.cultural_audit.map((f, i) => (
                    <div
                      key={i}
                      className={`p-4 rounded-xl border-l-4 ${
                        f.severity === 'critical'
                          ? 'bg-red-50 border-red-500'
                          : f.severity === 'warning'
                          ? 'bg-amber-50 border-amber-500'
                          : 'bg-blue-50 border-blue-500'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span
                          className={`text-sm font-bold uppercase ${
                            f.severity === 'critical'
                              ? 'text-red-600'
                              : f.severity === 'warning'
                              ? 'text-amber-600'
                              : 'text-blue-600'
                          }`}
                        >
                          {f.severity}
                        </span>
                        {f.timestamp && <span className="text-xs text-neutral-400">{f.timestamp}</span>}
                      </div>
                      <p className="text-base text-neutral-800 mb-2">
                        <span className="font-semibold">"{f.term_or_phrase}"</span> - {f.decision}
                      </p>
                      <p className="text-sm text-neutral-600 whitespace-pre-wrap">{f.reasoning}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 bg-neutral-50 rounded-2xl text-neutral-600 text-base">
                  No cultural audit findings were returned for this run.
                </div>
              )}
            </div>

            {content.consensusData?.whyNotPerfect && (
              <div className="mt-6 p-6 bg-amber-50 border border-amber-200 rounded-2xl">
                <h4 className="font-bold text-amber-800 mb-2 text-base">Why not 100%?</h4>
                <p className="text-amber-700 whitespace-pre-wrap text-base">{content.consensusData.whyNotPerfect}</p>
              </div>
            )}

            {content.consensusData?.consensusReached && (
              <div className="mt-6 p-6 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
                <p className="text-emerald-700 font-medium text-base">Consensus reached! Both AI models agree on the translation quality.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'cultural' && content.culturalAnalysis && (
          <div>
            <p className="text-neutral-500 mb-6 text-base">
              AI analyzed the content for cultural sensitivities relevant to the {targetLanguage} market.
            </p>

            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="p-4 bg-neutral-50 rounded-2xl text-center">
                <p className="text-3xl font-bold text-neutral-800">{content.culturalAnalysis.totalIssuesFound}</p>
                <p className="text-sm text-neutral-500 uppercase tracking-wider">Total</p>
              </div>
              <div className="p-4 bg-red-50 rounded-2xl text-center">
                <p className="text-3xl font-bold text-red-500">{content.culturalAnalysis.highSeverityCount}</p>
                <p className="text-sm text-neutral-500 uppercase tracking-wider">High</p>
              </div>
              <div className="p-4 bg-amber-50 rounded-2xl text-center">
                <p className="text-3xl font-bold text-amber-500">{content.culturalAnalysis.mediumSeverityCount}</p>
                <p className="text-sm text-neutral-500 uppercase tracking-wider">Medium</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-2xl text-center">
                <p className="text-3xl font-bold text-blue-500">{content.culturalAnalysis.lowSeverityCount}</p>
                <p className="text-sm text-neutral-500 uppercase tracking-wider">Low</p>
              </div>
            </div>

            {content.culturalAnalysis.items.length === 0 ? (
              <div className="p-8 bg-emerald-50 rounded-2xl text-center">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                <p className="text-emerald-700 font-medium text-lg">No cultural issues detected</p>
                <p className="text-emerald-600 text-base mt-2">The content appears culturally appropriate for the target market.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {content.culturalAnalysis.items.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-6 rounded-2xl border-l-4 ${
                      item.severity === 'high'
                        ? 'bg-red-50 border-red-500'
                        : item.severity === 'medium'
                        ? 'bg-amber-50 border-amber-500'
                        : item.severity === 'low'
                        ? 'bg-blue-50 border-blue-500'
                        : 'bg-neutral-50 border-neutral-400'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <span className="font-bold text-neutral-800 text-base">"{item.element}"</span>
                      <span
                        className={`px-3 py-1 text-sm font-bold rounded-full ${
                          item.severity === 'high'
                            ? 'bg-red-100 text-red-700'
                            : item.severity === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : item.severity === 'low'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-neutral-200 text-neutral-700'
                        }`}
                      >
                        {item.severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-500 mb-2">
                      <span className="font-medium">Category:</span> {item.category}
                    </p>
                    <p className="text-base text-neutral-700 mb-3">
                      <span className="font-medium">Concern:</span> {item.concern}
                    </p>
                    <p className="text-base text-emerald-700">
                      <span className="font-medium">Suggestion:</span> {item.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {content.culturalAnalysis.summary && (
              <div className="mt-6 p-6 bg-neutral-100 rounded-2xl">
                <h4 className="font-bold text-neutral-800 mb-2 text-base">Summary</h4>
                <p className="text-neutral-600 text-base">{content.culturalAnalysis.summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* === OVERRIDE PROMPT MODAL === */}
      {showOverridePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
                  <Save className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-neutral-900">Save to Overrides?</h3>
                  <p className="text-sm text-neutral-500">This correction will apply to future translations</p>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="p-4 bg-red-50 rounded-xl">
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">Original</p>
                  <p className="text-sm text-red-700 line-through">{(content.finalScript || '').substring(0, 200)}{(content.finalScript || '').length > 200 ? '...' : ''}</p>
                </div>
                <div className="p-4 bg-emerald-50 rounded-xl">
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Your Edit</p>
                  <p className="text-sm text-emerald-700">{pendingTargetEdit.substring(0, 200)}{pendingTargetEdit.length > 200 ? '...' : ''}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setShowOverridePrompt(false); cancelEditTarget(); }}
                  className="flex-1 px-5 py-3 text-base font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyTargetEditWithoutOverride}
                  className="flex-1 px-5 py-3 text-base font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors"
                >
                  Apply Only
                </button>
                <button
                  onClick={applyTargetEditWithOverride}
                  className="flex-1 px-5 py-3 text-base font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-colors"
                >
                  Save Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === TOAST NOTIFICATION === */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
          <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-lg text-base font-medium ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' :
            toast.type === 'warning' ? 'bg-amber-500 text-white' :
            'bg-neutral-800 text-white'
          }`}>
            {toast.type === 'success' && <CheckCircle className="w-5 h-5" />}
            {toast.message}
            <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};