import React from 'react';
import { useDashboardStore, ActiveTab } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function SidebarNavigation() {
  const router = useRouter();
  const {
    role,
    activeTab,
    setActiveTab,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    chatbots,
    conversations,
    userName,
    userEmail
  } = useDashboardStore();

  const isOwner = role === 'owner' || role === 'admin';

  const handleSignOut = async () => {
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const globalBotId = '00000000-0000-0000-0000-000000000000';

  const navItems = isOwner
    ? [
        { id: 'scheduling', label: '🗓️ Master Calendar & Rota' },
        { id: 'chatbots', label: '🤖 Chatbot Manager', count: chatbots.filter(b => b.id !== globalBotId).length },
        { id: 'conversations', label: '💬 Inbox & Logs', count: conversations.length },
        { id: 'crawler', label: '📚 Knowledge Base' },
        { id: 'integrations', label: '🔌 Integrations' },
        { id: 'openclaw-monitor', label: '🛰️ OpenClaw Gateway' },
        { id: 'billing', label: '💳 Subscriptions & Add-ons' },
      ]
    : [
        { id: 'scheduling', label: '🗓️ Master Calendar & Rota' },
        { id: 'my-profile', label: '👤 My Profile & Calendar' },
      ];

  return (
    <>
      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/80 z-40 backdrop-blur-sm" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-50 transition-transform duration-300 w-64 h-full flex-shrink-0 border-r border-[var(--awb-color3)] bg-[var(--awb-color2)] flex flex-col justify-between`}>
         <div className="p-6">
            <div className="flex items-center justify-between mb-10 pl-2">
               <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-xl bg-[var(--awb-color8)] text-white font-extrabold flex items-center justify-center text-sm shadow-md">SF</div>
                 <div>
                   <span className="font-extrabold text-xl tracking-tight text-[var(--awb-color8)] block leading-none">StyleFlo</span>
                   <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 mt-1 block">
                     {isOwner ? 'Workspace Admin' : 'Colleague Portal'}
                   </span>
                 </div>
               </div>
               <button className="md:hidden p-2 -mr-2 text-[var(--awb-color6)] hover:text-[var(--awb-color7)]" onClick={() => setIsMobileMenuOpen(false)}>
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
               </button>
            </div>
            <nav className="space-y-1.5">
              {navItems.map(tab => (
                 <button key={tab.id} onClick={() => { setActiveTab(tab.id as ActiveTab); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 border ${activeTab === tab.id ? 'bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] shadow-sm' : 'text-[var(--awb-color6)] hover:text-[var(--awb-color7)] hover:bg-[var(--awb-color1)]/60 border-transparent'}`}>
                    <div className="flex items-center gap-3 truncate">
                       <span>{tab.label}</span>
                    </div>
                    {tab.count !== undefined && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${activeTab === tab.id ? 'bg-[#198fd9] text-white' : 'bg-[var(--awb-color3)] text-[var(--awb-color6)]'}`}>
                        {tab.count}
                      </span>
                    )}
                 </button>
              ))}
            </nav>
         </div>
         <div className="p-4 border-t border-[var(--awb-color3)]">
            <div className="flex items-center justify-between p-3 rounded-xl hover:bg-[var(--awb-color1)] transition-colors group cursor-pointer border border-transparent hover:border-[var(--awb-color3)]" onClick={handleSignOut} title="Sign Out">
               <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow">
                    {userName?.[0] || 'U'}
                  </div>
                  <div className="flex flex-col text-left">
                     <span className="text-sm font-bold text-[var(--awb-color7)] group-hover:text-[var(--awb-color8)] transition-colors">{userName}</span>
                     <span className="text-xs text-[var(--awb-color6)] truncate max-w-[120px]">{userEmail}</span>
                  </div>
               </div>
               <svg className="w-5 h-5 text-[var(--awb-color6)] group-hover:text-[var(--awb-color5)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            </div>
         </div>
      </aside>
    </>
  );
}
