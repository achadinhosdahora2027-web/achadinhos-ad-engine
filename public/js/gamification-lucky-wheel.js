/**
 * ==============================================================================
 * GAMIFICATION LUCKY WHEEL (ROLETA DA SORTE DE CUPONS 2026)
 * Managed by: Head of CRO & Growth Marketing
 * ==============================================================================
 * Ultra-high-converting gamified wheel of discounts for instant traffic capture.
 */

(function () {
  if (window.__LUCKY_WHEEL_INITIALIZED__) return;
  window.__LUCKY_WHEEL_INITIALIZED__ = true;

  const PRIZES = [
    { title: "🛍️ R$ 20 OFF Shopee", link: "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&slot=wheel&sid=lucky_wheel_shopee", code: "VIPSHOPEE20" },
    { title: "🏨 40% OFF Booking", link: "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&slot=wheel&sid=lucky_wheel_booking", code: "BOOKINGVIP40" },
    { title: "🛡️ 74% OFF NordVPN", link: "https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=nordvpn&slot=wheel&sid=lucky_wheel_vpn", code: "NORDVIP74" },
    { title: "🔮 Tarot 3D VIP Grátis", link: "/entretenimento.html#tarot", code: "COSMICVIP" }
  ];

  function createLuckyWheelModal() {
    const style = document.createElement('style');
    style.innerHTML = `
      .wheel-floating-trigger {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99997;
        background: linear-gradient(135deg, #f59e0b, #d97706, #b45309);
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        box-shadow: 0 10px 25px rgba(217, 119, 6, 0.4);
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.85rem;
        font-weight: 800;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
        animation: wheelBounce 2s infinite ease-in-out;
      }
      @keyframes wheelBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      .wheel-modal-backdrop {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8);
        backdrop-filter: blur(8px);
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .wheel-modal-card {
        background: #0f172a;
        border: 2px solid #f59e0b;
        border-radius: 24px;
        width: 100%;
        max-width: 440px;
        padding: 28px 20px;
        color: #f8fafc;
        text-align: center;
        font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 25px 50px -12px rgba(245, 158, 11, 0.3);
        position: relative;
      }
      .wheel-spinner-disc {
        width: 180px;
        height: 180px;
        margin: 20px auto;
        border-radius: 50%;
        border: 6px solid #f59e0b;
        background: conic-gradient(#ef4444 0% 25%, #3b82f6 25% 50%, #10b981 50% 75%, #8b5cf6 75% 100%);
        box-shadow: 0 0 20px rgba(245, 158, 11, 0.5);
        transition: transform 3.5s cubic-bezier(0.15, 0.9, 0.25, 1);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wheel-center-pointer {
        width: 40px;
        height: 40px;
        background: #fff;
        border-radius: 50%;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
      }
      .wheel-spin-btn {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #fff;
        border: none;
        padding: 14px 28px;
        border-radius: 12px;
        font-size: 1.1rem;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(245, 158, 11, 0.4);
        transition: transform 0.2s;
        width: 100%;
        margin-top: 15px;
      }
      .wheel-spin-btn:hover { transform: scale(1.02); }
      .wheel-result-box { display: none; margin-top: 20px; background: #1e293b; padding: 16px; border-radius: 16px; border: 1px solid #10b981; }
      .wheel-close-btn { position: absolute; top: 16px; right: 16px; background: transparent; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const trigger = document.createElement('div');
    trigger.className = 'wheel-floating-trigger';
    trigger.innerHTML = `<span>🎡 Girar Roleta da Sorte (Prêmios)</span>`;

    const modal = document.createElement('div');
    modal.className = 'wheel-modal-backdrop';
    modal.innerHTML = `
      <div class="wheel-modal-card">
        <button class="wheel-close-btn">&times;</button>
        <h2 style="font-size: 1.5rem; color: #f59e0b; margin-bottom: 6px;">🎡 Roleta da Sorte 2026</h2>
        <p style="font-size: 0.9rem; color: #94a3b8;">Gire a roleta e desbloqueie um cupom exclusivo para compras ou viagens hoje!</p>

        <div class="wheel-spinner-disc" id="luckyWheelDisc">
          <div class="wheel-center-pointer">🎯</div>
        </div>

        <button class="wheel-spin-btn" id="luckyWheelSpinBtn">GIRAR ROLETA GRÁTIS!</button>

        <div class="wheel-result-box" id="luckyWheelResult">
          <h3 style="color: #10b981; font-size: 1.2rem; margin-bottom: 6px;" id="luckyWheelPrizeTitle">🎉 Parabéns!</h3>
          <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 12px;">Seu cupom expira em <span style="color: #ef4444; font-weight: bold;">14:59</span></p>
          <a href="#" id="luckyWheelPrizeLink" class="wheel-spin-btn" style="display:block; text-decoration: none; background: #10b981;">RESGATAR MEU PRÊMIO AGORA</a>
        </div>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(modal);

    let spun = false;

    trigger.addEventListener('click', () => modal.style.display = 'flex');
    modal.querySelector('.wheel-close-btn').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    const disc = modal.querySelector('#luckyWheelDisc');
    const spinBtn = modal.querySelector('#luckyWheelSpinBtn');
    const resultBox = modal.querySelector('#luckyWheelResult');
    const prizeTitle = modal.querySelector('#luckyWheelPrizeTitle');
    const prizeLink = modal.querySelector('#luckyWheelPrizeLink');

    spinBtn.addEventListener('click', () => {
      if (spun) return;
      spun = true;
      spinBtn.style.display = 'none';
      const randomDegree = 1800 + Math.floor(Math.random() * 360);
      disc.style.transform = `rotate(${randomDegree}deg)`;

      setTimeout(() => {
        const winningPrize = PRIZES[Math.floor(Math.random() * PRIZES.length)];
        prizeTitle.innerText = `🎉 Você Ganhou: ${winningPrize.title}!`;
        prizeLink.href = winningPrize.link;
        resultBox.style.display = 'block';
      }, 3600);
    });

    // Auto-open after 25s for indecisive visitors
    setTimeout(() => {
      if (!sessionStorage.getItem('wheel_auto_opened')) {
        sessionStorage.setItem('wheel_auto_opened', 'true');
        modal.style.display = 'flex';
      }
    }, 25000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createLuckyWheelModal);
  } else {
    createLuckyWheelModal();
  }
})();
