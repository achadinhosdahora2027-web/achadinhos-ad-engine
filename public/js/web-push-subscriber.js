/**
 * ==============================================================================
 * WEB PUSH NOTIFICATION & AUDIENCE RETENTION ENGINE (2026)
 * Managed by: Head of Retention & Growth Engineering
 * ==============================================================================
 * Solicits push notification permissions for daily flash deals, secret coupon
 * alerts, and cosmic horoscopes to drive repeat daily traffic.
 */

(function () {
  if (window.__WEB_PUSH_INITIALIZED__) return;
  window.__WEB_PUSH_INITIALIZED__ = true;

  if (localStorage.getItem('push_prompt_dismissed')) return;

  function createPushPrompt() {
    const style = document.createElement('style');
    style.innerHTML = `
      .push-prompt-banner {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99995;
        background: #0f172a;
        border: 1px solid #3b82f6;
        border-radius: 16px;
        padding: 16px 20px;
        max-width: 360px;
        box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
        color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: pushSlideIn 0.3s ease-out;
      }
      @keyframes pushSlideIn {
        from { transform: translateY(-30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .push-prompt-title { font-size: 0.95rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
      .push-prompt-desc { font-size: 0.8rem; color: #94a3b8; line-height: 1.4; }
      .push-prompt-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .btn-push-allow { background: #3b82f6; color: #fff; border: none; padding: 6px 14px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
      .btn-push-dismiss { background: transparent; color: #64748b; border: none; padding: 6px 10px; font-size: 0.8rem; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.className = 'push-prompt-banner';
    banner.innerHTML = `
      <div class="push-prompt-title">🔔 Cupons Secretos & Previsões</div>
      <div class="push-prompt-desc">Deseja receber avisos instantâneos quando a Shopee e Booking liberarem cupons relâmpago de 40% a 70% OFF?</div>
      <div class="push-prompt-actions">
        <button class="btn-push-dismiss" id="pushDismissBtn">Agora não</button>
        <button class="btn-push-allow" id="pushAllowBtn">Ativar Alertas VIP</button>
      </div>
    `;

    setTimeout(() => {
      document.body.appendChild(banner);

      banner.querySelector('#pushDismissBtn').addEventListener('click', () => {
        localStorage.setItem('push_prompt_dismissed', 'true');
        banner.remove();
      });

      banner.querySelector('#pushAllowBtn').addEventListener('click', async () => {
        if ('Notification' in window) {
          try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              new Notification('👑 Alertas VIP Ativados!', {
                body: 'Você receberá os melhores cupons e achadinhos verificados em primeira mão.',
                icon: '/favicon.ico'
              });
            }
          } catch (e) {}
        }
        localStorage.setItem('push_prompt_dismissed', 'true');
        banner.remove();
      });
    }, 12000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPushPrompt);
  } else {
    createPushPrompt();
  }
})();
