import { Menu, Plus } from 'lucide-react';
import type { AppView } from '../types/llm';
import { PWAInstallButton } from './PWAControls';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onNewChat: () => void;
  onToggleMobileSidebar: () => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'arena', label: 'Arena' },
  { id: 'scene', label: '3D Studio' },
  { id: 'voice', label: 'Voice' },
  { id: 'own-ai', label: 'Own AI' },
  { id: 'knowledge', label: 'Knowledge' },
];

export function TopBar({
  activeView,
  onSelectView,
  onNewChat,
  onToggleMobileSidebar,
}: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 md:gap-8 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
      {/* Zone 1: Single-element Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle conversations sidebar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <a
          href="#chat"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('chat');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-slate-50"
        >
          LocalForge
        </a>
      </div>

      {/* Zone 2: Concise single-line navigation links */}
      <nav aria-label="Workspace navigation" className="hidden md:flex items-center gap-7">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`border-b-2 py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-500 ${
                isActive
                  ? 'border-blue-600 text-slate-900 dark:border-blue-500 dark:text-slate-50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Install & New Chat */}
      <div className="flex items-center gap-2 shrink-0">
        <PWAInstallButton />
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>New Chat</span>
        </button>
      </div>
    </header>
  );
}
