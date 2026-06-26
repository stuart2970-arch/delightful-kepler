(function () {
  // 1. Identify the script element and extract configuration
  const currentScript = document.currentScript as HTMLScriptElement;
  if (!currentScript) {
    console.error('[StyleFlo Widget] Current script context not found.');
    return;
  }

  const chatbotId = currentScript.getAttribute('data-bot-id');
  if (!chatbotId) {
    console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');
    return;
  }

  // Parse host URL from script source
  const scriptUrl = new URL(currentScript.src);
  const apiHost = scriptUrl.origin;

  // 2. Generate or retrieve Session ID to preserve chat history
  const sessionKey = `styleflo_session_${chatbotId}`;
  let sessionId = localStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = 'session_' + crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }

  // 3. Create the Shadow Host container in body
  const host = document.createElement('div');
  host.id = 'styleflo-chat-widget';
  host.style.position = 'fixed';
  host.style.bottom = '0';
  host.style.right = '0';
  host.style.zIndex = '999999';
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  // 4. Inject Tailwind Stylesheet & Custom CSS inside the Shadow Root
  const tailwindLink = document.createElement('link');
  tailwindLink.rel = 'stylesheet';
  tailwindLink.href = 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css';
  shadowRoot.appendChild(tailwindLink);

  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes styleflo-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .styleflo-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      background-color: #9CA3AF;
      border-radius: 50%;
      animation: styleflo-bounce 1.4s infinite ease-in-out;
    }
    .styleflo-dot:nth-child(2) { animation-delay: 0.2s; }
    .styleflo-dot:nth-child(3) { animation-delay: 0.4s; }

    /* Custom scrollbar styles */
    .styleflo-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .styleflo-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .styleflo-scrollbar::-webkit-scrollbar-thumb {
      background-color: #D1D5DB;
      border-radius: 2px;
    }
    .styleflo-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: #D1D5DB transparent;
    }

    /* Custom sizing since Tailwind v2 CDN doesn't support arbitrary values */
    .styleflo-chat-window {
      width: calc(100vw - 40px);
      height: 550px;
      max-height: calc(100vh - 100px);
    }
    @supports (max-height: 100dvh) {
      .styleflo-chat-window {
        max-height: calc(100dvh - 100px);
      }
    }
    @media (min-width: 640px) {
      .styleflo-chat-window {
        width: 380px;
      }
    }
    .styleflo-text-17 { font-size: 17px; }
    .styleflo-text-15 { font-size: 15px; }
    .styleflo-text-11 { font-size: 11px; }
    .styleflo-mw-85 { max-width: 85%; }
    .styleflo-mw-75 { max-width: 75%; }
  `;
  shadowRoot.appendChild(styleTag);

  // 5. Setup Widget HTML layout template
  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'font-sans';
  shadowRoot.appendChild(widgetContainer);

  let primaryColor = '#4F46E5'; // Default Indigo-600
  let botName = 'AI Assistant';
  let agentName = 'AI Assistant';
  let agentRole = 'AI Support Agent';
  let agentAvatarUrl = '/avatars/avatar1.png';

  let welcomeMessage = 'Hello! How can I help you today?';
  let brandingHtml = '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';

  // 6. Fetch Chatbot Public Configuration
  async function fetchConfig() {
    try {
      const response = await fetch(`${apiHost}/api/chatbots/${chatbotId}`);
      if (response.ok) {
        const config = await response.json();
        if (config.name) botName = config.name;
        if (config.primaryColor) primaryColor = config.primaryColor;
        agentName = config.agentName || botName;
        agentRole = config.agentRole || 'AI Support Agent';
        agentAvatarUrl = config.agentAvatarUrl || '/avatars/avatar1.png';
        welcomeMessage = config.welcomeMessage || 'Hello! How can I help you today?';
        brandingHtml = config.brandingHtml || brandingHtml;
      }
    } catch (err) {
      console.warn('[StyleFlo Widget] Failed to fetch chatbot config, using defaults:', err);
    }
    initializeWidget();
  }

  // 7. Initialize and render the DOM elements
  function initializeWidget() {
    // Floating Chat Bubble
    const bubble = document.createElement('button');
    bubble.className = 'fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50';
    bubble.style.backgroundColor = primaryColor;
    bubble.innerHTML = `
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `;
    widgetContainer.appendChild(bubble);

    // Chat Window
    const chatWindow = document.createElement('div');
    chatWindow.className = 'fixed z-50 flex flex-col bg-white overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right bottom-20 right-5 rounded-2xl border border-gray-100 shadow-2xl styleflo-chat-window';
    chatWindow.innerHTML = `
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md shrink-0 z-10" style="background-color: ${primaryColor};">
        <div class="flex items-center gap-3">
          <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold styleflo-text-17 leading-tight">${agentName}</h3>
            <p class="styleflo-text-11 opacity-75 mt-0.5">${agentRole}</p>
          </div>
        </div>
        <button id="styleflo-close-btn" class="text-white opacity-80 hover:opacity-100 focus:outline-none transition-opacity">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Messages Area -->
      <div id="styleflo-messages" class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 space-y-4 bg-gray-50 styleflo-scrollbar">
        <!-- Welcome Message -->
        <div class="flex items-start gap-2.5">
          <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed">
            ${welcomeMessage}
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <form id="styleflo-chat-form" class="p-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0 z-10">
        <input 
          id="styleflo-input" 
          type="text" 
          placeholder="Type your message..." 
          class="flex-1 px-3 py-2 styleflo-text-15 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all"
          style="--tw-ring-color: ${primaryColor};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${primaryColor};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>

      <!-- Branding Footer -->
      <a href="${apiHost}/api/track?ref=${chatbotId}&source=${encodeURIComponent(window.location.hostname)}" target="_blank" rel="noopener noreferrer" class="w-full bg-gray-50 text-center py-1.5 border-t border-gray-100 block hover:bg-gray-100 transition-colors cursor-pointer text-gray-500 flex items-center justify-center">
        ${brandingHtml}
      </a>
    `;
    widgetContainer.appendChild(chatWindow);

    // References to DOM elements inside Shadow DOM
    const messagesContainer = shadowRoot.getElementById('styleflo-messages') as HTMLDivElement;
    const chatForm = shadowRoot.getElementById('styleflo-chat-form') as HTMLFormElement;
    const inputField = shadowRoot.getElementById('styleflo-input') as HTMLInputElement;
    const closeBtn = shadowRoot.getElementById('styleflo-close-btn') as HTMLButtonElement;
    const chatIcon = shadowRoot.getElementById('styleflo-icon-chat') as HTMLElement;
    const closeIcon = shadowRoot.getElementById('styleflo-icon-close') as HTMLElement;

    let isOpen = false;

    // Toggle Chat Window
    function toggleChat() {
      isOpen = !isOpen;
      if (isOpen) {
        chatWindow.classList.remove('scale-90', 'opacity-0', 'pointer-events-none');
        chatWindow.classList.add('scale-100', 'opacity-100', 'pointer-events-auto');
        chatIcon.classList.remove('scale-100');
        chatIcon.classList.add('scale-0');
        closeIcon.classList.remove('scale-0');
        closeIcon.classList.add('scale-100');
        inputField.focus();
      } else {
        chatWindow.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto');
        chatWindow.classList.add('scale-90', 'opacity-0', 'pointer-events-none');
        chatIcon.classList.remove('scale-0');
        chatIcon.classList.add('scale-100');
        closeIcon.classList.remove('scale-100');
        closeIcon.classList.add('scale-0');
      }
    }

    bubble.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Helper to scroll to bottom of messages container
    function scrollToBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Helper to append a message node to UI
    function appendMessage(sender: 'user' | 'bot', text: string = ''): HTMLDivElement {
      const wrapper = document.createElement('div');
      wrapper.className = sender === 'user' ? 'flex justify-end' : 'flex items-start gap-2.5';
      
      if (sender === 'bot') {
        const avatarImg = document.createElement('img');
        avatarImg.src = `${apiHost}${agentAvatarUrl}`;
        avatarImg.alt = 'Agent Avatar';
        avatarImg.className = 'w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0';
        wrapper.appendChild(avatarImg);
      }
      
      const msgDiv = document.createElement('div');
      msgDiv.className = sender === 'user'
        ? 'p-3 text-white rounded-2xl rounded-tr-none styleflo-text-15 styleflo-mw-85 shadow-sm leading-relaxed'
        : 'p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed';
      
      if (sender === 'user') {
        msgDiv.style.backgroundColor = primaryColor;
      }
      
      msgDiv.textContent = text;
      wrapper.appendChild(msgDiv);
      messagesContainer.appendChild(wrapper);
      scrollToBottom();
      return msgDiv;
    }

    // Helper to append typing indicator
    function showTypingIndicator(): HTMLDivElement {
      const wrapper = document.createElement('div');
      wrapper.id = 'styleflo-typing-indicator';
      wrapper.className = 'flex items-start gap-2.5';
      
      wrapper.innerHTML = `
        <img src="${apiHost}${agentAvatarUrl}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `;
      messagesContainer.appendChild(wrapper);
      scrollToBottom();
      return wrapper;
    }

    // Form Submit Event Handler
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const messageText = inputField.value.trim();
      if (!messageText) return;

      // 1. Add user message
      appendMessage('user', messageText);
      inputField.value = '';

      // 2. Add typing indicator
      const typingIndicator = showTypingIndicator();

      // 3. Initiate fetch streaming call
      try {
        const response = await fetch(`${apiHost}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: messageText,
            chatbotId: chatbotId,
            sessionId: sessionId,
          }),
        });

        // Remove typing indicator once stream starts or fails
        typingIndicator.remove();

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          appendMessage('bot', 'Sorry, I am unable to process that message right now.');
          return;
        }

        // 4. Create bot response container
        const botResponseContainer = appendMessage('bot', '');
        let rawText = '';

        // 5. Read stream chunks and update UI
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          rawText += chunk;
          
          // Lightweight markdown parsing for the widget
          let formattedText = rawText
            // Replace bold **text**
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Convert newlines to <br>
            .replace(/\n/g, '<br/>');

          botResponseContainer.innerHTML = formattedText;
          scrollToBottom();
        }

      } catch (err: any) {
        console.error('[StyleFlo Widget] Chat Stream fetch error:', err);
        typingIndicator.remove();
        appendMessage('bot', 'An error occurred. Please try again or refresh the page.');
      }
    });
  }

  // Begin execution
  fetchConfig();
})();
