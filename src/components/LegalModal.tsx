"use client";

import React from 'react';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  url: string;
}

export default function LegalModal({ isOpen, onClose, title, url }: LegalModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/80">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></span>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20"
            >
              Open in new tab ↗
            </a>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center text-sm font-bold transition-all"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body / iFrame */}
        <div className="flex-1 bg-white relative">
          <iframe
            src={url}
            title={title}
            className="w-full h-full border-none"
            loading="lazy"
          />
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-gray-800 bg-gray-950/90 text-center text-xs text-gray-400">
          StyleFlo Platform Legal Compliance & Privacy Standards
        </div>
      </div>
    </div>
  );
}
