import React, { useState } from 'react';
import { Upload, FileText, Trash2, BookOpen, Plus } from 'lucide-react';
import { GlossaryFile } from './types';

interface GlossaryManagerProps {
  files: GlossaryFile[];
  onAddFile: (file: GlossaryFile) => void;
  onRemoveFile: (index: number) => void;
}

export const GlossaryManager: React.FC<GlossaryManagerProps> = ({ files, onAddFile, onRemoveFile }) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
  };

  const processFiles = async (fileList: FileList) => {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        // Fix: Added missing languageCode property to satisfy GlossaryFile type
        onAddFile({
          name: file.name,
          content: text,
          languageCode: 'en', 
          type: 'glossary' 
        });
      };
      reader.readAsText(file);
    });
  };

  return (
    <div className="bg-white rounded-[28px] shadow-sm border border-[#d2d2d7]/30 p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-[#1d1d1f]" />
        </div>
        <h3 className="font-semibold text-[#1d1d1f] text-[17px]">Knowledge Base</h3>
      </div>
      
      <div className="space-y-3 mb-6">
        {files.length === 0 ? (
          <p className="text-[13px] text-[#86868b] leading-relaxed">
            Upload glossaries, style guides, or Do-Not-Translate lists to personalize the engine.
          </p>
        ) : (
          <div className="divide-y divide-[#d2d2d7]/50 border-t border-b border-[#d2d2d7]/50">
            {files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between py-3 group">
                <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-[#0071e3]" />
                    <span className="text-[13px] font-medium text-[#1d1d1f] truncate max-w-[140px]">{file.name}</span>
                </div>
                <button 
                    onClick={() => onRemoveFile(idx)}
                    className="text-[#86868b] hover:text-[#ff3b30] transition-colors p-1 opacity-0 group-hover:opacity-100"
                    aria-label="Remove file"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
                </div>
            ))}
          </div>
        )}
      </div>

      <div 
        className={`relative flex flex-col items-center justify-center p-6 border border-dashed rounded-[20px] transition-all cursor-pointer
          ${dragActive ? "border-[#0071e3] bg-[#f5f5f7]" : "border-[#d2d2d7] hover:border-[#86868b] hover:bg-[#f5f5f7]"}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input 
          type="file" 
          multiple 
          accept=".txt,.md,.csv,.json"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="w-8 h-8 rounded-full bg-[#0071e3] flex items-center justify-center mb-2 shadow-sm">
            <Plus className="w-5 h-5 text-white" />
        </div>
        <p className="text-[13px] font-medium text-[#1d1d1f]">Add Source File</p>
      </div>
    </div>
  );
};