import React from 'react';
import { useDashboardStore, ActiveTab } from '../../lib/store';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function SidebarNavigation() {
  const router = useRouter();
  const {
    activeTab,
    setActiveTab,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    chatbots,
    conversations,
    isSuperAdmin,
    userName,
    userEmail
  } = useDashboardStore();

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
                 <div className="w-8 h-8 rounded-xl bg-[var(--awb-color8)] text-[var(--awb-color8)] font-extrabold flex items-center justify-center text-sm shadow-md">SF</div>
                 <span className="font-extrabold text-xl tracking-tight text-[var(--awb-color8)]">StyleFlo</span>
               </div>
               <button className="md:hidden p-2 -mr-2 text-[var(--awb-color6)] hover:text-[var(--awb-color7)]" onClick={() => setIsMobileMenuOpen(false)}>
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
               </button>
            </div>
            <nav className="space-y-1.5">
              {[
                { id: 'chatbots', label: 'Chatbots', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />, count: chatbots.filter(b => b.id !== globalBotId).length },
                { id: 'scheduling', label: 'Scheduling & Staff', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
                { id: 'conversations', label: 'Inbox & Logs', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />, count: conversations.length },
                { id: 'crawler', label: 'Knowledge Base', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /> },
                { id: 'integrations', label: 'Integrations', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /> },
                { id: 'billing', label: 'Billing & Usage', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /> },

              ].map(tab => (
                 <button key={tab.id} onClick={() => { setActiveTab(tab.id as ActiveTab); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-200 border ${activeTab === tab.id ? 'bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] shadow-sm' : 'text-[var(--awb-color6)] hover:text-[var(--awb-color7)] hover:bg-[var(--awb-color1)]/60 border-transparent'}`}>
                    <div className="flex items-center gap-3">
                       <svg className={`w-5 h-5 ${activeTab === tab.id ? 'text-[var(--awb-color5)]' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{tab.icon}</svg>
                       {tab.label}
                    </div>
                    {tab.count !== undefined && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${activeTab === tab.id ? 'bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]' : 'bg-[var(--awb-color3)] text-[var(--awb-color6)]'}`}>
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
                  <div className="w-8 h-8 rounded-full bg-[var(--awb-color8)] text-[var(--awb-color8)] flex items-center justify-center font-bold text-sm shadow">
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
