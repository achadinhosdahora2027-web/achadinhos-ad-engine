/**
 * ==============================================================================
 * INSTAGRAM REELS & VIDEO METADATA PUBLISHING PIPELINE (2026)
 * Managed by: Head of Video Growth & CMO (Marketing)
 * ==============================================================================
 * Generates high-converting vertical video scripts, audio hooks, and metadata
 * for Instagram Reels API publishing on @aquitatem and @achadinhosdahora24hrs.
 */

const fs = require('fs');
const path = require('path');

const REELS_TEMPLATES = [
  {
    id: "reels_01_shopee_aspirador_robo",
    title: "O Aspirador Robô Que Limpa a Casa Sozinho! 🤖✨",
    target_handle: "@achadinhosdahora24hrs",
    audio_trend: "Viral Upbeat Lofi Tech Beat 2026",
    hook_3s: "Pare de varrer a casa agora! Esse achadinho da Shopee fez isso...",
    caption: `Olha esse achadinho que salvou a minha rotina! 🤖✨\n\nEle aspira, varre e passa pano bivolt com sensor anti-queda.\n\n👉 Comente "EU QUERO" que o link com cupom cai no seu Direct na hora!\n\n🔗 Ou acerte no link da bio: achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&sid=ig_reels_robo\n\n#Achadinhos #Shopee #AchadinhosShopee #CasaLimpa #RoboAspirador #DicasDeCasa`,
    keywords_trigger: ["EU QUERO", "ROBO", "CUPOM", "LINK"],
    duration_sec: 18
  },
  {
    id: "reels_02_booking_gramado_serra",
    title: "Como se Hospedar em Gramado Pagando Metade do Preço! 🌲🍫",
    target_handle: "@aquitatem",
    audio_trend: "Aesthetic Travel Cinematic Piano 2026",
    hook_3s: "Você sabia que dá pra ir pra Gramado no Natal Luz gastando bem menos?",
    caption: `Segredo revelado para viajar pagando pouco! 🌲🍫✨\n\nO Booking liberou descontos secretos em chalés e resorts com café da manhã e cancelamento grátis!\n\n👉 Comente "GRAMADO" para receber a lista VIP de hotéis no seu Direct!\n\n🔗 Link no perfil: aquitemachadinhos.com.br\n\n#Gramado #NatalLuz #Viagens #Turismo #Booking #DicasDeViagem #SerraGaucha`,
    keywords_trigger: ["GRAMADO", "HOTEL", "VIAGEM", "RESERVA"],
    duration_sec: 22
  },
  {
    id: "reels_03_tarot_previsao_signos",
    title: "A Mensagem Que o Seu Signo Precisava Ouvir Hoje! 🔮✨",
    target_handle: "@aquitatem",
    audio_trend: "Mystic Ambient Frequency 432Hz",
    hook_3s: "Respire fundo e escolha uma carta. O que vem pra você neste mês?",
    caption: `Uma virada inesperada está se aproximando do seu caminho! 🔮✨\n\n👉 Comente o seu SIGNO para abrir o oráculo 3D interativo gratuito no Direct!\n\n🔗 Previsão completa na bio: aquitemachadinhos.com.br/entretenimento.html\n\n#Tarot #Astrologia #Signos #Previsoes #Horoscopo #Espiritualidade #Oraculo`,
    keywords_trigger: ["SIGNO", "TAROT", "ORACULO", "PREVISAO"],
    duration_sec: 15
  }
];

function generateReelsMetadata(reelsId) {
  const reel = REELS_TEMPLATES.find(r => r.id === reelsId) || REELS_TEMPLATES[0];
  return {
    ...reel,
    media_type: "REELS",
    aspect_ratio: "9:16",
    resolution: "1080x1920",
    created_at: new Date().toISOString(),
    status: "ready_for_container_upload"
  };
}

module.exports = {
  generateReelsMetadata,
  REELS_TEMPLATES
};
