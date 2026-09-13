# v3370.0 — estratégia de descoberta e conversão legítima

## Princípio

Uma linha de cidade não é uma página útil, e um país-alvo da rede não prova serviço em cada município. A expansão só pode gerar tráfego quando houver conteúdo local revisado, intenção explícita do usuário, política fresca e endpoint de clique iniciado por humano.

## Mercados

### Austrália

Há sete links atuais e adequados, em inglês australiano, para hotel, voo, aluguel de carro e atrações. Conteúdo futuro deve comparar categorias verificáveis e sempre instruir o usuário a confirmar preço, disponibilidade, cobertura e termos no parceiro. `#ad` deve ficar em linha própria imediatamente antes de cada link.

### México

O inventário atual não oferece link de viagem em espanhol que passe pelo filtro estrito. Não converter os modelos jurídicos encontrados pela palavra “rental” em oferta de viagem. Não traduzir links italianos em uma alegação de serviço local. As 50 cidades podem servir ao léxico interno, mas ficam sem rota CJ.

### Indonésia

O inventário atual não oferece link em indonésio nem oferta local suficientemente relevante. Os links de turismo italiano só poderiam aparecer em uma página explicitamente sobre viagem da Indonésia à Itália; não devem ser usados como fallback geral. O lote fica sem rota CJ.

### Índia e Reino Unido

As 35 cidades realmente novas podem reutilizar apenas políticas v3360 do mesmo país, locale e intenção enquanto a evidência estiver fresca. A expiração fecha a seleção automaticamente. Não inferir cidade, idioma, residência, intenção ou humanidade de um cabeçalho de país.

## Descoberta

- páginas únicas, revisadas e úteis antes de indexar;
- canonical e sitemap somente depois da validação física;
- sem doorway pages, texto parafraseado em massa ou “near me” sem localização fornecida;
- native/transliterated aliases usados somente para resolver entrada do usuário, não para criar páginas duplicadas;
- MX e ID permanecem `noindex` e sem link até nova evidência.

## Medição

- `page_view`: somente evento real de navegador;
- `affiliate_click`: somente gesto explícito, nunca prefetch, bot, health check ou teste automático;
- `conversion`: somente postback autenticado e idempotente da rede;
- falha operacional: `Sintonizado em Análise`, nunca `VENDAS`;
- sem urgência falsa, desconto inventado, estoque presumido, EPC fabricado ou alegação de vendas.

## Gate de publicação

Exigir simultaneamente: destino e região validados; conteúdo local revisado; locale suportado; intenção explícita; conta, contrato e link atuais; país correspondente; URL cifrada; disclosure próprio; redirect anti-IVT testado sem seguir links; canonical/sitemap corretos; e placements protegidos byte-idênticos. Na ausência de qualquer item, a rota permanece interna e não indexada.
