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
import TelephonyView from './dashboard-views/TelephonyView';
import SuperAdminVoiceManagerView from './dashboard-views/SuperAdminVoiceManagerView';
import PlatformSettingsView from './dashboard-views/PlatformSettingsView';
import MyProfileView from './dashboard-views/MyProfileView';
import OpenClawMonitorView from './dashboard-views/OpenClawMonitorView';
import SetPasswordBanner from './SetPasswordBanner';
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
    ordered_service_ids?: string[];
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
  role?: 'owner' | 'admin' | 'member';
  initialChatbots: Chatbot[];
  initialConversations: import('../lib/store').Conversation[];
  initialMetrics: Metrics;
  isSuperAdmin: boolean;
  initialDomain?: string;
  initialServices?: Record<string, unknown>[];
  initialStaff?: Record<string, unknown>[];
  initialRwgConfig?: Record<string, unknown>;
  initialBookingMode?: string;
  initialBookingUrl?: string;
  initialGeneralOperatingHours?: Record<string, unknown>;
  initialOperatingHoursOverrides?: Record<string, unknown>[];
  initialHolidaySettings?: Record<string, unknown>;
  initialGlobalVoiceDisclaimer?: string;
  billingData?: Record<string, unknown>;
  superadminData?: Record<string, unknown>;
  isImpersonating?: boolean;
  initialGoogleConnected?: boolean;
  initialBusinessAddress?: string;
  initialPostcode?: string;
  initialGoogleConnectedEmail?: string | null;
  initialTwilioShadowNumber?: string | null;

  initialTradingAddressStreet?: string;
  initialTradingAddressCity?: string;
  initialTradingAddressPostcode?: string;
  initialTradingAddressPhone?: string;
  initialCompanyRegistrationNumber?: string;
  initialRegisteredAddressStreet?: string;
  initialRegisteredAddressCity?: string;
  initialRegisteredAddressPostcode?: string;
  initialIsRegisteredCompany?: boolean;
  initialRegisteredAddressSameAsTrading?: boolean;
  initialRwgAddressSameAsTrading?: boolean;
  initialAppointments?: Record<string, unknown>[];
}

export default function DashboardClient({
  isDevMode: serverDevMode,
  tenantId,
  tenantName,
  userEmail,
  userName,
  role = 'owner',
  initialChatbots,
  initialConversations,
  initialMetrics,
  isSuperAdmin,
  initialDomain,
  initialRwgConfig,
  initialBookingMode,
  initialBookingUrl,
  initialGeneralOperatingHours = {},
  initialFlexibleBreaks = true,
  initialIs247 = false,
  initialOpenPublicHolidays = false,
  initialMaxAdvanceWeeks = 12,
  initialOperatingHoursOverrides = [],
  initialHolidaySettings = {},
  initialGoogleConnected = false,
  initialGoogleConnectedEmail = null,
  initialGlobalVoiceDisclaimer,
  initialServices = [],
  initialStaff = [],
  initialAppointments = [],
  billingData,
  superadminData,
  isImpersonating,
  initialBusinessAddress,
  initialPostcode,
  initialTwilioShadowNumber,

  initialTradingAddressStreet,
  initialTradingAddressCity,
  initialTradingAddressPostcode,
  initialTradingAddressPhone,
  initialCompanyRegistrationNumber,
  initialRegisteredAddressStreet,
  initialRegisteredAddressCity,
  initialRegisteredAddressPostcode,
  initialIsRegisteredCompany,
  initialRegisteredAddressSameAsTrading,
  initialRwgAddressSameAsTrading,
}: DashboardClientProps) {
  // Synchronize state with store whenever props or tenantId change
  useEffect(() => {
    useDashboardStore.setState({
      tenantId,
      tenantName,
      userEmail,
      userName,
      isSuperAdmin,
      role,
      chatbots: initialChatbots || [],
      conversations: initialConversations || [],
      services: initialServices || [],
      staff: initialStaff || [],
      appointments: initialAppointments || [],
      metrics: initialMetrics,
      billingData,
      superadminData,
      domain: initialDomain || '',
      rwgConfig: initialRwgConfig || {},
      bookingMode: initialBookingMode || 'single_calendar',
      bookingUrl: initialBookingUrl || '',
      generalOperatingHours: initialGeneralOperatingHours || {},
      flexibleBreaks: initialFlexibleBreaks !== false,
      is247: initialIs247 || false,
      openPublicHolidays: initialOpenPublicHolidays || false,
      maxAdvanceWeeks: initialMaxAdvanceWeeks || 12,
      operatingHoursOverrides: initialOperatingHoursOverrides || [],
      holidaySettings: initialHolidaySettings || {},
      isGoogleConnected: initialGoogleConnected || false,
      googleConnectedEmail: initialGoogleConnectedEmail || null,
      businessAddress: initialBusinessAddress || '',
      postcode: initialPostcode || '',
      twilioShadowNumber: initialTwilioShadowNumber || null,

      tradingAddressStreet: initialTradingAddressStreet || '',
      tradingAddressCity: initialTradingAddressCity || '',
      tradingAddressPostcode: initialTradingAddressPostcode || '',
      tradingAddressPhone: initialTradingAddressPhone || '',
      companyRegistrationNumber: initialCompanyRegistrationNumber || '',
      registeredAddressStreet: initialRegisteredAddressStreet || '',
      registeredAddressCity: initialRegisteredAddressCity || '',
      registeredAddressPostcode: initialRegisteredAddressPostcode || '',
      isRegisteredCompany: initialIsRegisteredCompany || false,
      registeredAddressSameAsTrading: initialRegisteredAddressSameAsTrading !== false,
      rwgAddressSameAsTrading: initialRwgAddressSameAsTrading !== false,
    });
  }, [
    tenantId,
    tenantName,
    userEmail,
    userName,
    isSuperAdmin,
    initialChatbots,
    initialConversations,
    initialServices,
    initialStaff,
    initialAppointments,
    initialMetrics,
    billingData,
    superadminData,
    initialDomain,
    initialRwgConfig,
    initialBookingMode,
    initialBookingUrl,
    initialGeneralOperatingHours,
    initialOperatingHoursOverrides,
    initialHolidaySettings,
    initialGoogleConnected,
    initialGoogleConnectedEmail,
    initialBusinessAddress,
    initialPostcode,
    initialTwilioShadowNumber,

    initialTradingAddressStreet,
    initialTradingAddressCity,
    initialTradingAddressPostcode,
    initialTradingAddressPhone,
    initialCompanyRegistrationNumber,
    initialRegisteredAddressStreet,
    initialRegisteredAddressCity,
    initialRegisteredAddressPostcode,
    initialIsRegisteredCompany,
    initialRegisteredAddressSameAsTrading,
    initialRwgAddressSameAsTrading,
  ]);

  const { 
    chatbots, setChatbots,
    conversations, setConversations,
    metrics, setMetrics,
    activeTab, setActiveTab,
    isMobileMenuOpen, setIsMobileMenuOpen,
    domain, setDomain,
    rwgConfig, setRwgConfig,
    twilioShadowNumber, setTwilioShadowNumber,
    services, setServices,
    staff, setStaff,

    tradingAddressStreet, setTradingAddressStreet,
    tradingAddressCity, setTradingAddressCity,
    tradingAddressPostcode, setTradingAddressPostcode,
    tradingAddressPhone, setTradingAddressPhone,
    companyRegistrationNumber, setCompanyRegistrationNumber,
    registeredAddressStreet, setRegisteredAddressStreet,
    registeredAddressCity, setRegisteredAddressCity,
    registeredAddressPostcode, setRegisteredAddressPostcode,
    isRegisteredCompany, setIsRegisteredCompany,
    registeredAddressSameAsTrading, setRegisteredAddressSameAsTrading,
    rwgAddressSameAsTrading, setRwgAddressSameAsTrading,
  } = useDashboardStore();

  const [isSavingAccountSettings, setIsSavingAccountSettings] = useState(false);

  const handleSaveAccountSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAccountSettings(true);
    try {
      // Build final configurations based on auto-sync checkboxes
      let finalRwgConfig = { ...(rwgConfig || {}) };
      if (rwgAddressSameAsTrading) {
        finalRwgConfig.rwg_street_address = tradingAddressStreet;
        finalRwgConfig.rwg_city = tradingAddressCity;
        finalRwgConfig.rwg_postcode = tradingAddressPostcode;
        finalRwgConfig.rwg_phone = tradingAddressPhone;
      }
      
      let finalRegisteredAddressStreet = registeredAddressStreet;
      let finalRegisteredAddressCity = registeredAddressCity;
      let finalRegisteredAddressPostcode = registeredAddressPostcode;
      if (registeredAddressSameAsTrading) {
        finalRegisteredAddressStreet = tradingAddressStreet;
        finalRegisteredAddressCity = tradingAddressCity;
        finalRegisteredAddressPostcode = tradingAddressPostcode;
      }

      const response = await fetch('/api/tenants/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          domain: domain,
          rwgConfig: {
            ...finalRwgConfig,
            is_registered_business_address: registeredAddressSameAsTrading // Sync legacy field for compatibility
          },
          tradingAddressStreet,
          tradingAddressCity,
          tradingAddressPostcode,
          tradingAddressPhone,
          companyRegistrationNumber,
          registeredAddressStreet: finalRegisteredAddressStreet,
          registeredAddressCity: finalRegisteredAddressCity,
          registeredAddressPostcode: finalRegisteredAddressPostcode,
          isRegisteredCompany,
          registeredAddressSameAsTrading,
          rwgAddressSameAsTrading
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save account settings');
      }

      // Sync updated settings to the store
      setRwgConfig({
        ...finalRwgConfig,
        is_registered_business_address: registeredAddressSameAsTrading
      });
      if (registeredAddressSameAsTrading) {
        setRegisteredAddressStreet(tradingAddressStreet);
        setRegisteredAddressCity(tradingAddressCity);
        setRegisteredAddressPostcode(tradingAddressPostcode);
      }

      alert('Account settings saved successfully!');
    } catch (err: unknown) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingAccountSettings(false);
    }
  };

  const [accountOldPassword, setAccountOldPassword] = useState('');
  const [accountNewPassword, setAccountNewPassword] = useState('');
  const [accountConfirmPassword, setAccountConfirmPassword] = useState('');
  const [isUpdatingAccountPassword, setIsUpdatingAccountPassword] = useState(false);
  const [accountPasswordMsg, setAccountPasswordMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const handleAccountPasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountPasswordMsg(null);

    if (!accountOldPassword) {
      setAccountPasswordMsg({ text: 'Please enter your current password to confirm changes.', isError: true });
      return;
    }

    if (accountNewPassword.length < 6) {
      setAccountPasswordMsg({ text: 'Password must be at least 6 characters long.', isError: true });
      return;
    }

    if (accountNewPassword !== accountConfirmPassword) {
      setAccountPasswordMsg({ text: 'Passwords do not match.', isError: true });
      return;
    }

    setIsUpdatingAccountPassword(true);
    try {
      if (supabase) {
        // First verify the old password by attempting a sign-in
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: accountOldPassword,
        });

        if (signInError) {
          throw new Error('Incorrect current password. Please try again.');
        }

        const { error } = await supabase.auth.updateUser({
          password: accountNewPassword,
          data: { has_set_password: true }
        });
        if (error) throw error;
        
        if (typeof window !== 'undefined') {
          localStorage.setItem('styleflo_password_set', 'true');
        }

        setAccountPasswordMsg({ text: '🔐 Password updated successfully! You can now log in anytime using your password.', isError: false });
        setAccountOldPassword('');
        setAccountNewPassword('');
        setAccountConfirmPassword('');
      } else {
        throw new Error("Supabase client not initialized.");
      }
    } catch (err: any) {
      console.error('Error setting password in Account Settings:', err);
      setAccountPasswordMsg({ text: err.message || 'Failed to update password. Please try again.', isError: true });
    } finally {
      setIsUpdatingAccountPassword(false);
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
    } catch (err: unknown) {
      console.error('Failed to save chatbot to database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (err: unknown) {
      console.error('Failed to update chatbot in database:', err);
      if (!supabase) {
        console.warn('Operating in visual-only mode, mockup saving locally.');
        successfullySaved = true;
      } else {
        alert(`Failed to save to database: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (err: unknown) {
      alert('Failed to save global branding: ' + (err instanceof Error ? err.message : String(err)));
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
    } catch (err: unknown) {
      alert('Failed to save global disclaimer: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingGlobal(false);
    }
  };


  // Scheduling Handlers

  return (
    <div className="flex flex-col min-h-0 bg-[var(--awb-color1)] text-[var(--awb-color7)] font-sans rounded-2xl border border-[var(--awb-color3)] shadow-sm overflow-hidden">
      {isImpersonating && (
        <div className="bg-amber-600 text-white font-bold py-3 px-6 text-center w-full shadow-lg border-b border-amber-700 flex justify-between items-center z-[200]">
          <span>⚠️ SUPER ADMIN IMPERSONATION MODE: You are viewing data as {tenantName}</span>
          <a href="/dashboard" className="bg-black/20 hover:bg-black/40 px-4 py-1.5 rounded-lg text-sm transition-colors border border-white/10 shrink-0">Exit Impersonation</a>
        </div>
      )}
      <div className="flex flex-1">
        {/* Mobile Menu Backdrop */}
        {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-50 transition-transform duration-300 w-64 h-full flex-shrink-0 border-r border-[var(--awb-color3)] bg-[var(--awb-color2)] flex flex-col justify-between`}>
         <div className="p-6">
             <div className="flex items-center justify-end mb-6 pl-2">
               <button className="md:hidden p-2 -mr-2 text-[var(--awb-color6)] hover:text-[var(--awb-color7)]" onClick={() => setIsMobileMenuOpen(false)}>
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
               </button>
             </div>
            <nav className="space-y-1.5">
              {(role === 'member' 
                ? [
                    { id: 'scheduling', label: 'Scheduling & Staff', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
                    { id: 'my-profile', label: 'My Profile & Calendar', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /> }
                  ]
                : [
                    { id: 'chatbots', label: 'Chatbot', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />, count: (chatbots || []).filter(b => b.id !== globalBotId).length },
                    { id: 'scheduling', label: 'Scheduling & Staff', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
                    { id: 'conversations', label: 'Communications', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />, count: (conversations || []).filter(c => c && !c.is_phone_call).length },
                    { id: 'crawler', label: 'Knowledge Base', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /> },
                    { id: 'integrations', label: 'Integrations', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /> },
                    ...(isSuperAdmin ? [{ id: 'openclaw-monitor', label: 'Gateways', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /> }] : []),
                    { id: 'telephony', label: 'Phone Calls', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />, count: (conversations || []).filter(c => c && (c.is_phone_call || (c.is_voice_call && c.user_session_id?.startsWith('phone_')))).length },
                    { id: 'billing', label: 'Billing & Usage', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /> },
                    { id: 'account', label: 'Account Settings', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /> },
                  ]
              ).map(tab => (
                 <button key={tab.id} onClick={() => { setActiveTab(tab.id as ReturnType<typeof useDashboardStore.getState>['activeTab']); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-200 border ${activeTab === tab.id ? 'bg-[var(--awb-color1)] text-[var(--awb-color8)] border-[var(--awb-color3)] shadow-sm' : 'text-[var(--awb-color6)] hover:text-[var(--awb-color7)] hover:bg-[var(--awb-color1)]/60 border-transparent'}`}>
                    <div className="flex items-center gap-3">
                       <svg className={`w-5 h-5 ${activeTab === tab.id ? 'text-[var(--awb-color5)]' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{tab.icon}</svg>
                       {tab.label}
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
                  <div className="w-8 h-8 rounded-full bg-[var(--awb-color8)] text-white flex items-center justify-center font-bold text-sm shadow">
                    {userName[0]}
                  </div>
                  <div className="flex flex-col text-left">
                     <span className="text-sm font-semibold text-[var(--awb-color8)] leading-tight">{userName}</span>
                     <span className="text-[10px] text-[var(--awb-color6)] truncate w-28">{userEmail}</span>
                  </div>
               </div>
               <svg className="w-4 h-4 text-[var(--awb-color6)] group-hover:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </div>
         </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none -z-10"></div>
        
        <div className="flex-1 overflow-y-auto styleflo-scrollbar p-0 sm:p-6 lg:p-8 space-y-4 md:space-y-8">
           <SetPasswordBanner />
           <header className="md:hidden flex items-center justify-start mb-6 px-4 pt-4">
              <button className="p-2 text-[var(--awb-color6)] hover:text-[var(--awb-color7)]" onClick={() => setIsMobileMenuOpen(true)}>
                 <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
              </button>
           </header>

           <div className="w-full space-y-8">

          {/* Chatbots Tab */}
          {activeTab === 'chatbots' && <ChatbotManagerView />}

          {/* Crawler Tab */}
          {activeTab === 'crawler' && <KnowledgeBaseView />}

          {/* Conversations Tab */}
          {activeTab === 'conversations' && <InboxView />}


          {/* Billing & Usage Tab */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              {/* Standard Tenant View */}
              <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--awb-color8)]">Current Plan: <span className="text-[var(--awb-color5)] uppercase tracking-wider font-bold">{billingData?.planTier || 'Basic'}</span></h3>
                    <p className="text-xs text-[var(--awb-color6)] mt-1">Manage your usage limits and active entitlements.</p>
                  </div>
                  <a href="https://styleflo.ai/pricing" target="_blank" rel="noopener noreferrer" className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-bold py-2.5 px-5 rounded-[4px] shadow-sm transition-colors whitespace-nowrap">
                    Compare & Upgrade Plans
                  </a>
                </div>                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Chunks Progress */}
                  <div className="bg-[var(--awb-color2)] p-5 rounded-xl border border-[var(--awb-color3)]">
                    <h4 className="text-sm font-bold text-[var(--awb-color7)] mb-2">Knowledge Base Data Chunks</h4>
                    <div className="flex justify-between text-xs text-[var(--awb-color6)] mb-2">
                      <span>{billingData?.usage?.chunks || 0} used</span>
                      <span>
                        {billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'knowledge_data_chunks')?.limit_value || 0} total
                      </span>
                    </div>
                    <div className="w-full bg-[var(--awb-color3)] rounded-full h-2.5">
                      <div className="bg-[var(--awb-color4)] h-2.5 rounded-full" style={{ width: `${Math.min(100, ((billingData?.usage?.chunks || 0) / (billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'knowledge_data_chunks')?.limit_value || 1)) * 100)}%`}}></div>
                    </div>
                  </div>

                  {/* Message Allowance */}
                  <div className="bg-[var(--awb-color2)] p-5 rounded-xl border border-[var(--awb-color3)]">
                    <h4 className="text-sm font-bold text-[var(--awb-color7)] mb-2">Monthly Message Allowance</h4>
                    <div className="flex justify-between text-xs text-[var(--awb-color6)] mb-2">
                      <span>{billingData?.usage?.messages || 0} messages used this month</span>
                      <span>
                        {billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'message_allowance')?.limit_value === -1 ? 'Unlimited' : (billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'message_allowance')?.limit_value || 0) + ' total'}
                      </span>
                    </div>
                    <div className="w-full bg-[var(--awb-color3)] rounded-full h-2.5">
                      <div className="bg-[var(--awb-color5)] h-2.5 rounded-full" style={{ width: `${billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'message_allowance')?.limit_value === -1 ? 100 : Math.min(100, ((billingData?.usage?.messages || 0) / (billingData?.entitlements?.find((e: { feature_id: string; limit_value: number }) => e.feature_id === 'message_allowance')?.limit_value || 1)) * 100)}%`}}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Superadmin Overview */}
              {isSuperAdmin && superadminData && (
                <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-sm space-y-6 mt-8">
                  <div>
                    <h3 className="text-xl font-bold text-[var(--awb-color8)]">Superadmin Control Center</h3>
                    <p className="text-xs text-[var(--awb-color6)] mt-0.5">Manage all tenant billing plans and monitor platform aggregate usage.</p>
                  </div>
                  
                  {/* Aggregate Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-4 rounded-xl text-center shadow-sm">
                      <p className="text-xs text-[var(--awb-color7)] font-bold uppercase tracking-wider mb-1 font-semibold">Total Tenants</p>
                      <p className="text-2xl font-extrabold text-[var(--awb-color8)]">{superadminData.tenants?.length || 0}</p>
                    </div>
                    <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-4 rounded-xl text-center shadow-sm">
                      <p className="text-xs text-[var(--awb-color7)] font-bold uppercase tracking-wider mb-1 font-semibold">Total Chats</p>
                      <p className="text-2xl font-extrabold text-[#198fd9]">
                        {superadminData.totalChatMessages || 0} <span className="text-sm font-semibold text-[var(--awb-color7)]">msgs</span>
                      </p>
                      <p className="text-[10px] text-[var(--awb-color6)] mt-1 font-semibold">
                        {superadminData.totalChatConversations || 0} sessions ({superadminData.monthlyChatMessages || 0} msgs this month)
                      </p>
                    </div>
                    <div className="bg-[var(--awb-color2)] border border-[var(--awb-color3)] p-4 rounded-xl text-center shadow-sm">
                      <p className="text-xs text-[var(--awb-color7)] font-bold uppercase tracking-wider mb-1 font-semibold">Total Voice Duration</p>
                      <p className="text-2xl font-extrabold text-[#9333ea]">
                        {superadminData.totalVoiceMinutes || 0} <span className="text-sm font-semibold text-[var(--awb-color7)]">mins</span>
                      </p>
                      <p className="text-[10px] text-[var(--awb-color6)] mt-1 font-semibold">
                        {superadminData.totalVoiceCalls || 0} calls ({superadminData.monthlyVoiceMinutes || 0} mins this month)
                      </p>
                    </div>
                  </div>

                  {/* Tenant Override Table */}
                  <div className="overflow-x-auto border border-[var(--awb-color3)] rounded-xl">
                    <table className="w-full text-left text-sm text-[var(--awb-color8)]">
                      <thead className="bg-[var(--awb-color2)] text-xs uppercase font-bold text-[var(--awb-color8)] border-b border-[var(--awb-color3)]">
                        <tr>
                          <th className="px-4 py-3 text-[var(--awb-color8)]">Tenant Name</th>
                          <th className="px-4 py-3 text-[var(--awb-color8)]">Tenant ID</th>
                          <th className="px-4 py-3 text-[var(--awb-color8)]">Active Plan</th>
                          <th className="px-4 py-3 text-[var(--awb-color8)]">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--awb-color3)]">
                        {superadminData.tenants?.map((t: { company_name: string; id: string; [key: string]: unknown }) => (
                          <tr key={t.id} className="hover:bg-[var(--awb-color2)]/50 transition-colors">
                            <td className="px-4 py-3 font-bold text-[var(--awb-color8)]">{t.company_name}</td>
                            <td className="px-4 py-3 font-mono text-xs text-[var(--awb-color6)]">{t.id}</td>
                            <td className="px-4 py-3">
                              <span className="px-2.5 py-1 rounded text-[10px] font-extrabold uppercase tracking-wider bg-[#260475] text-white shadow-sm">
                                {t.plan_tier}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    window.location.href = `/dashboard?tenant_id=${t.id}`;
                                  }}
                                  className="bg-[#198fd9] hover:bg-[#157ab9] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] shadow-sm transition-colors"
                                >
                                  Impersonate
                                </button>
                                <select 
                                  className="bg-white border border-[var(--awb-color3)] text-[var(--awb-color8)] font-semibold text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-[#198fd9]"
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
              <div className="bg-[var(--awb-color1)] border border-[var(--awb-color3)] p-6 rounded-2xl shadow-sm space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-[var(--awb-color8)]">Account Settings</h3>
                  <p className="text-xs text-[var(--awb-color6)] mt-0.5">Manage your workspace account preferences and login security.</p>
                </div>

                {/* Password & Security Card */}
                <div className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm">
                  <div className="flex items-center gap-3 pb-3.5 border-b border-purple-100/80">
                    <div className="w-9 h-9 rounded-xl bg-[#260475] text-white flex items-center justify-center text-base shadow-sm shrink-0">
                      🔐
                    </div>
                    <div>
                      <h4 className="text-base font-extrabold text-[#260475] tracking-tight">Password & Security</h4>
                      <p className="text-[11px] text-gray-500 font-medium">Set or update your account password to log in directly anytime</p>
                    </div>
                  </div>

                  <form onSubmit={handleAccountPasswordUpdate} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">Current Password</label>
                        <input
                          type="password"
                          value={accountOldPassword}
                          onChange={(e) => setAccountOldPassword(e.target.value)}
                          required
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="Your current password"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">New Password</label>
                        <input
                          type="password"
                          value={accountNewPassword}
                          onChange={(e) => setAccountNewPassword(e.target.value)}
                          required
                          minLength={6}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="Min 6 characters"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">Confirm New Password</label>
                        <input
                          type="password"
                          value={accountConfirmPassword}
                          onChange={(e) => setAccountConfirmPassword(e.target.value)}
                          required
                          minLength={6}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="Re-enter new password"
                        />
                      </div>
                    </div>

                    {accountPasswordMsg && (
                      <div className={`p-3 rounded-lg text-xs font-semibold ${accountPasswordMsg.isError ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                        {accountPasswordMsg.text}
                      </div>
                    )}

                    <div>
                      <button
                        type="submit"
                        disabled={isUpdatingAccountPassword}
                        className="px-5 py-2.5 bg-[#260475] hover:bg-[#1e1b4b] text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                      >
                        {isUpdatingAccountPassword ? 'Updating Password...' : 'Save New Password'}
                      </button>
                    </div>
                  </form>
                </div>

                <form onSubmit={handleSaveAccountSettings} className="space-y-6">
                  {/* Custom Domain Card */}
                  <div className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm">
                    <div className="flex items-center gap-3 pb-3.5 border-b border-purple-100/80">
                      <div className="w-9 h-9 rounded-xl bg-[#260475] text-white flex items-center justify-center text-base shadow-sm shrink-0">
                        ⚙️
                      </div>
                      <div>
                        <h4 className="text-base font-extrabold text-[#260475] tracking-tight">General Information</h4>
                        <p className="text-[11px] text-gray-500 font-medium">Configure primary domain & public branding options</p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#212326] mb-1.5">Custom Domain</label>
                      <input
                        type="text"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                        placeholder="e.g. www.mycompany.com"
                      />
                      <p className="text-[10px] text-[#434549] mt-1">Point this domain to the webpage we are creating for you.</p>
                    </div>
                  </div>

                  {/* Trading Address Card */}
                  <div className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm">
                    <div className="flex items-center gap-3 pb-3.5 border-b border-purple-100/80">
                      <div className="w-9 h-9 rounded-xl bg-[#260475] text-white flex items-center justify-center text-base shadow-sm shrink-0">
                        📍
                      </div>
                      <div>
                        <h4 className="text-base font-extrabold text-[#260475] tracking-tight">Trading Address</h4>
                        <p className="text-[11px] text-gray-500 font-medium">Physical storefront location & phone routing details</p>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-1.5">
                      <p className="text-xs text-blue-900 flex items-center gap-1.5 font-bold">
                        ℹ️ About Trading Address
                      </p>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        This is the physical storefront or location where your business operates and trades. It is used by your AI assistant to answer questions about your location and provide routing directions.
                      </p>
                      <p className="text-[11px] text-amber-900 font-bold border-t border-blue-200/50 pt-1.5 mt-1.5">
                        ⚠️ If Omitted: Your AI assistant won't be able to provide directions or answers about your store location.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">Street Address</label>
                        <input
                          type="text"
                          value={tradingAddressStreet}
                          onChange={(e) => setTradingAddressStreet(e.target.value)}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="e.g. 123 Salon Street"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">City</label>
                        <input
                          type="text"
                          value={tradingAddressCity}
                          onChange={(e) => setTradingAddressCity(e.target.value)}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="e.g. London"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">Postcode</label>
                        <input
                          type="text"
                          value={tradingAddressPostcode}
                          onChange={(e) => setTradingAddressPostcode(e.target.value)}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="e.g. SW1A 1AA"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-[#212326] mb-1.5">Trading Phone Number</label>
                        <input
                          type="text"
                          value={tradingAddressPhone}
                          onChange={(e) => setTradingAddressPhone(e.target.value)}
                          className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                          placeholder="e.g. +44 123 456 7890"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Registered Business Address Card */}
                  <div className="bg-white border border-[#f2f3f5] p-6 rounded-xl space-y-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-purple-100/80 gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-[#260475] text-white flex items-center justify-center text-base shadow-sm shrink-0">
                          🏢
                        </div>
                        <div>
                          <h4 className="text-base font-extrabold text-[#260475] tracking-tight">Official Registered Address</h4>
                          <p className="text-[11px] text-gray-500 font-medium">Corporate entity details & UK CRN legal compliance</p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer bg-purple-50 hover:bg-purple-100/60 px-3 py-1.5 rounded-lg border border-purple-200/60 transition-colors">
                        <input
                          type="checkbox"
                          checked={isRegisteredCompany}
                          onChange={(e) => setIsRegisteredCompany(e.target.checked)}
                          className="w-4 h-4 text-[#198fd9] bg-white border-[#f2f3f5] rounded focus:ring-[#198fd9]"
                        />
                        <span className="text-xs font-bold text-[#260475]">Business is a registered company</span>
                      </label>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl space-y-1.5">
                      <p className="text-xs text-blue-900 flex items-center gap-1.5 font-bold">
                        ℹ️ About Registered Address
                      </p>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        This is your official registered office address and company registration number (CRN). Under UK law, registered corporate entities are legally required to display this on their website.
                      </p>
                      <p className="text-[11px] text-[#260475] font-bold border-t border-blue-200/50 pt-1.5 mt-1.5">
                        ⚠️ If Omitted: For registered UK entities, failing to display this on your website violates e-commerce regulations and may result in compliance flags or invoicing limitations.
                      </p>
                    </div>

                    {isRegisteredCompany && (
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="block text-xs font-semibold text-[#212326] mb-1.5">Company Registration Number (CRN)</label>
                          <input
                            type="text"
                            value={companyRegistrationNumber}
                            onChange={(e) => setCompanyRegistrationNumber(e.target.value)}
                            className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                            placeholder="e.g. 12345678"
                          />
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#f2f3f5]">
                          <span className="text-xs font-bold text-[#212326]">Registered Address matches Trading Address</span>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={registeredAddressSameAsTrading}
                              onChange={(e) => setRegisteredAddressSameAsTrading(e.target.checked)}
                              className="w-4 h-4 text-[#198fd9] bg-white border-[#f2f3f5] rounded focus:ring-[#198fd9]"
                            />
                            <span className="text-xs font-bold text-[#212326]">Yes, same</span>
                          </label>
                        </div>

                        {!registeredAddressSameAsTrading && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            <div className="md:col-span-2">
                              <label className="block text-xs font-semibold text-[#212326] mb-1.5">Registered Street Address</label>
                              <input
                                type="text"
                                value={registeredAddressStreet}
                                onChange={(e) => setRegisteredAddressStreet(e.target.value)}
                                className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. 456 Corporate Lane"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#212326] mb-1.5">Registered City</label>
                              <input
                                type="text"
                                value={registeredAddressCity}
                                onChange={(e) => setRegisteredAddressCity(e.target.value)}
                                className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. Edinburgh"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#212326] mb-1.5">Registered Postcode</label>
                              <input
                                type="text"
                                value={registeredAddressPostcode}
                                onChange={(e) => setRegisteredAddressPostcode(e.target.value)}
                                className="w-full h-[50px] bg-white border border-[#f2f3f5] rounded-[6px] px-3.5 py-2 text-sm text-[#212326] focus:outline-none focus:border-[#198fd9]"
                                placeholder="e.g. EH1 1BB"
                              />
                            </div>
                          </div>
                        )}
                        {registeredAddressSameAsTrading && (
                          <p className="text-xs text-[#65bd7d] font-semibold">✓ Automatically synchronized with your Trading Address.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSavingAccountSettings}
                      className="awb-btn shadow-md disabled:opacity-50"
                    >
                      {isSavingAccountSettings ? 'Saving Settings...' : 'Save Account Settings'}
                    </button>
                  </div>
                </form>
              </div>
            )}

{/* Integrations Tab */}
          {activeTab === 'integrations' && <IntegrationsView />}
          {activeTab === 'telephony' && <TelephonyView />}
          {activeTab === 'scheduling' && <SchedulingView />}
          {activeTab === 'my-profile' && <MyProfileView />}
          {activeTab === 'openclaw-monitor' && <OpenClawMonitorView />}
            </div>
        </div>
      </main>
      </div>
    </div>
  );
}
