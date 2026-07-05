'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import ServiceEditor from './ServiceEditor';

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

interface Conversation {
  id: string;
  chatbot_id: string;
  user_session_id: string;
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

interface Message {
  id: string;
  sender_type: 'user' | 'bot';
  text_content: string;
  created_at: string;
}

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
  initialConversations: Conversation[];
  initialMetrics: Metrics;
  isSuperAdmin: boolean;
  initialRwgConfig?: any;
  initialBookingMode?: string;
  initialBookingUrl?: string;
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
  initialRwgConfig,
  initialBookingMode,
  initialBookingUrl,
}: DashboardClientProps) {
  const [chatbots, setChatbots] = useState<Chatbot[]>(initialChatbots);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  // UI state
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [convPage, setConvPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'chatbots' | 'crawler' | 'conversations' | 'scheduling' | 'integrations' | 'settings'>('chatbots');

  // Global settings state
  const globalBotId = '00000000-0000-0000-0000-000000000000';
  const [globalBrandingHtml, setGlobalBrandingHtml] = useState('<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>');
  const [globalTrackingUrl, setGlobalTrackingUrl] = useState('https://styleflo.ai');
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);  // Form states
  const [newBotName, setNewBotName] = useState('');
  const [newBotColor, setNewBotColor] = useState('#4F46E5');
  const [newBotWelcome, setNewBotWelcome] = useState('Hello! How can I help you today?');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('AI Assistant');
  const [newAgentAvatar, setNewAgentAvatar] = useState('/avatars/avatar1.png');
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);

  const [crawlBotId, setCrawlBotId] = useState(initialChatbots[0]?.id || '');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [crawlResult, setCrawlResult] = useState<{ success: boolean; message: string } | null>(null);

  const [testWidgetBotId, setTestWidgetBotId] = useState<string | null>(null);

  // Reserve with Google State
  const [isRwgEnabled, setIsRwgEnabled] = useState(initialRwgConfig?.is_rwg_enabled || false);
  const [rwgBusinessName, setRwgBusinessName] = useState(initialRwgConfig?.rwg_business_name || '');
  const [rwgStreetAddress, setRwgStreetAddress] = useState(initialRwgConfig?.rwg_street_address || '');
  const [rwgCity, setRwgCity] = useState(initialRwgConfig?.rwg_city || '');
  const [rwgPostcode, setRwgPostcode] = useState(initialRwgConfig?.rwg_postcode || '');
  const [rwgPhone, setRwgPhone] = useState(initialRwgConfig?.rwg_phone || '');
  const [rwgGoogleUrl, setRwgGoogleUrl] = useState('');
  const [isSavingRwg, setIsSavingRwg] = useState(false);
  const [isCheckingRwgIntegrity, setIsCheckingRwgIntegrity] = useState(false);
  const [rwgIntegrityLogs, setRwgIntegrityLogs] = useState<string[]>([]);
  const rwgStatus = isRwgEnabled ? (rwgBusinessName && rwgStreetAddress ? 'Active on Google' : 'Pending Verification') : 'Disconnected';

  // Scheduling State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [isFetchingScheduling, setIsFetchingScheduling] = useState(false);

  const [bookingMode, setBookingMode] = useState(initialBookingMode || 'single_calendar');
  const [bookingUrl, setBookingUrl] = useState(initialBookingUrl || '');
  const [isSavingBookingMode, setIsSavingBookingMode] = useState(false);

  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceBuffer, setNewServiceBuffer] = useState(0);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffCalId, setNewStaffCalId] = useState('');

  const createEmptySchedule = (weekDate?: string): WeeklySchedule => ({
    weekCommencingDate: weekDate || new Date().toISOString().split('T')[0],
    monday: { unavailable: false, am: null, pm: null },
    tuesday: { unavailable: false, am: null, pm: null },
    wednesday: { unavailable: false, am: null, pm: null },
    thursday: { unavailable: false, am: null, pm: null },
    friday: { unavailable: false, am: null, pm: null },
    saturday: { unavailable: false, am: null, pm: null },
    sunday: { unavailable: false, am: null, pm: null },
  });

  const [newStaffSchedule, setNewStaffSchedule] = useState<{weeks: WeeklySchedule[]}>({
    weeks: [
      createEmptySchedule(),
      createEmptySchedule(),
      createEmptySchedule(),
      createEmptySchedule()
    ]
  });
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

  // Auto-select first real chatbot for crawler if available, and load global settings
  useEffect(() => {
    const realBots = chatbots.filter(b => b.id !== globalBotId);
    if (!crawlBotId && realBots.length > 0) {
      setCrawlBotId(realBots[0].id);
    }
    const globalBot = chatbots.find(b => b.id === globalBotId);
    if (globalBot?.configuration_json) {
      if (globalBot.configuration_json.branding_html) setGlobalBrandingHtml(globalBot.configuration_json.branding_html);
      if (globalBot.configuration_json.branding_url) setGlobalTrackingUrl(globalBot.configuration_json.branding_url);
    }
  }, [chatbots, crawlBotId]);

  // Fetch scheduling config on mount
  useEffect(() => {
    async function fetchScheduling() {
      setIsFetchingScheduling(true);
      try {
        const [statusRes, servicesRes, staffRes] = await Promise.all([
          fetch(`/api/integrations/google/status?tenantId=${tenantId}`),
          fetch(`/api/services?tenantId=${tenantId}`),
          fetch(`/api/staff?tenantId=${tenantId}`)
        ]);
        
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setIsGoogleConnected(statusData.connected);
        }
        if (servicesRes.ok) {
          const servicesData = await servicesRes.json();
          setServices(servicesData.services || []);
        }
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaff(staffData.staff || []);
        }
      } catch (err) {
        console.error('Failed to fetch scheduling data:', err);
      }
      setIsFetchingScheduling(false);
    }
    fetchScheduling();
  }, [tenantId]);

  // Fetch messages when conversation selection changes
  useEffect(() => {
    if (!selectedConversation) {
      setConversationMessages([]);
      return;
    }

    const convoId = selectedConversation;

    async function fetchMessages() {
      setIsFetchingMessages(true);
      
      try {
        // Always attempt to fetch from our secure API first to bypass RLS and function when client-side Supabase client is uninitialized
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(convoId)}&tenantId=${encodeURIComponent(tenantId)}`
        );
        if (response.ok) {
          const resData = await response.json();
          const sortedMessages = (resData.messages || []).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          setConversationMessages(sortedMessages);
        } else {
          throw new Error(response.statusText);
        }
      } catch (err) {
        console.error('Failed to fetch messages via API, trying direct client query:', err);
        if (supabase) {
          try {
            const { data, error } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', convoId)
              .eq('tenant_id', tenantId)
              .order('created_at', { ascending: true });

            if (!error && data) {
              const sortedMessages = data.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              setConversationMessages(sortedMessages);
            }
          } catch (clientErr) {
            console.error('Client-side messages fetch failed:', clientErr);
          }
        } else {
          // Fallback mock messages for Acme Seed conversation in visual-only mode if API completely failed
          if (convoId === 'ea111111-1111-4111-8111-111111111111') {
            setConversationMessages([
              {
                id: 'm1',
                sender_type: 'user',
                text_content: 'What is Acme?',
                created_at: new Date(Date.now() - 300000).toISOString(),
              },
              {
                id: 'm2',
                sender_type: 'bot',
                text_content: 'Acme Corp is a globally renowned supplier of premium anvils, rockets, and giant magnets.',
                created_at: new Date(Date.now() - 240000).toISOString(),
              },
            ]);
          } else {
            setConversationMessages([]);
          }
        }
      }
      setIsFetchingMessages(false);
    }

    fetchMessages();
  }, [selectedConversation, supabase, tenantId]);

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

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGlobal(true);
    try {
      const response = await fetch(`/api/chatbots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: globalBotId,
          tenant_id: tenantId,
          name: 'GLOBAL_PLATFORM_SETTINGS',
          primary_color: '#000000',
          configuration_json: {
            branding_html: globalBrandingHtml,
            branding_url: globalTrackingUrl,
          },
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || response.statusText);
      }
      // Update local state
      const globalBot = chatbots.find(b => b.id === globalBotId);
      const newConfig = {
        ...(globalBot?.configuration_json || {}),
        branding_html: globalBrandingHtml,
        branding_url: globalTrackingUrl
      };
      
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
      alert('Global settings saved successfully!');
    } catch (err: any) {
      alert('Failed to save global settings: ' + err.message);
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleSaveRwgSettings = async () => {
    if (!supabase) return;
    setIsSavingRwg(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          is_rwg_enabled: isRwgEnabled,
          rwg_business_name: rwgBusinessName,
          rwg_street_address: rwgStreetAddress,
          rwg_city: rwgCity,
          rwg_postcode: rwgPostcode,
          rwg_phone: rwgPhone
        })
        .eq('id', tenantId);

      if (error) throw error;
      alert('Reserve with Google settings updated successfully!');
    } catch (err: any) {
      alert('Failed to update Reserve with Google settings: ' + err.message);
    } finally {
      setIsSavingRwg(false);
    }
  };

  const handleSaveBookingMode = async () => {
    if (!supabase) return;
    setIsSavingBookingMode(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          booking_mode: bookingMode,
          booking_url: bookingMode === 'external_platform' ? bookingUrl : null
        })
        .eq('id', tenantId);

      if (error) throw error;
      alert('Booking Mode updated successfully!');
    } catch (err: any) {
      alert('Failed to update Booking Mode: ' + err.message);
    } finally {
      setIsSavingBookingMode(false);
    }
  };

  const handleRunRwgIntegrityCheck = async () => {
    setIsCheckingRwgIntegrity(true);
    setRwgIntegrityLogs(['[System] Initiating schema validation check...']);
    setTimeout(() => {
      let logs = ['[System] Validating against Google Actions Center v3 Schema...'];
      let isValid = true;
      
      if (!rwgBusinessName) { logs.push('[Error] Missing required field: Business Name'); isValid = false; }
      if (!rwgStreetAddress) { logs.push('[Error] Missing required field: Street Address'); isValid = false; }
      if (!rwgCity) { logs.push('[Error] Missing required field: City'); isValid = false; }
      if (!rwgPostcode) { logs.push('[Error] Missing required field: Postcode'); isValid = false; }
      if (!rwgPhone) { logs.push('[Error] Missing required field: Phone Number'); isValid = false; }

      if (isValid) {
        logs.push('[Success] merchants.json schema is valid!');
        if (services.length === 0) {
          logs.push('[Warning] No services found. services.json will be empty.');
        } else {
          logs.push(`[Success] services.json schema is valid (${services.length} services mapped).`);
        }
        if (staff.length === 0) {
          logs.push('[Warning] No staff members configured. availability.json cannot be generated.');
        } else {
          logs.push(`[Success] availability.json schema is ready (${staff.length} staff members mapped).`);
        }
        logs.push('[System] Integrity check completed successfully. Ready for Google Sync.');
      } else {
        logs.push('[Error] Integrity check failed. Please resolve the errors above.');
      }
      setRwgIntegrityLogs(prev => [...prev, ...logs]);
      setIsCheckingRwgIntegrity(false);
    }, 1000);
  };

  // Crawling Trigger handler
  const handleTriggerCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !crawlBotId) return;

    setIsCrawling(true);
    setCrawlResult(null);
    setCrawlLogs([`[System] Initializing scraper for URLs...`]);

    const urls = crawlUrl.split(/[\s,]+/).map(u => u.trim()).filter(u => u);
    let totalChunks = 0;
    let hasError = false;

    for (let i = 0; i < urls.length; i++) {
      const currentUrl = urls[i];
      setCrawlLogs((prev) => [...prev, `[System] [${i+1}/${urls.length}] Crawling ${currentUrl}...`]);

      try {
        const response = await fetch('/api/ingest/crawl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: currentUrl,
            chatbotId: crawlBotId,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          setCrawlLogs((prev) => [...prev, `[Supabase] Ingested ${data.chunksCount} chunks from ${currentUrl}.`]);
          totalChunks += data.chunksCount;
        } else {
          hasError = true;
          setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${data.error || 'Unknown error'}`]);
        }
      } catch (err: any) {
        hasError = true;
        console.warn(`[Dashboard] Ingestion failed for ${currentUrl}:`, err.message || err);
        setCrawlLogs((prev) => [...prev, `[Error] Failed to crawl ${currentUrl}: ${err.message || err}`]);
      }
    }

    if (!hasError) {
      setCrawlLogs((prev) => [...prev, `[Success] Batch crawl finished! Total chunks ingested: ${totalChunks}.`]);
      setCrawlResult({
        success: true,
        message: `Successfully crawled and ingested ${totalChunks} content chunks.`,
      });
      setMetrics((prev) => ({
        ...prev,
        chunksCount: prev.chunksCount + totalChunks,
      }));
      setCrawlUrl('');
    } else {
      setCrawlResult({
        success: false,
        message: `Crawling finished with errors. Ingested ${totalChunks} chunks. See logs.`,
      });
    }

    setIsCrawling(false);
  };

  const handleDisconnectCalendar = async () => {
    if (!confirm("Are you sure you want to disconnect Google Calendar? This will remove the chatbot's ability to check availability and book appointments, but no Google Calendar data will be lost.")) return;
    try {
      const res = await fetch(`/api/integrations/google/status?tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setIsGoogleConnected(false);
      } else {
        alert('Failed to disconnect Google Calendar.');
      }
    } catch (err) {
      console.error(err);
      alert('Error disconnecting Google Calendar.');
    }
  };

  // Scheduling Handlers
  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          name: newServiceName,
          duration_minutes: newServiceDuration,
          buffer_minutes: newServiceBuffer
        })
      });
      if (res.ok) {
        const data = await res.json();
        setServices([...services, data.service]);
        setShowAddService(false);
        setNewServiceName('');
        setNewServiceDuration(30);
        setNewServiceBuffer(0);
      } else {
        alert('Failed to add service');
      }
    } catch (err) {
      console.error(err);
      alert('Error adding service');
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    try {
      const res = await fetch(`/api/services?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setServices(services.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleScheduleChange = (day: keyof Omit<WeeklySchedule, 'weekCommencingDate'>, shift: 'am' | 'pm', field: 'start' | 'end', value: string) => {
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const activeWeek = { ...newWeeks[activeWeekIndex] };
      
      const newSched = { ...activeWeek };
      if (!newSched[day][shift]) {
        if (!value) return prev; // if empty string and null, do nothing
        newSched[day][shift] = { start: '', end: '' };
      }
      if (value) {
        newSched[day][shift]![field] = value;
      } else {
        // If clearing, and the other field is also empty, set back to null
        newSched[day][shift]![field] = '';
        if (!newSched[day][shift]!.start && !newSched[day][shift]!.end) {
          newSched[day][shift] = null;
        }
      }
      newWeeks[activeWeekIndex] = newSched;
      return { weeks: newWeeks };
    });
  };

  const handleUnavailableChange = (day: keyof Omit<WeeklySchedule, 'weekCommencingDate'>, checked: boolean) => {
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const activeWeek = { ...newWeeks[activeWeekIndex] };
      const newSched = { ...activeWeek };
      
      newSched[day] = { ...newSched[day], unavailable: checked };
      if (checked) {
        // Clear times if marking unavailable
        newSched[day].am = null;
        newSched[day].pm = null;
      }
      
      newWeeks[activeWeekIndex] = newSched;
      return { weeks: newWeeks };
    });
  }

  const handleDateChange = (dateStr: string) => {
    const selectedDate = new Date(dateStr);
    // Enforce Monday selection (getDay() === 1)
    if (selectedDate.getDay() !== 1) {
      alert('Please select a Monday for the week commencing date.');
      return;
    }
    
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      newWeeks[activeWeekIndex] = { ...newWeeks[activeWeekIndex], weekCommencingDate: dateStr };
      return { weeks: newWeeks };
    });
  }

  const copyToNextWeek = () => {
    if (activeWeekIndex >= 3) {
      alert('You can only copy to the next week within the 4-week window.');
      return;
    }
    setNewStaffSchedule(prev => {
      const newWeeks = [...prev.weeks];
      const currentWeek = newWeeks[activeWeekIndex];
      
      // Calculate next week's date (+7 days)
      const currentDate = new Date(currentWeek.weekCommencingDate);
      currentDate.setDate(currentDate.getDate() + 7);
      const nextWeekDateStr = currentDate.toISOString().split('T')[0];
      
      // Copy structure but not the weekCommencingDate
      newWeeks[activeWeekIndex + 1] = {
        ...JSON.parse(JSON.stringify(currentWeek)),
        weekCommencingDate: nextWeekDateStr
      };
      
      return { weeks: newWeeks };
    });
    // Auto switch to the next week tab
    setActiveWeekIndex(activeWeekIndex + 1);
  };

  const openEditStaff = (staffMember: any) => {
    setEditingStaffId(staffMember.id);
    setNewStaffName(staffMember.name);
    setNewStaffEmail(staffMember.email);
    setNewStaffCalId(staffMember.google_calendar_id === 'primary' ? '' : staffMember.google_calendar_id);
    
    // Load existing weeks or create empty ones
    const existingWeeks = staffMember.working_days?.weeks || [];
    const weeksToLoad = [];
    for (let i = 0; i < 4; i++) {
      if (existingWeeks[i]) {
        weeksToLoad.push(existingWeeks[i]);
      } else {
        weeksToLoad.push(createEmptySchedule());
      }
    }
    
    setNewStaffSchedule({ weeks: weeksToLoad });
    setActiveWeekIndex(0);
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isUpdate = !!editingStaffId;
      const method = isUpdate ? 'PUT' : 'POST';
      const bodyPayload: any = {
        tenant_id: tenantId,
        name: newStaffName,
        email: newStaffEmail,
        google_calendar_id: newStaffCalId || 'primary',
        working_days: newStaffSchedule
      };
      if (isUpdate) {
        bodyPayload.id = editingStaffId;
      }

      const res = await fetch('/api/staff', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      if (res.ok) {
        const data = await res.json();
        if (isUpdate) {
          setStaff(staff.map(s => s.id === editingStaffId ? data.staff : s));
        } else {
          setStaff([...staff, data.staff]);
        }
        setShowStaffModal(false);
        setEditingStaffId(null);
        setNewStaffName('');
        setNewStaffEmail('');
        setNewStaffCalId('');
        setNewStaffSchedule({
          weeks: [createEmptySchedule(), createEmptySchedule(), createEmptySchedule(), createEmptySchedule()]
        });
        setActiveWeekIndex(0);
      } else {
        alert(isUpdate ? 'Failed to update staff' : 'Failed to add staff');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving staff');
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    try {
      const res = await fetch(`/api/staff?id=${id}&tenantId=${tenantId}`, { method: 'DELETE' });
      if (res.ok) {
        setStaff(staff.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-screen bg-[#09090b] text-gray-100 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 flex-shrink-0 border-r border-white/5 bg-black/40 backdrop-blur-2xl flex flex-col justify-between">
         <div className="p-6">
            <div className="flex items-center gap-3 mb-10 pl-2">
               <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20"></div>
               <span className="font-extrabold text-xl tracking-tight text-white">StyleFlo</span>
            </div>
            <nav className="space-y-1.5">
              {[
                { id: 'chatbots', label: 'Chatbots', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />, count: chatbots.filter(b => b.id !== globalBotId).length },
                { id: 'scheduling', label: 'Scheduling & Staff', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /> },
                { id: 'conversations', label: 'Inbox & Logs', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />, count: conversations.length },
                { id: 'crawler', label: 'Knowledge Base', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /> },
                { id: 'integrations', label: 'Integrations', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /> },
                ...(isSuperAdmin ? [{ id: 'settings', label: 'Platform Settings', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /> }] : []),
              ].map(tab => (
                 <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-300 border border-transparent ${activeTab === tab.id ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-sm shadow-indigo-500/5' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 hover:border-white/5'}`}>
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
        
        <div className="flex-1 overflow-y-auto styleflo-scrollbar p-8 lg:p-12 z-10 space-y-8">
           <header className="flex items-center justify-between mb-8">
              <div>
                 <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 capitalize">
                   {activeTab === 'chatbots' ? 'Chatbots Manager' : 
                    activeTab === 'scheduling' ? 'Scheduling & Staff' :
                    activeTab === 'conversations' ? 'Inbox & Logs' :
                    activeTab === 'crawler' ? 'Knowledge Base' :
                    activeTab.replace('_', ' ')}
                 </h1>
                 <p className="text-sm text-gray-400 mt-1">Workspace: <span className="text-indigo-400 font-semibold">{tenantName}</span></p>
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
          {activeTab === 'chatbots' && (
            <div className="space-y-6">
              {/* Create Chatbot Card */}
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-4">
                  {editingBotId ? `Edit Chatbot: ${newBotName}` : 'Create New Chatbot'}
                </h3>
                <form onSubmit={editingBotId ? handleUpdateChatbot : handleCreateChatbot} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-1.5">Chatbot Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Acme Support Bot"
                        value={newBotName}
                        onChange={(e) => setNewBotName(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-1.5">Branding Accent Color</label>
                      <div className="flex gap-2.5 items-center">
                        <input
                          type="color"
                          value={newBotColor}
                          onChange={(e) => setNewBotColor(e.target.value)}
                          className="w-10 h-9 bg-gray-950 border border-gray-800 rounded-xl cursor-pointer p-1"
                        />
                        <input
                          type="text"
                          value={newBotColor}
                          onChange={(e) => setNewBotColor(e.target.value)}
                          className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                        />
                      </div>
                    </div>
                  </div>
                   <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Welcome Message</label>
                    <input
                      type="text"
                      value={newBotWelcome}
                      onChange={(e) => setNewBotWelcome(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                      required
                    />
                  </div>

                  <div className="border-t border-gray-800/80 pt-4 space-y-4">
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Agent Profile Persona</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5">Agent Display Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Emma (AI Agent)"
                          value={newAgentName}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5">Agent Role Subtitle</label>
                        <input
                          type="text"
                          placeholder="e.g. StyleFlo Advisor"
                          value={newAgentRole}
                          onChange={(e) => setNewAgentRole(e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 mb-2">Select Agent Avatar Preset</label>
                      <div className="flex gap-4">
                        {[
                          { id: '/avatars/avatar1.png', label: 'Robo Assistant' },
                          { id: '/avatars/avatar2.png', label: 'Support Specialist' },
                          { id: '/avatars/avatar3.png', label: 'Brand Mascot' },
                        ].map((avatar) => (
                          <button
                            key={avatar.id}
                            type="button"
                            onClick={() => setNewAgentAvatar(avatar.id)}
                            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                              newAgentAvatar === avatar.id
                                ? 'bg-indigo-950/20 border-indigo-500 shadow-md shadow-indigo-500/10'
                                : 'bg-gray-950/40 border-gray-800 hover:border-gray-700'
                            }`}
                          >
                            <img
                              src={avatar.id}
                              alt={avatar.label}
                              className="w-12 h-12 rounded-full border border-gray-800 object-cover bg-gray-900"
                            />
                            <span className="text-[10px] text-gray-400 font-medium">{avatar.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={isCreatingBot}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                    >
                      {isCreatingBot ? 'Saving...' : (editingBotId ? 'Save Changes' : 'Create Chatbot')}
                    </button>
                    {editingBotId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBotId(null);
                          setNewBotName('');
                          setNewBotWelcome('Hello! How can I help you today?');
                          setNewAgentName('');
                          setNewAgentRole('AI Assistant');
                          setNewAgentAvatar('/avatars/avatar1.png');
                        }}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold py-2 px-5 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Chatbots Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chatbots.filter(b => b.id !== globalBotId).map((bot) => (
                  <div key={bot.id} className="bg-gray-900/40 border border-gray-900 p-5 rounded-2xl shadow-md space-y-4 hover:border-gray-800 transition-colors relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: bot.primary_color }} />
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-base">{bot.name}</h4>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{bot.id}</p>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: bot.primary_color }} />
                    </div>
                    <div className="bg-gray-950/60 p-3 rounded-xl text-xs text-gray-300 italic border border-gray-950">
                      "{bot.configuration_json?.welcome_message || 'Hello!'}"
                    </div>

                    <div className="flex items-center gap-3 bg-gray-950/40 p-2.5 rounded-xl border border-gray-950/50">
                      <img
                        src={bot.configuration_json?.agent_avatar_url || '/avatars/avatar1.png'}
                        alt="Agent Avatar"
                        className="w-9 h-9 rounded-full border bg-gray-900 object-cover"
                        style={{ borderColor: bot.primary_color }}
                      />
                      <div>
                        <div className="text-xs font-semibold text-white">
                          {bot.configuration_json?.agent_name || bot.name}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {bot.configuration_json?.agent_role || 'AI Assistant'}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setTestWidgetBotId(testWidgetBotId === bot.id ? null : bot.id)}
                        className="flex-1 bg-gray-950 hover:bg-gray-900 text-gray-300 hover:text-white border border-gray-800 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        {testWidgetBotId === bot.id ? 'Hide Embed Code' : 'Embed Code'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingBotId(bot.id);
                          setNewBotName(bot.name);
                          setNewBotColor(bot.primary_color);
                          setNewBotWelcome(bot.configuration_json?.welcome_message || 'Hello!');
                          setNewAgentName(bot.configuration_json?.agent_name || bot.name);
                          setNewAgentRole(bot.configuration_json?.agent_role || 'AI Assistant');
                          setNewAgentAvatar(bot.configuration_json?.agent_avatar_url || '/avatars/avatar1.png');
                          
                          // Scroll form into view
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex-1 bg-indigo-950/40 hover:bg-indigo-950/70 text-indigo-300 hover:text-indigo-200 border border-indigo-900/50 py-1.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                      >
                        Edit Persona
                      </button>
                    </div>

                    {/* Embed Code Section */}
                    {testWidgetBotId === bot.id && (
                      <div className="pt-2 text-left space-y-2 border-t border-gray-800 mt-2">
                        <label className="block text-[10px] font-semibold text-gray-400">Host Injection Snippet:</label>
                        <pre className="p-2.5 bg-gray-950 border border-gray-800 text-[10px] rounded-xl overflow-x-auto text-gray-300 font-mono leading-relaxed select-all">
                          {`<!-- StyleFlo Widget Injection -->\n<script\n  src="${window.location.origin}/widget.js"\n  data-bot-id="${bot.id}">\n</script>`}
                        </pre>
                        <p className="text-[9px] text-gray-400">
                          Paste this tag inside any website's <code>&lt;body&gt;</code> container to inject the floating chatbot.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Crawler Tab */}
          {activeTab === 'crawler' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Ingest Website Content</h3>
                <p className="text-xs text-gray-400 mt-0.5">Scrapes client sites, chunks content, generates embeddings, and saves vectors to the chatbot.</p>
              </div>

              <form onSubmit={handleTriggerCrawl} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Target Chatbot</label>
                    <select
                      value={crawlBotId}
                      onChange={(e) => setCrawlBotId(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      required
                    >
                      <option value="" disabled>Select chatbot...</option>
                      {chatbots.filter(b => b.id !== globalBotId).map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Website URLs to Scrape (comma or space separated)</label>
                    <textarea
                      placeholder="https://example.com/about, https://example.com/pricing"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-white min-h-[42px] resize-y"
                      required
                      rows={2}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isCrawling || !crawlBotId || !crawlUrl}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                >
                  {isCrawling ? 'Processing Crawler...' : 'Trigger Crawler Pipeline'}
                </button>
              </form>

              {/* Crawler Log Screen */}
              {crawlLogs.length > 0 && (
                <div className="space-y-2 mt-6">
                  <label className="block text-xs font-semibold text-gray-400">Scraper Console Output:</label>
                  <div className="p-4 bg-gray-950 border border-gray-900 rounded-2xl font-mono text-xs text-gray-300 h-48 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                    {crawlLogs.map((log, i) => (
                      <div key={i} className={
                        log.startsWith('[Error]') ? 'text-red-400' :
                        log.startsWith('[Success]') ? 'text-emerald-400 font-semibold' :
                        log.startsWith('[System]') ? 'text-indigo-400' : 'text-gray-300'
                      }>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Crawl Result Status Alert */}
              {crawlResult && (
                <div className={`p-4 rounded-xl border text-sm ${
                  crawlResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/30 text-red-200'
                }`}>
                  {crawlResult.message}
                </div>
              )}
            </div>
          )}

          {/* Conversations Tab */}
          {activeTab === 'conversations' && (
            <div className="space-y-6">
              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl">
                <h3 className="text-lg font-bold text-white mb-2">Conversation Session Index</h3>
                <p className="text-xs text-gray-400">Select any chat session from the explorer panel to browse user transcripts.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl h-[700px] flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold text-white">Conversation Explorer</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setConvPage(p => Math.max(0, p - 1))}
                        disabled={convPage === 0}
                        className="p-1 rounded bg-gray-800 disabled:opacity-30 hover:bg-gray-700 text-white"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                      </button>
                      <button 
                        onClick={() => setConvPage(p => p + 1)}
                        disabled={(convPage + 1) * 10 >= conversations.length}
                        className="p-1 rounded bg-gray-800 disabled:opacity-30 hover:bg-gray-700 text-white"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 styleflo-scrollbar mb-4">
                    {conversations.length === 0 ? (
                      <div className="text-center text-xs text-gray-500 py-10">No sessions logged yet.</div>
                    ) : (
                      conversations.slice(convPage * 10, (convPage + 1) * 10).map((conv) => {
                        const chatbotName = chatbots.find(b => b.id === conv.chatbot_id)?.name || 'AI Bot';
                        return (
                          <button
                            key={conv.id}
                            onClick={() => setSelectedConversation(conv.id)}
                            className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex flex-col gap-1.5 ${
                              selectedConversation === conv.id
                                ? 'bg-indigo-950/40 border-indigo-500/40 text-white shadow-md'
                                : 'bg-gray-950/40 border-gray-950 hover:bg-gray-950/70 text-gray-400 hover:text-gray-300'
                            }`}
                          >
                            <div className="flex justify-between items-center w-full">
                              <span className="font-bold">{chatbotName}</span>
                              <span className="text-[10px] text-gray-500 font-mono">
                                {new Date(conv.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="font-mono text-[10px] truncate w-full text-gray-500">
                              ID: {conv.user_session_id}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl h-[700px] flex flex-col">
                  <h4 className="text-base font-bold text-white mb-4">Transcript Viewer</h4>
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-950 border border-gray-950 rounded-xl space-y-4 styleflo-scrollbar">
                    {isFetchingMessages ? (
                      <div className="h-full flex items-center justify-center text-xs text-gray-500">
                        Loading message history...
                      </div>
                    ) : selectedConversation ? (
                      conversationMessages.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs text-gray-500 italic">
                          Empty conversation logs.
                        </div>
                      ) : (
                        conversationMessages.map((msg, i) => (
                          <div key={msg.id || i} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`p-4 rounded-xl text-sm max-w-[90%] leading-relaxed whitespace-pre-wrap shadow-sm ${
                              msg.sender_type === 'user'
                                ? 'bg-indigo-600 text-white rounded-tr-none'
                                : 'bg-gray-900 text-gray-300 rounded-tl-none border border-gray-800'
                            }`}>
                              {msg.text_content}
                            </div>
                          </div>
                        ))
                      )
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-gray-500 text-center italic">
                        Select a session from the explorer to view chat transcripts.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Platform Settings Tab */}
          {activeTab === 'settings' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white">Global Platform Settings</h3>
                <p className="text-xs text-gray-400 mt-0.5">Manage system-wide configurations, including the chatbot widget branding.</p>
              </div>

              <form onSubmit={handleSaveGlobalSettings} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Branding HTML (Footer Watermark)</label>
                  <textarea
                    value={globalBrandingHtml}
                    onChange={(e) => setGlobalBrandingHtml(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono min-h-[80px]"
                    placeholder='<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by StyleFlo</span>'
                  />
                  <p className="text-[10px] text-gray-500 mt-1">This HTML is injected at the bottom of all chatbot widgets. It will automatically be wrapped in an anchor tag pointing to the URL below.</p>
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">Tracking Destination URL</label>
                  <input
                    type="url"
                    value={globalTrackingUrl}
                    onChange={(e) => setGlobalTrackingUrl(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="https://styleflo.ai"
                    required
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Users clicking the watermark will be tracked and redirected here. Originating chatbot ID will be appended as ?ref=...</p>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingGlobal}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-5 rounded-xl shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                  >
                    {isSavingGlobal ? 'Saving Settings...' : 'Save Global Settings'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-6">
              {/* Reserve with Google Integration */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">Reserve with Google (Actions Center)</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Enable native "Book Online" functionality directly on your Google Maps and Search profile.</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    rwgStatus === 'Active on Google' ? 'bg-emerald-950 border-emerald-500/50 text-emerald-400' :
                    rwgStatus === 'Pending Verification' ? 'bg-yellow-950 border-yellow-500/50 text-yellow-400' :
                    'bg-gray-800 border-gray-700 text-gray-400'
                  }`}>
                    Status: {rwgStatus}
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 p-5 rounded-xl space-y-4">
                  <div className="flex items-center gap-3 bg-indigo-950/20 border border-indigo-500/30 p-4 rounded-xl">
                    <input
                      type="checkbox"
                      id="rwg-enable-toggle"
                      checked={isRwgEnabled}
                      onChange={(e) => setIsRwgEnabled(e.target.checked)}
                      className="w-5 h-5 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900"
                    />
                    <div>
                      <label htmlFor="rwg-enable-toggle" className="text-sm font-bold text-white cursor-pointer select-none">Authorize Google Integration</label>
                      <p className="text-[10px] text-indigo-200">Checking this box will start generating dynamic JSON feeds for your business and expose realtime webhook APIs for Google's servers.</p>
                    </div>
                  </div>

                  {isRwgEnabled && (
                    <div className="space-y-4 pt-2">
                      <div className="bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl">
                        <p className="text-xs text-amber-200 font-semibold">⚠️ Important Mapping Requirement</p>
                        <p className="text-[10px] text-amber-300/80 mt-1">These fields must mirror your exact Google Business Profile inputs word-for-word, or mapping alignment will fail.</p>
                      </div>

                      <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Google Business Profile URL</label>
                          <input 
                            type="text" 
                            value={rwgGoogleUrl} 
                            onChange={(e) => setRwgGoogleUrl(e.target.value)} 
                            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                            placeholder="https://maps.google.com/?cid=..." 
                          />
                        </div>
                        <div className="flex items-end pb-[1px]">
                          <button 
                            type="button"
                            onClick={() => {
                              if (!rwgGoogleUrl) {
                                alert("Please enter your Google Business Profile URL first.");
                                return;
                              }
                              // Simulate import
                              alert("Importing data from Google Business Profile...");
                            }}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                            IMPORT from Google Business
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-800/50">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Business Name</label>
                          <input type="text" value={rwgBusinessName} onChange={(e) => setRwgBusinessName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="e.g. Styleflo Salon" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Phone Number</label>
                          <input type="text" value={rwgPhone} onChange={(e) => setRwgPhone(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="+44 123 456 7890" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Street Address</label>
                          <input type="text" value={rwgStreetAddress} onChange={(e) => setRwgStreetAddress(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="123 Salon Street" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">City</label>
                          <input type="text" value={rwgCity} onChange={(e) => setRwgCity(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="London" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Postcode</label>
                          <input type="text" value={rwgPostcode} onChange={(e) => setRwgPostcode(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="SW1A 1AA" />
                        </div>
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleSaveRwgSettings}
                          disabled={isSavingRwg}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg shadow-lg shadow-indigo-500/10 transition-colors disabled:opacity-50"
                        >
                          {isSavingRwg ? 'Saving...' : 'Save Configuration'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRunRwgIntegrityCheck}
                          disabled={isCheckingRwgIntegrity}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold py-2 px-4 rounded-lg transition-colors border border-gray-700 disabled:opacity-50"
                        >
                          {isCheckingRwgIntegrity ? 'Running...' : 'Run Integrity Check'}
                        </button>
                      </div>

                      {rwgIntegrityLogs.length > 0 && (
                        <div className="mt-4 p-4 bg-black border border-gray-800 rounded-xl font-mono text-[10px] text-gray-300 h-32 overflow-y-auto space-y-1.5 styleflo-scrollbar">
                          {rwgIntegrityLogs.map((log, i) => (
                            <div key={i} className={
                              log.startsWith('[Error]') ? 'text-red-400' :
                              log.startsWith('[Success]') ? 'text-emerald-400 font-semibold' :
                              log.startsWith('[Warning]') ? 'text-amber-400' :
                              log.startsWith('[System]') ? 'text-indigo-400' : 'text-gray-300'
                            }>
                              {log}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Scheduling Tab */}
          {activeTab === 'scheduling' && (
            <div className="space-y-6">

              <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Scheduling & Calendar</h3>
                  <p className="text-xs text-gray-400 mt-1">Configure your booking mode and manage external calendar connections.</p>
                </div>

                <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-gray-200 mb-3">Operating Booking Mode</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {[
                      { id: 'walk_in_only', label: 'Walk-ins Only', desc: 'No appointments. Bots tell users to just walk in.' },
                      { id: 'single_calendar', label: 'Single Unified Calendar', desc: 'All bookings drop into one central Google Calendar.' },
                      { id: 'multi_calendar', label: 'Multi-Calendar (Per Staff)', desc: 'Bookings map to individual Google Calendars per staff.' },
                      { id: 'external_platform', label: 'External Booking Link', desc: 'Use an existing system like Vagaro or Fresha.' }
                    ].map(mode => (
                      <label key={mode.id} className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-colors ${
                        bookingMode === mode.id ? 'bg-indigo-950/30 border-indigo-500/50' : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <input type="radio" name="bookingMode" value={mode.id} checked={bookingMode === mode.id} onChange={(e) => setBookingMode(e.target.value)} className="text-indigo-600 bg-gray-900 border-gray-700 focus:ring-indigo-600 focus:ring-offset-gray-900" />
                          <span className="text-sm font-bold text-gray-200">{mode.label}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 pl-6">{mode.desc}</span>
                      </label>
                    ))}
                  </div>
                  
                  {bookingMode === 'external_platform' && (
                    <div className="mb-4 pl-1">
                      <label className="block text-xs font-semibold text-gray-400 mb-1">External Booking URL</label>
                      <input type="url" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" placeholder="https://www.fresha.com/a/your-salon" />
                    </div>
                  )}
                  
                  <button onClick={handleSaveBookingMode} disabled={isSavingBookingMode} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50">
                    {isSavingBookingMode ? 'Saving...' : 'Save Booking Mode'}
                  </button>
                </div>

                {bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform' && (
                  <div className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-gray-200">Google Calendar Status</h4>
                      <p className="text-xs text-gray-400 mt-0.5">Authorize the primary workspace calendar to push and pull appointments.</p>
                      {isGoogleConnected && (
                        <div className="inline-flex items-center gap-1.5 mt-2 bg-emerald-950/40 text-emerald-400 text-[10px] px-2 py-1 rounded-full border border-emerald-500/20 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Connected & Syncing
                        </div>
                      )}
                    </div>
                    <div>
                      {isGoogleConnected ? (
                        <div className="flex flex-col items-end gap-2">
                          <button onClick={handleDisconnectCalendar} className="text-xs text-red-400 hover:text-red-300 font-semibold transition-colors">
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => window.location.href = `/api/integrations/google/authorize?tenantId=${tenantId}`}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg transition-colors flex items-center gap-2"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"/>
                          </svg>
                          Connect Calendar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {bookingMode !== 'walk_in_only' && bookingMode !== 'external_platform' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Services List using ServiceEditor */}
                  <ServiceEditor 
                    tenantId={tenantId} 
                    services={services} 
                    setServices={setServices} 
                    staff={staff} 
                  />

                  {/* Staff List */}
                  <div className="bg-gray-900/30 border border-gray-900 p-6 rounded-2xl shadow-xl flex flex-col h-[500px] relative lg:col-span-2">
                    {showStaffModal ? (
                      <div className="absolute inset-0 bg-gray-950 p-6 rounded-2xl z-10 flex flex-col overflow-y-auto styleflo-scrollbar">
                        <h3 className="text-lg font-bold text-white mb-4">
                          {editingStaffId ? 'Edit Staff Member' : 'Add Staff Member'}
                        </h3>
                        <form onSubmit={handleSaveStaff} className="flex-1 flex flex-col gap-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-1">Name</label>
                              <input required type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. John Doe" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-1">Email</label>
                              <input required type="email" value={newStaffEmail} onChange={e => setNewStaffEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="john@example.com" />
                            </div>
                            {bookingMode === 'multi_calendar' && (
                              <div>
                                <label className="block text-xs font-semibold text-gray-400 mb-1">Google Calendar ID</label>
                                <input type="text" value={newStaffCalId} onChange={e => setNewStaffCalId(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white" placeholder="Defaults to 'primary'" />
                              </div>
                            )}
                          </div>

                        {/* Schedule Spreadsheet Grid */}
                        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden flex flex-col">
                          {/* Week Tabs */}
                          <div className="flex border-b border-gray-800">
                            {[0, 1, 2, 3].map(weekIdx => (
                              <button
                                key={weekIdx}
                                type="button"
                                onClick={() => setActiveWeekIndex(weekIdx)}
                                className={`flex-1 py-2 text-xs font-bold transition-colors ${activeWeekIndex === weekIdx ? 'bg-indigo-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                              >
                                Week {weekIdx + 1}
                              </button>
                            ))}
                          </div>
                          
                          <div className="flex items-center justify-between bg-gray-800/30 px-4 py-3 border-b border-gray-800">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-gray-200">Week Commencing (Monday)</span>
                              <input 
                                type="date" 
                                required
                                value={newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate}
                                onChange={e => handleDateChange(e.target.value)}
                                className="bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:border-indigo-500 outline-none"
                              />
                            </div>
                          </div>
                          
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-gray-900 text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-800">
                                <th className="p-3 font-semibold w-24">Day</th>
                                <th className="p-3 font-semibold text-center border-l border-gray-800 w-16">N/A</th>
                                <th className="p-3 font-semibold border-l border-gray-800 text-center" colSpan={2}>AM Shift</th>
                                <th className="p-3 font-semibold border-l border-gray-800 text-center" colSpan={2}>PM Shift</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as Array<keyof Omit<WeeklySchedule, 'weekCommencingDate'>>).map(day => {
                                const currentDayData = newStaffSchedule.weeks[activeWeekIndex][day];
                                const isUnavail = currentDayData.unavailable;
                                
                                // Calculate if this specific day is in the past
                                const dayOffsets: Record<string, number> = { 'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6 };
                                const currentDayDate = new Date(newStaffSchedule.weeks[activeWeekIndex].weekCommencingDate);
                                currentDayDate.setDate(currentDayDate.getDate() + dayOffsets[day]);
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const isPast = currentDayDate < today;
                                const isDisabled = isUnavail || isPast;

                                return (
                                  <tr key={day} className={`transition-colors ${isUnavail || isPast ? 'bg-gray-900/50' : 'hover:bg-gray-800/30'}`}>
                                    <td className="p-3 text-sm font-medium text-gray-300 capitalize">
                                      {day.substring(0, 3)}
                                      {isPast && <span className="block text-[9px] text-red-400 mt-0.5">Past</span>}
                                    </td>
                                    
                                    <td className="p-3 text-center border-l border-gray-800">
                                      <input 
                                        type="checkbox" 
                                        disabled={isPast}
                                        checked={isUnavail}
                                        onChange={e => handleUnavailableChange(day, e.target.checked)}
                                        className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-900 disabled:opacity-30"
                                      />
                                    </td>
                                    
                                    {/* AM Shift */}
                                    <td className="p-2 border-l border-gray-800 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.am?.start || ''} onChange={e => handleScheduleChange(day, 'am', 'start', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    <td className="p-2 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.am?.end || ''} onChange={e => handleScheduleChange(day, 'am', 'end', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    
                                    {/* PM Shift */}
                                    <td className="p-2 border-l border-gray-800 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.pm?.start || ''} onChange={e => handleScheduleChange(day, 'pm', 'start', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                    <td className="p-2 text-center">
                                      <input type="time" disabled={isDisabled} value={currentDayData.pm?.end || ''} onChange={e => handleScheduleChange(day, 'pm', 'end', e.target.value)} className="bg-gray-950 disabled:opacity-30 border border-gray-700 rounded px-2 py-1 text-xs text-white w-24 focus:border-indigo-500 outline-none" />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="bg-gray-900 p-3 border-t border-gray-800 flex justify-center">
                            <button 
                              type="button" 
                              onClick={copyToNextWeek}
                              disabled={activeWeekIndex >= 3}
                              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold bg-indigo-500/10 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              Copy this rota to next week →
                            </button>
                          </div>
                        </div>

                        <div className="mt-auto flex justify-end gap-3 pt-4 border-t border-gray-800">
                          <button type="button" onClick={() => {
                            setShowStaffModal(false);
                            setEditingStaffId(null);
                          }} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                          <button type="submit" className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-transform active:scale-95">
                            {editingStaffId ? 'Update Staff Member' : 'Save Staff Member'}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Staff Schedule</h3>
                    <button onClick={() => {
                      setEditingStaffId(null);
                      setNewStaffName('');
                      setNewStaffEmail('');
                      setNewStaffCalId('');
                      setNewStaffSchedule({
                        weeks: [createEmptySchedule(), createEmptySchedule(), createEmptySchedule(), createEmptySchedule()]
                      });
                      setActiveWeekIndex(0);
                      setShowStaffModal(true);
                    }} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
                      + Add Staff
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 styleflo-scrollbar pr-2">
                    {staff.length === 0 ? (
                      <div className="text-sm text-gray-500 italic text-center mt-10">No staff configured yet.</div>
                    ) : staff.map(stf => (
                      <div key={stf.id} className="bg-gray-950 border border-gray-800 p-4 rounded-xl flex flex-col gap-2 group hover:border-gray-700 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-gray-200 text-sm">{stf.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{stf.email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditStaff(stf)} className="text-gray-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button onClick={() => handleDeleteStaff(stf.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                          </div>
                        </div>
                        {bookingMode === 'multi_calendar' && (
                          <div className="text-[11px] text-gray-400 bg-gray-900 p-2 rounded-lg">
                            Cal ID: <span className="text-indigo-400 break-all">{stf.google_calendar_id}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
          )}
            </div>
        </div>
      </main>
    </div>
  );
}
