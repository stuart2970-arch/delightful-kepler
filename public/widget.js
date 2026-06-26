"use strict";(()=>{(function(){let w=document.currentScript;if(!w){console.error("[StyleFlo Widget] Current script context not found.");return}let d=w.getAttribute("data-bot-id");if(!d){console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');return}let n=new URL(w.src).origin,I=`styleflo_session_${d}`,m=localStorage.getItem(I);m||(m="session_"+crypto.randomUUID(),localStorage.setItem(I,m));let l=document.createElement("div");l.id="styleflo-chat-widget",l.style.position="fixed",l.style.bottom="0",l.style.right="0",l.style.zIndex="999999",document.body.appendChild(l);let r=l.attachShadow({mode:"open"}),v=document.createElement("link");v.rel="stylesheet",v.href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",r.appendChild(v);let E=document.createElement("style");E.textContent=`
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
  `,r.appendChild(E);let u=document.createElement("div");u.className="font-sans",r.appendChild(u);let c="#4F46E5",M="AI Assistant",T="AI Assistant",A="AI Support Agent",p="/avatars/avatar1.png",$="Hello! How can I help you today?",x='<span style="opacity: 0.6; font-size: 11px;">\u26A1 Powered by <strong>StyleFlo</strong></span>';async function B(){try{let s=await fetch(`${n}/api/chatbots/${d}`);if(s.ok){let e=await s.json();e.name&&(M=e.name),e.primaryColor&&(c=e.primaryColor),T=e.agentName||M,A=e.agentRole||"AI Support Agent",p=e.agentAvatarUrl||"/avatars/avatar1.png",$=e.welcomeMessage||"Hello! How can I help you today?",x=e.brandingHtml||x}}catch(s){console.warn("[StyleFlo Widget] Failed to fetch chatbot config, using defaults:",s)}j()}function j(){let s=document.createElement("button");s.className="fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50",s.style.backgroundColor=c,s.innerHTML=`
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `,u.appendChild(s);let e=document.createElement("div");e.className="fixed z-50 flex flex-col bg-white overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right bottom-20 right-5 rounded-2xl border border-gray-100 shadow-2xl styleflo-chat-window",e.innerHTML=`
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md shrink-0 z-10" style="background-color: ${c};">
        <div class="flex items-center gap-3">
          <img src="${n}${p}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold styleflo-text-17 leading-tight">${T}</h3>
            <p class="styleflo-text-11 opacity-75 mt-0.5">${A}</p>
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
          <img src="${n}${p}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed">
            ${$}
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
          style="--tw-ring-color: ${c};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${c};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>

      <!-- Branding Footer -->
      <a href="${n}/api/track?ref=${d}&source=${encodeURIComponent(window.location.hostname)}" target="_blank" rel="noopener noreferrer" class="w-full bg-gray-50 text-center py-1.5 border-t border-gray-100 block hover:bg-gray-100 transition-colors cursor-pointer text-gray-500 flex items-center justify-center">
        ${x}
      </a>
    `,u.appendChild(e);let f=r.getElementById("styleflo-messages"),D=r.getElementById("styleflo-chat-form"),k=r.getElementById("styleflo-input"),z=r.getElementById("styleflo-close-btn"),g=r.getElementById("styleflo-icon-chat"),y=r.getElementById("styleflo-icon-close"),C=!1;function H(){C=!C,C?(e.classList.remove("scale-90","opacity-0","pointer-events-none"),e.classList.add("scale-100","opacity-100","pointer-events-auto"),g.classList.remove("scale-100"),g.classList.add("scale-0"),y.classList.remove("scale-0"),y.classList.add("scale-100"),k.focus()):(e.classList.remove("scale-100","opacity-100","pointer-events-auto"),e.classList.add("scale-90","opacity-0","pointer-events-none"),g.classList.remove("scale-0"),g.classList.add("scale-100"),y.classList.remove("scale-100"),y.classList.add("scale-0"))}s.addEventListener("click",H),z.addEventListener("click",H);function L(){f.scrollTop=f.scrollHeight}function b(t,h=""){let a=document.createElement("div");if(a.className=t==="user"?"flex justify-end":"flex items-start gap-2.5",t==="bot"){let i=document.createElement("img");i.src=`${n}${p}`,i.alt="Agent Avatar",i.className="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0",a.appendChild(i)}let o=document.createElement("div");return o.className=t==="user"?"p-3 text-white rounded-2xl rounded-tr-none styleflo-text-15 styleflo-mw-85 shadow-sm leading-relaxed":"p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed",t==="user"&&(o.style.backgroundColor=c),o.textContent=h,a.appendChild(o),f.appendChild(a),L(),o}function F(){let t=document.createElement("div");return t.id="styleflo-typing-indicator",t.className="flex items-start gap-2.5",t.innerHTML=`
        <img src="${n}${p}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `,f.appendChild(t),L(),t}D.addEventListener("submit",async t=>{t.preventDefault();let h=k.value.trim();if(!h)return;b("user",h),k.value="";let a=F();try{let o=await fetch(`${n}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:h,chatbotId:d,sessionId:m})});if(a.remove(),!o.ok)throw new Error(`Server returned HTTP ${o.status}`);let i=o.body?.getReader(),N=new TextDecoder;if(!i){b("bot","Sorry, I am unable to process that message right now.");return}let U=b("bot",""),S="";for(;;){let{done:R,value:W}=await i.read();if(R)break;let P=N.decode(W,{stream:!0});S+=P;let _=S.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br/>");U.innerHTML=_,L()}}catch(o){console.error("[StyleFlo Widget] Chat Stream fetch error:",o),a.remove(),b("bot","An error occurred. Please try again or refresh the page.")}})}B()})();})();
