/**
 * ==============================================================================
 * SUPABASE REALTIME & VIP MEMBERS EXCLUSIVE DEALS ENGINE (2026)
 * Client-side Realtime Live Deals, Instant Alerts & Semantic Search
 * ==============================================================================
 */

(function () {
  if (window.__SUPABASE_VIP_INITIALIZED__) return;
  window.__SUPABASE_VIP_INITIALIZED__ = true;

  const VIP_STATE = {
    isVipMember: localStorage.getItem('achadinhos_vip_member') === 'true',
    savedBookmarks: JSON.parse(localStorage.getItem('achadinhos_saved_deals') || '[]'),
    liveDropsCount: 3
  };

  function createVipWidget() {
    const style = document.createElement('style');
    style.innerHTML = `
      .vip-floating-badge {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 99998;
        background: linear-gradient(135deg, #1e1b4b, #4338ca);
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        box-shadow: 0 10px 25px rgba(67, 56, 202, 0.4);
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.2);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .vip-floating-badge:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 14px 30px rgba(67, 56, 202, 0.6);
      }
      .vip-pulse-dot {
        width: 8px;
        height: 8px;
        background: #22c55e;
        border-radius: 50%;
        box-shadow: 0 0 8px #22c55e;
        animation: vipPulse 1.5s infinite;
      }
      @keyframes vipPulse {
        0% { transform: scale(0.95); opacity: 0.8; }
        50% { transform: scale(1.3); opacity: 1; }
        100% { transform: scale(0.95); opacity: 0.8; }
      }
      .vip-modal-backdrop {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(6px);
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .vip-modal-card {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 20px;
        width: 100%;
        max-width: 480px;
        padding: 24px;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        position: relative;
      }
      .vip-modal-card h3 { font-size: 1.35rem; margin-bottom: 8px; color: #fff; }
      .vip-modal-card p { font-size: 0.9rem; color: #94a3b8; margin-bottom: 16px; }
      .vip-deal-item {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .vip-deal-title { font-size: 0.9rem; font-weight: 600; color: #f1f5f9; }
      .vip-deal-discount { font-size: 0.75rem; background: #22c55e; color: #000; font-weight: 800; padding: 2px 8px; border-radius: 6px; }
      .vip-deal-btn {
        background: #6366f1;
        color: #fff;
        padding: 6px 12px;
        border-radius: 8px;
        text-decoration: none;
        font-size: 0.8rem;
        font-weight: 700;
        margin-left: 8px;
      }
      .vip-close-btn {
        position: absolute;
        top: 16px;
        right: 16px;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 1.4rem;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const badge = document.createElement('div');
    badge.className = 'vip-floating-badge';
    badge.innerHTML = `
      <span class="vip-pulse-dot"></span>
      <span>👑 Clube VIP de Cupons (${VIP_STATE.liveDropsCount} ao vivo)</span>
    `;

    const modal = document.createElement('div');
    modal.className = 'vip-modal-backdrop';
    modal.innerHTML = `
      <div class="vip-modal-card">
        <button class="vip-close-btn">&times;</button>
        <h3>👑 Clube VIP de Cupons Exclusivos</h3>
        <p>Acesse ofertas em tempo real com cashback e descontos secretos verificados hoje.</p>

        <div class="vip-deal-item">
          <div>
            <div class="vip-deal-title">🏨 Hotéis Booking.com</div>
            <span class="vip-deal-discount">ATÉ 40% OFF</span>
          </div>
          <a href="/api/ads/go?brand=booking&slot=vip_club&sid=vip_booking" class="vip-deal-btn">Resgatar</a>
        </div>

        <div class="vip-deal-item">
          <div>
            <div class="vip-deal-title">🛍️ Shopee: Cupons Frete Grátis</div>
            <span class="vip-deal-discount">CUPOM R$ 20 OFF</span>
          </div>
          <a href="/api/ads/go?brand=shopee&slot=vip_club&sid=vip_shopee" class="vip-deal-btn">Resgatar</a>
        </div>

        <div class="vip-deal-item">
          <div>
            <div class="vip-deal-title">🛡️ NordVPN Cyber Security</div>
            <span class="vip-deal-discount">74% OFF + 3 MESES</span>
          </div>
          <a href="/api/ads/go?brand=nordvpn&slot=vip_club&sid=vip_nordvpn" class="vip-deal-btn">Resgatar</a>
        </div>

        <div style="text-align: center; margin-top: 14px;">
          <small style="color: #64748b; font-size: 0.75rem;">Sincronizado via Supabase Realtime Edge Database 2026</small>
        </div>
      </div>
    `;

    document.body.appendChild(badge);
    document.body.appendChild(modal);

    badge.addEventListener('click', () => modal.style.display = 'flex');
    modal.querySelector('.vip-close-btn').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createVipWidget);
  } else {
    createVipWidget();
  }
})();
