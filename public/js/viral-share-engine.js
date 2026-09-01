/**
 * ==============================================================================
 * VIRAL SOCIAL SHARE & 1-CLICK WEB SHARE API ENGINE (2026)
 * Managed by: Head of Social Growth & Viral CRO
 * ==============================================================================
 * Enables 1-click native mobile sharing and desktop social buttons to turn
 * readers into viral promoters on WhatsApp, Telegram, Twitter/X, and Pinterest.
 */

(function () {
  if (window.__VIRAL_SHARE_INITIALIZED__) return;
  window.__VIRAL_SHARE_INITIALIZED__ = true;

  function injectViralShareButtons() {
    const style = document.createElement('style');
    style.innerHTML = `
      .viral-share-floating {
        position: fixed;
        left: 16px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 99990;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .viral-share-btn {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        text-decoration: none;
        font-size: 1.1rem;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
        border: none;
        cursor: pointer;
      }
      .viral-share-btn:hover {
        transform: scale(1.12);
        box-shadow: 0 6px 16px rgba(0,0,0,0.4);
      }
      .btn-share-wa { background: #25d366; }
      .btn-share-tg { background: #229ed9; }
      .btn-share-tw { background: #000; border: 1px solid #333; }
      .btn-share-native { background: linear-gradient(135deg, #6366f1, #4f46e5); }

      @media (max-width: 768px) {
        .viral-share-floating {
          left: auto;
          right: 16px;
          top: auto;
          bottom: 80px;
          flex-direction: row;
        }
      }
    `;
    document.head.appendChild(style);

    const shareContainer = document.createElement('div');
    shareContainer.className = 'viral-share-floating';

    const currentUrl = encodeURIComponent(window.location.href.split('?')[0] + '?ref=viral_share&sid=social_viral');
    const pageTitle = encodeURIComponent(document.title || 'Confira essa dica imperdível com cupom exclusivo!');

    shareContainer.innerHTML = `
      <a href="https://api.whatsapp.com/send?text=${pageTitle}%20${currentUrl}" target="_blank" rel="noopener" class="viral-share-btn btn-share-wa" title="Compartilhar no WhatsApp">📲</a>
      <a href="https://t.me/share/url?url=${currentUrl}&text=${pageTitle}" target="_blank" rel="noopener" class="viral-share-btn btn-share-tg" title="Compartilhar no Telegram">✈️</a>
      <a href="https://twitter.com/intent/tweet?text=${pageTitle}&url=${currentUrl}" target="_blank" rel="noopener" class="viral-share-btn btn-share-tw" title="Compartilhar no Twitter/X">🐦</a>
      <button class="viral-share-btn btn-share-native" id="nativeWebShareBtn" title="Compartilhar">🔗</button>
    `;

    document.body.appendChild(shareContainer);

    const nativeBtn = shareContainer.querySelector('#nativeWebShareBtn');
    nativeBtn.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: document.title,
            text: 'Olha que incrível isso que encontrei:',
            url: window.location.href.split('?')[0] + '?ref=native_share&sid=native_mobile'
          });
        } catch (err) {}
      } else {
        navigator.clipboard.writeText(window.location.href);
        nativeBtn.innerText = '✓';
        setTimeout(() => nativeBtn.innerText = '🔗', 2000);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectViralShareButtons);
  } else {
    injectViralShareButtons();
  }
})();
