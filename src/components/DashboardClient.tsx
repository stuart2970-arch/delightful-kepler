// @ts-nocheck
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import ServiceEditor from './ServiceEditor';
import ChatbotManagerView from './dashboard-views/ChatbotManagerView';
import KnowledgeBaseView from './dashboard-views/KnowledgeBaseView';
import InboxView from './dashboard-views/InboxView';
import SchedulingView from './dashboard-views/SchedulingView';
import IntegrationsView from './dashboard-views/IntegrationsView';
import SuperAdminVoiceManagerView from './dashboard-views/SuperAdminVoiceManagerView';
import { useDashboardStore } from '../lib/store';

interface Chatbot {
  id: string;
  name: string;
  primary_color: string;
  configuration_json: {
    welcome_message?: string;
    suggested_prompts?: string[];
    agent_name?: string;
    agent_role?: string;
    agent_avatar_url?: string;
    branding_html?: string;
    branding_url?: string;
  };
  created_at: string;
}


export interface DailySchedule {
  unavailable: boolean;
  am: { start: string, end: string } | null;
  pm: { start: string, end: string } | null;
}

export type WeeklySchedule = {
  weekCommencingDate: string; // YYYY-MM-DD format (Monday's date)
  monday: DailySchedule;
  tuesday: DailySchedule;
  wednesday: DailySchedule;
  thursday: DailySchedule;
  friday: DailySchedule;
  saturday: DailySchedule;
  sunday: DailySchedule;
};


interface Metrics {
  chatbotsCount: number;
  chunksCount: number;
  sessionsCount: number;
  messagesCount: number;
}

interface DashboardClientProps {
  isDevMode: boolean;
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userName: string;
  initialChatbots: Chatbot[];
  initialConversations: any[];
  initialMetrics: Metrics;
  isSuperAdmin: boolean;
  initialDomain?: string;
  initialServices?: any[];
  initialStaff?: any[];
  initialRwgConfig?: any;
  initialBookingMode?: string;
  initialBookingUrl?: string;
  initialGeneralOperatingHours?: any;
  initialOperatingHoursOverrides?: any;
  initialHolidaySettings?: any;
  initialGlobalVoiceDisclaimer?: string;
  billingData?: any;
  superadminData?: any;
  isImpersonating?: boolean;
  initialGoogleConnected?: boolean;
  initialBusinessAddress?: string;
  initialPostcode?: string;
}

export default function DashboardClient({
  isDevMode: serverDevMode,
  tenantId,
  tenantName,
  userEmail,
  userName,
  initialChatbots,
  initialConversations,
  initialMetrics,
  isSuperAdmin,
  initialDomain,
  initialRwgConfig,
  initialBookingMode,
  initialBookingUrl,
  initialGeneralOperatingHours,
  initialOperatingHoursOverrides,
  initialHolidaySettings,
  initialGoogleConnected,
  initialGlobalVoiceDisclaimer,
  initialServices = [],
  initialStaff = [],
  billingData,
  superadminData,
  isImpersonating,
  initialBusinessAddress,
  initialPostcode,
}: DashboardClientProps) {
  const storeInitialized = React.useRef(false);
  if (!storeInitialized.current) {
    useDashboardStore.setState({
      tenantId,
      tenantName,
      userEmail,
      userName,
      isSuperAdmin,
      chatbots: initialChatbots,
      conversations: initialConversations,
      metrics: initialMetrics,
      billingData,
      superadminData,
      domain: initialDomain || '',
      rwgConfig: initialRwgConfig || {},
      bookingMode: initialBookingMode || 'single_calendar',
      bookingUrl: initialBookingUrl || '',
      generalOperatingHours: initialGeneralOperatingHours || {},
      operatingHoursOverrides: initialOperatingHoursOverrides || [],
      holidaySettings: initialHolidaySettings || {},
      isGoogleConnected: initialGoogleConnected || false,
      businessAddress: initialBusinessAddress || '',
      postcode: initialPostcode || '',
    });
    storeInitialized.current = true;
  }

  const { 
    chatbots, setChatbots,
    conversations, setConversations,
    metrics, setMetrics,
    activeTab, setActiveTab,
    isMobileMenuOpen, setIsMobileMenuOpen,
    domain, setDomain,
    rwgConfig, setRwgConfig,
    services, setServices,
    staff, setStaff
  } = useDashboardStore();
  
  // Sync initial services/staff into store
  useEffect(() => {
    if (initialServices.length > 0 && services.length === 0) setServices(initialServices);
    if (initialStaff.length > 0 && staff.length === 0) setStaff(initialStaff);
  }, [initialServices, initialStaff, services.length, staff.length, setServices, setStaff]);

  const [isSavingAccountSettings, setIsSavingAccountSettings] = useState(false);

  const handleSaveAccountSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAccountSettings(true);
    try {
      const response = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          domain: domain,
          rwgConfig: rwgConfig
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save account settings');
      }
      alert('Account settings saved successfully!');
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setIsSavingAccountSettings(false);
    }
  };

const globalBotId = '00000000-0000-0000-0000-000000000000';
// Form states
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);


  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);

  // Reserve with Google State
  
  
  

  // Scheduling State
  const [isFetchingScheduling, setIsFetchingScheduling] = useState(false);

  const [bookingMode, setBookingMode] = useState(initialBookingMode || 'single_calendar');
  const [bookingUrl, setBookingUrl] = useState(initialBookingUrl || '');

  const [showAddService, setShowAddService] = useState(false);
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);



  const [activeWeekIndex, setActiveWeekIndex] = useState(0);

  // Initialize Supabase browser client
  const supabaseUrl = process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

  const isDev = serverDevMode || !supabase;

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/login';
    }
  };

  // Auto-select first real chatbot for crawler if available
  useEffect(() => {
    const realBots = chatbots.filter(b => b.id !== globalBotId);
  }, [chatbots]);



  // Create Chatbot handler
  const handleCreateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName.trim()) return;

    setIsCreatingBot(true);
    let successfullySaved = false;
    const newId = crypto.randomUUID();
    const newChatbot: Chatbot = {
      id: newId,
      name: newBotName,
      primary_color: newBotColor,
      configuration_json: {
        welcome_message: newBotWelcome,
        agent_name: newAgentName.trim() || newBotName,
        agent_role: newAgentRole.trim(),
        agent_avatar_url: newAgentAvatar,
      },
      created_at: new Date().toISOString(),
    };

    try {
      // Always route through API endpoints to bypass RLS issues and function even if client-side Supabase client is uninitialized
      const response = await fetch('/api/chatbots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          tenant_id: tenantId,
          name: newBotName,
          primary_color: newBotColor,
          configuration_json: {
            welcome_message: newBotWelcome,
            agent_name: newAgentName.trim() || newBotName,
            agent_role: newAgentRole.trim(),
            agent_avatar_url: newAgentAvatar,
          },
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      successfullySaved = true;
    } catch (err: any) {
      console.error('Failed to save chatbot to database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err.message}`);
      }
    }

    if (successfullySaved) {
      setChatbots([newChatbot, ...chatbots]);
      setMetrics((prev) => ({
        ...prev,
        chatbotsCount: prev.chatbotsCount + 1,
      }));
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
    }
    setIsCreatingBot(false);
  };

  const handleUpdateChatbot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBotId || !newBotName.trim()) return;

    setIsCreatingBot(true);
    let successfullySaved = false;

    const updatedConfig = {
      welcome_message: newBotWelcome,
      agent_name: newAgentName.trim() || newBotName,
      agent_role: newAgentRole.trim(),
      agent_avatar_url: newAgentAvatar,
    };

    try {
      // Always route through API endpoints to bypass RLS issues and function even if client-side Supabase client is uninitialized
      const response = await fetch(`/api/chatbots/${encodeURIComponent(editingBotId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBotName,
          primary_color: newBotColor,
          configuration_json: updatedConfig,
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      successfullySaved = true;
    } catch (err: any) {
      console.error('Failed to update chatbot in database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err.message}`);
      }
    }

    if (successfullySaved) {
      setChatbots(chatbots.map(bot => bot.id === editingBotId ? {
        ...bot,
        name: newBotName,
        primary_color: newBotColor,
        configuration_json: updatedConfig
      } : bot));
      
      setEditingBotId(null);
      setNewBotName('');
      setNewBotWelcome('Hello! How can I help you today?');
      setNewAgentName('');
      setNewAgentRole('AI Assistant');
      setNewAgentAvatar('/avatars/avatar1.png');
    }
    setIsCreatingBot(false);
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGlobal(true);
    try {
      const globalBot = chatbots.find(b => b.id === globalBotId);
      const currentConfig = globalBot?.configuration_json || {};
      const newConfig = {
        ...currentConfig,
        branding_html: globalBrandingHtml,
        branding_url: globalTrackingUrl,
      };

      const response = await fetch(`/api/chatbots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'GLOBAL_PLATFORM_SETTINGS',
          primary_color: '#000000',
          configuration_json: newConfig,
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      
      if (!supabase) return;
      const { error } = await supabase
        .from('chatbots')
        .upsert({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'Global Branding Bot',
          primary_color: '#000000',
          configuration_json: newConfig
        }, { onConflict: 'id' });
        
      if (error) throw error;
      setChatbots(prev => {
        const others = prev.filter(b => b.id !== globalBotId);
        return [...others, {
          id: globalBotId,
          name: 'Global Branding Bot',
          primary_color: '#000000',
          configuration_json: newConfig,
          created_at: globalBot?.created_at || new Date().toISOString()
        }];
      });
      alert('Global branding saved successfully!');
    } catch (err: any) {
      alert('Failed to save global branding: ' + err.message);
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleSaveDisclaimer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGlobal(true);
    try {
      const globalBot = chatbots.find(b => b.id === globalBotId);
      const currentConfig = globalBot?.configuration_json || {};
      const newConfig = {
        ...currentConfig,
        global_voice_disclaimer: globalVoiceDisclaimer,
      };

      const response = await fetch(`/api/chatbots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'GLOBAL_PLATFORM_SETTINGS',
          primary_color: '#000000',
          configuration_json: newConfig,
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      
      if (!supabase) return;
      const { error } = await supabase
        .from('chatbots')
        .upsert({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'Global Branding Bot',
          primary_color: '#000000',
          configuration_json: newConfig
        }, { onConflict: 'id' });
        
      if (error) throw error;
      setChatbots(prev => {
        const others = prev.filter(b => b.id !== globalBotId);
        return [...others, {
          id: globalBotId,
          name: 'Global Branding Bot',
          primary_color: '#000000',
          configuration_json: newConfig,
          created_at: globalBot?.created_at || new Date().toISOString()
        }];
      });
      alert('Global disclaimer saved successfully!');
    } catch (err: any) {
      alert('Failed to save global disclaimer: ' + err.message);
    } finally {
      setIsSavingGlobal(false);
    }
  };


  // Scheduling Handlers

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-gray-100 overflow-hidden font-sans">
      {isImpersonating && (
        <div className="bg-amber-600 text-white font-bold py-3 px-6 text-center w-full shadow-lg border-b border-amber-700 flex justify-between items-center z-[200]">
          <span>⚠️ SUPER ADMIN IMPERSONATION MODE: You are viewing data as {tenantName}</span>
          <a href="/dashboard" className="bg-black/20 hover:bg-black/40 px-4 py-1.5 rounded-lg text-sm transition-colors border border-white/10 shrink-0">Exit Impersonation</a>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile Menu Backdrop */}
        {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/80 z-40 backdrop-blur-sm" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-50 transition-transform duration-300 w-64 h-full flex-shrink-0 border-r border-white/5 bg-[#09090b] md:bg-black/40 backdrop-blur-2xl flex flex-col justify-between`}>
         <div className="p-6">
            <div className="flex items-center justify-between mb-10 pl-2">
               <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20"></div>
                 <span className="font-extrabold text-xl tracking-tight text-white">StyleFlo</span>
               </div>
               <button className="md:hidden p-2 -mr-2 text-gray-400 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
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
                { id: 'account', label: 'Account Settings', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /> },
                ...(isSuperAdmin && !isImpersonating ? [
                  { id: 'settings', label: 'Platform Settings', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /> },
                  { id: 'superadmin_voices', label: 'Voice Personas', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /> }
                ] : []),
              ].map(tab => (
                 <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-300 border border-transparent ${activeTab === tab.id ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-sm shadow-indigo-500/5' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 hover:border-white/5'}`}>
                    <div className="flex items-center gap-3">
                       <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">{tab.icon}</svg>
                       {tab.label}
                    </div>
                    {tab.count !== undefined && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${activeTab === tab.id ? 'bg-indigo-500/20 text-indigo-300' : 'bg-gray-800 text-gray-500'}`}>
                        {tab.count}
                      </span>
                    )}
                 </button>
              ))}
            </nav>
         </div>
         <div className="p-4 border-t border-white/5">
            <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group cursor-pointer border border-transparent hover:border-white/5" onClick={handleSignOut} title="Sign Out">
               <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-white flex items-center justify-center font-bold text-sm shadow-lg">
                    {userName[0]}
                  </div>
                  <div className="flex flex-col text-left">
                     <span className="text-sm font-semibold text-white leading-tight">{userName}</span>
                     <span className="text-[10px] text-gray-500 truncate w-28">{userEmail}</span>
                  </div>
               </div>
               <svg className="w-4 h-4 text-gray-600 group-hover:text-red-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </div>
         </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none -z-10"></div>
        
        <div className="flex-1 overflow-y-auto styleflo-scrollbar p-4 md:p-8 lg:p-12 z-10 space-y-6 md:space-y-8">
           <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 md:mb-8 gap-4">
              <div className="flex items-center gap-3 w-full">
                 <button className="md:hidden p-2 -ml-2 text-gray-300 hover:text-white" onClick={() => setIsMobileMenuOpen(true)}>
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                 </button>
                 <div className="flex-1">
                    <h1 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 capitalize truncate">
                   {activeTab === 'chatbots' ? 'Chatbots Manager' : 
                    activeTab === 'scheduling' ? 'Scheduling & Staff' :
                    activeTab === 'conversations' ? 'Inbox & Logs' :
                    activeTab === 'crawler' ? 'Knowledge Base' :
                    activeTab === 'billing' ? 'Billing & Usage' :
                    activeTab === 'superadmin_voices' ? 'Voice Personas Management' :
                    activeTab.replace('_', ' ')}
                 </h1>
                 <p className="text-sm text-gray-400 mt-1">Workspace: <span className="text-indigo-400 font-semibold">{tenantName}</span></p>
                 </div>
              </div>
              {isDev && (
                 <div className="bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-indigo-500/10">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    <span className="text-[10px] tracking-wider uppercase text-indigo-300 font-bold">Dev Mode Active</span>
                 </div>
              )}
           </header>

           <div className="w-full space-y-8">

          {/* Chatbots Tab */}
          {activeTab === 'chatbots' && <ChatbotManagerView />}

          {/* Crawler Tab */}
          {activeTab === 'crawler' && <KnowledgeBaseView />}

          {/* Conversations Tab */}
          {activeTab === 'conversations' && <InboxView />}

          {/* Superadmin Voices Tab */}
          {activeTab === 'superadmin_voices' && isSuperAdmin && !isImpersonating && <SuperAdminVoiceManagerView />}

          {/* Billing & Usage Tab */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              {/* Standard Tenant View */}
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Current Plan: <span className="text-indigo-400 uppercase tracking-widest">{billingData?.planTier || 'Basic'}</span></h3>
                    <p className="text-xs text-gray-400 mt-1">Manage your usage limits and active entitlements.</p>
                  </div>
                  <a href="https://styleflo.ai/pricing" target="_blank" rel="noopener noreferrer" className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg transition-colors">
                    Compare & Upgrade Plans
                  </a>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Chunks Progress */}
                  <div className="bg-gray-950 p-5 rounded-xl border border-gray-800">
                    <h4 className="text-sm font-bold text-white mb-2">Knowledge Base Data Chunks</h4>
                    <div className="flex justify-between text-xs text-gray-400 mb-2">
                      <span>{billingData?.usage?.chunks || 0} used</span>
                      <span>
                        {billingData?.entitlements?.find((e: any) => e.feature_id === 'knowledge_data_chunks')?.included_volume || 0} total
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2.5">
                      <div className="bg-indigo-500 h-2.5 rounded-full" style={{ width: `${Math.min(100, ((billingData?.usage?.chunks || 0) / (billingData?.entitlements?.find((e: any) => e.feature_id === 'knowledge_data_chunks')?.included_volume || 1)) * 100)}%`}}></div>
                    </div>
                  </div>

                  {/* Message Allowance */}
                  <div className="bg-gray-950 p-5 rounded-xl border border-gray-800">
                    <h4 className="text-sm font-bold text-white mb-2">Monthly Message Allowance</h4>
                    <div className="flex justify-between text-xs text-gray-400 mb-2">
                      <span>{billingData?.usage?.messages || 0} messages used this month</span>
                      <span>
                        {billingData?.entitlements?.find((e: any) => e.feature_id === 'message_allowance')?.included_volume === -1 ? 'Unlimited' : (billingData?.entitlements?.find((e: any) => e.feature_id === 'message_allowance')?.included_volume || 0) + ' total'}
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2.5">
                      <div className="bg-emerald-500 h-2.5 rounded-full" style={{ width: `${billingData?.entitlements?.find((e: any) => e.feature_id === 'message_allowance')?.included_volume === -1 ? 100 : Math.min(100, ((billingData?.usage?.messages || 0) / (billingData?.entitlements?.find((e: any) => e.feature_id === 'message_allowance')?.included_volume || 1)) * 100)}%`}}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Superadmin Overview */}
              {isSuperAdmin && superadminData && (
                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl mt-8">
                  <h3 className="text-lg font-bold text-white mb-2">Superadmin Control Center</h3>
                  <p className="text-xs text-gray-400 mb-6">Manage all tenant billing plans and monitor platform aggregate usage.</p>
                  
                  {/* Aggregate Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 text-center">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Tenants</p>
                      <p className="text-xl font-bold text-white">{superadminData.tenants?.length || 0}</p>
                    </div>
                    <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 text-center">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Platform Messages</p>
                      <p className="text-xl font-bold text-indigo-400">
                        {superadminData.usage?.filter((u: any) => u.feature_id === 'message_allowance')?.reduce((sum: number, u: any) => sum + u.quantity, 0) || 0}
                      </p>
                    </div>
                  </div>

                  {/* Tenant Override Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-300">
                      <thead className="bg-gray-950/50 text-xs uppercase text-gray-500 border-b border-gray-800">
                        <tr>
                          <th className="px-4 py-3">Tenant Name</th>
                          <th className="px-4 py-3">Tenant ID</th>
                          <th className="px-4 py-3">Active Plan</th>
                          <th className="px-4 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {superadminData.tenants?.map((t: any) => (
                          <tr key={t.id} className="hover:bg-white/5 transition-colors">
                            <td className="px-4 py-3 font-semibold">{t.company_name}</td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.id}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-800 text-gray-300">
                                {t.plan_tier}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    window.location.href = `/dashboard?tenant_id=${t.id}`;
                                  }}
                                  className="bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/50 text-amber-300 text-[10px] font-bold px-2 py-1 rounded transition-colors"
                                >
                                  Impersonate
                                </button>
                                <select 
                                  className="bg-gray-950 border border-gray-700 text-white text-xs rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500"
                                value={t.plan_tier}
                                onChange={async (e) => {
                                  const newTier = e.target.value;
                                  if(confirm(`Override ${t.company_name} to ${newTier.toUpperCase()}?`)) {
                                    try {
                                      const res = await fetch('/api/billing/override', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ targetTenantId: t.id, newTier })
                                      });
                                      if(res.ok) {
                                        alert('Plan overridden successfully. Refresh to see changes.');
                                      } else {
                                        alert('Override failed.');
                                      }
                                    } catch(err) {
                                      alert('Error overriding plan.');
                                    }
                                  }
                                }}
                              >
                                <option value="basic">Basic</option>
                                <option value="starter">Starter</option>
                                <option value="premium">Premium</option>
                                <option value="ultimate">Ultimate</option>
                                </select>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

            {/* Account Settings Tab */}
            {activeTab === 'account' && (
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">Account Settings</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Manage your workspace account preferences.</p>
                </div>

                <form onSubmit={handleSaveAccountSettings} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Custom Domain</label>
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. www.mycompany.com"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Point this domain to the webpage we are creating for you.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Business Address</label>
                    <input
                      type="text"
                      value={rwgConfig?.rwg_street_address || ''}
                      onChange={(e) => setRwgConfig({ ...rwgConfig, rwg_street_address: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. 123 Business Road"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">City</label>
                    <input
                      type="text"
                      value={rwgConfig?.rwg_city || ''}
                      onChange={(e) => setRwgConfig({ ...rwgConfig, rwg_city: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. London"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Postcode</label>
                    <input
                      type="text"
                      value={rwgConfig?.rwg_postcode || ''}
                      onChange={(e) => setRwgConfig({ ...rwgConfig, rwg_postcode: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. AB12 3CD"
                    />
                  </div>
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSavingAccountSettings}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                    >
                      {isSavingAccountSettings ? 'Saving Settings...' : 'Save Account Settings'}
                    </button>
                  </div>
                </form>
              </div>
            )}

{/* Integrations Tab */}
          {activeTab === 'integrations' && <IntegrationsView />}

          {/* Scheduling Tab */}
          {activeTab === 'scheduling' && <SchedulingView />}
            </div>
        </div>
      </main>
      </div>
    </div>
  );
}
