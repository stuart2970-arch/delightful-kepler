"use strict";(()=>{(function(){let L=document.currentScript;if(!L){console.error("[StyleFlo Widget] Current script context not found.");return}let m=L.getAttribute("data-bot-id");if(!m){console.error('[StyleFlo Widget] Missing required "data-bot-id" attribute on script tag.');return}let c=new URL(L.src).origin,B=`styleflo_session_${m}`,x=localStorage.getItem(B);x||(x="session_"+crypto.randomUUID(),localStorage.setItem(B,x));let p=document.createElement("div");p.id="styleflo-chat-widget",p.style.position="fixed",p.style.bottom="0",p.style.right="0",p.style.zIndex="999999",document.body.appendChild(p);let i=p.attachShadow({mode:"open"}),I=document.createElement("link");I.rel="stylesheet",I.href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",i.appendChild(I);let j=document.createElement("style");j.textContent=`
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

    @keyframes styleflo-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .4; }
    }
    .styleflo-animate-pulse {
      animation: styleflo-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  `,i.appendChild(j);let w=document.createElement("div");w.className="font-sans",i.appendChild(w);let h="#4F46E5",N="AI Assistant",D="AI Assistant",F="AI Support Agent",f="/avatars/avatar1.png",U="Hello! How can I help you today?",E='<span style="opacity: 0.6; font-size: 11px;">\u26A1 Powered by <strong>StyleFlo</strong></span>';async function _(){try{let n=await fetch(`${c}/api/chatbots/${m}`);if(n.ok){let e=await n.json();e.name&&(N=e.name),e.primaryColor&&(h=e.primaryColor),D=e.agentName||N,F=e.agentRole||"AI Support Agent",f=e.agentAvatarUrl||"/avatars/avatar1.png",U=e.welcomeMessage||"Hello! How can I help you today?",E=e.brandingHtml||E}}catch(n){console.warn("[StyleFlo Widget] Failed to fetch chatbot config, using defaults:",n)}W()}function W(){let n=document.createElement("button");n.className="fixed bottom-5 right-5 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 focus:outline-none z-50",n.style.backgroundColor=h,n.innerHTML=`
      <!-- Chat Icon -->
      <svg id="styleflo-icon-chat" class="w-6 h-6 text-white transition-all duration-300 transform scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
      <!-- Close Icon (Initially hidden) -->
      <svg id="styleflo-icon-close" class="w-6 h-6 text-white absolute transition-all duration-300 transform scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `,w.appendChild(n);let e=document.createElement("div");e.className="fixed z-50 flex flex-col bg-white overflow-hidden transition-all duration-300 transform scale-90 opacity-0 pointer-events-none origin-bottom-right bottom-20 right-5 rounded-2xl border border-gray-100 shadow-2xl styleflo-chat-window",e.innerHTML=`
      <!-- Header -->
      <div class="p-4 text-white flex items-center justify-between shadow-md shrink-0 z-10" style="background-color: ${h};">
        <div class="flex items-center gap-3">
          <img src="${c}${f}" alt="Agent Avatar" class="w-10 h-10 rounded-full border border-white/20 bg-white/10 object-cover" />
          <div>
            <h3 class="font-bold styleflo-text-17 leading-tight">${D}</h3>
            <p class="styleflo-text-11 opacity-75 mt-0.5">${F}</p>
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
          <img src="${c}${f}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100" />
          <div class="p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 styleflo-mw-75 shadow-sm leading-relaxed">
            ${U}
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
          style="--tw-ring-color: ${h};"
          autocomplete="off"
        />
        <button 
          type="submit" 
          class="p-2 rounded-xl text-white hover:opacity-95 focus:outline-none transition-opacity" 
          style="background-color: ${h};"
        >
          <svg class="w-4 h-4 transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </form>

      <!-- Branding Footer -->
      <a href="${c}/api/track?ref=${m}&source=${encodeURIComponent(window.location.hostname)}" target="_blank" rel="noopener noreferrer" class="w-full bg-gray-50 text-center py-1.5 border-t border-gray-100 block hover:bg-gray-100 transition-colors cursor-pointer text-gray-500 flex items-center justify-center">
        ${E}
      </a>
    `,w.appendChild(e);let v=i.getElementById("styleflo-messages"),O=i.getElementById("styleflo-chat-form"),M=i.getElementById("styleflo-input"),q=i.getElementById("styleflo-close-btn"),k=i.getElementById("styleflo-icon-chat"),C=i.getElementById("styleflo-icon-close"),T=!1;function P(){T=!T,T?(e.classList.remove("scale-90","opacity-0","pointer-events-none"),e.classList.add("scale-100","opacity-100","pointer-events-auto"),k.classList.remove("scale-100"),k.classList.add("scale-0"),C.classList.remove("scale-0"),C.classList.add("scale-100"),M.focus()):(e.classList.remove("scale-100","opacity-100","pointer-events-auto"),e.classList.add("scale-90","opacity-0","pointer-events-none"),k.classList.remove("scale-0"),k.classList.add("scale-100"),C.classList.remove("scale-100"),C.classList.add("scale-0"))}n.addEventListener("click",P),q.addEventListener("click",P);function y(){v.scrollTop=v.scrollHeight}function $(o,u=""){let d=document.createElement("div");if(d.className=o==="user"?"flex justify-end":"flex items-start gap-2.5 w-full",o==="bot"){let r=document.createElement("img");r.src=`${c}${f}`,r.alt="Agent Avatar",r.className="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0",d.appendChild(r)}let t=document.createElement("div");if(t.className=o==="user"?"p-3 text-white rounded-2xl rounded-tr-none styleflo-text-15 styleflo-mw-85 shadow-sm leading-relaxed":"p-3 bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none styleflo-text-15 shadow-sm leading-relaxed w-full",o==="user")t.style.backgroundColor=h,t.textContent=u,d.appendChild(t);else{let r=document.createElement("div");r.className="flex flex-col min-w-0 styleflo-mw-75",t.textContent=u,r.appendChild(t),d.appendChild(r)}return v.appendChild(d),y(),t}function Y(){let o=document.createElement("div");return o.id="styleflo-typing-indicator",o.className="flex items-start gap-2.5",o.innerHTML=`
        <img src="${c}${f}" alt="Agent Avatar" class="w-7 h-7 rounded-full object-cover bg-white border border-gray-100 flex-shrink-0" />
        <div class="flex items-center gap-1.5 p-3.5 bg-white border border-gray-100 rounded-2xl rounded-tl-none shadow-sm">
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
          <div class="styleflo-dot"></div>
        </div>
      `,v.appendChild(o),y(),o}O.addEventListener("submit",async o=>{o.preventDefault();let u=M.value.trim();if(!u)return;$("user",u),M.value="";let d=Y();try{let t=await fetch(`${c}/api/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:u,chatbotId:m,sessionId:x})});if(d.remove(),!t.ok)throw new Error(`Server returned HTTP ${t.status}`);let r=t.body?.getReader(),G=new TextDecoder;if(!r){$("bot","Sorry, I am unable to process that message right now.");return}let H=$("bot",""),A="";for(;;){let{done:l,value:s}=await r.read();if(l)break;let b=G.decode(s,{stream:!0});A+=b;let g=A.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" class="font-semibold text-indigo-600 hover:underline" style="color: ${primaryColor}; text-decoration: underline;">$1</a>').replace(/\n/g,"<br/>");H.innerHTML=g,y()}let J=/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,R,S=[];for(;(R=J.exec(A))!==null;){let l=R[2];(l.includes("/products/")||l.includes("/product/")||l.includes("/shop/"))&&!S.includes(l)&&S.push(l)}for(let l of S){let s=document.createElement("div");s.className="my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 styleflo-animate-pulse",s.innerHTML=`
            <div class="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" style="width: 48px; height: 48px;"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3 bg-gray-200 rounded w-3/4" style="height: 12px;"></div>
              <div class="h-2.5 bg-gray-200 rounded w-1/2" style="height: 10px;"></div>
            </div>
          `;let b=H.querySelector(`a[href="${l}"]`);b?b.parentNode?.insertBefore(s,b.nextSibling):H.appendChild(s),y();try{let g=await fetch(`${c}/api/products/metadata?url=${encodeURIComponent(l)}`);if(g.ok){let z=await g.json();if(z.success&&z.metadata){let a=z.metadata;s.className="my-2 p-3 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-3 transition-all duration-300 hover:shadow-md",s.innerHTML=`
                  ${a.image_url?`
                    <img src="${a.image_url}" alt="${a.title||"Product Image"}" class="w-12 h-12 object-cover rounded-xl border border-gray-100 bg-white flex-shrink-0" style="width: 48px; height: 48px;" />
                  `:`
                    <div class="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100 text-gray-400" style="width: 48px; height: 48px;">\u{1F6CD}\uFE0F</div>
                  `}
                  <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-xs text-gray-800 truncate leading-tight" style="margin: 0; font-size: 12px;">${a.title||"Product Details"}</h4>
                    <p class="text-[10px] text-gray-400 mt-1 leading-normal capitalize" style="margin: 4px 0 0 0; font-size: 10px;">${a.site_name||"Store"}</p>
                    ${a.price?`
                      <p class="text-xs font-semibold text-gray-900 mt-1" style="margin: 4px 0 0 0; font-size: 11px; font-weight: 600;">${a.currency==="GBP"||a.currency==="\xA3"?"\xA3":a.currency||"$"}${a.price}</p>
                    `:""}
                  </div>
                  <a href="${l}" target="_blank" class="px-3.5 py-1.5 rounded-xl text-[10px] font-bold text-white transition-opacity flex-shrink-0" style="background-color: ${h}; font-size: 10px; font-weight: 700; padding: 6px 12px; border-radius: 8px; text-decoration: none; display: inline-block;">
                    Buy Now
                  </a>
                `}else s.remove()}else s.remove()}catch(g){console.warn("[Widget] Failed to fetch product card details:",g),s.remove()}y()}}catch(t){console.error("[StyleFlo Widget] Chat Stream fetch error:",t),d.remove(),$("bot","An error occurred. Please try again or refresh the page.")}})}_()})();})();
