'use client';

import { useEffect } from 'react';

export default function IframeResizer() {
  useEffect(() => {
    // Only run if we are inside an iframe
    if (window.self !== window.top) {
      let lastHeight = 0;
      
      const sendHeight = () => {
        // Use offsetHeight instead of scrollHeight. 
        // scrollHeight forces it to be at least the viewport height, causing infinite growth if there's any overflow.
        // offsetHeight measures the actual content height.
        const currentHeight = document.body.offsetHeight;
        
        // Only send if the height has changed by more than 5 pixels to prevent infinite loops and subpixel bouncing
        if (Math.abs(currentHeight - lastHeight) > 5) {
          lastHeight = currentHeight;
          window.parent.postMessage({ type: 'STYLEFLO_IFRAME_RESIZE', height: currentHeight }, '*');
        }
      };

      // Send initial height
      setTimeout(sendHeight, 100);

      const resizeObserver = new ResizeObserver(() => {
        sendHeight();
      });

      resizeObserver.observe(document.body);
      
      // Fallback for window resize events
      window.addEventListener('resize', sendHeight);

      // Clean up
      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', sendHeight);
      };
    }
  }, []);

  return null; // This component doesn't render anything visually
}
