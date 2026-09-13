# v3360.0 — descoberta metropolitana e estratégia segura

**Estado:** implementação local, não publicada, em 13/09/2026. Nenhuma página de cidade, rota de redirecionamento ou campanha foi ativada.

## 1. Matriz territorial validada

Os oito PDFs produziram 854 linhas brutas e 853 registros lógicos. O `Noida / Uttar Pradesh` repetido foi deduplicado. Todos os 853 registros lógicos foram cruzados com GeoNames (`cities15000`, `admin1CodesASCII`, quatro extratos nacionais para entidades fora do corte populacional e `alternateNamesV2`).

A expansão persistível contém **816 registros novos**: BR 50, CN 115, DE 92, GB 39, IN 74, JP 50, RU 127 e US 269. Os outros 37 (US 26 e GB 11) já existem no v3340 e não são duplicados.

Quatro linhas permanecem sem roteamento:

- `Sevastopol` e `Simferopol`: a linhagem continua ligada ao PDF russo, mas o país de roteamento é `UA` e a ativação fica fechada por causa do status territorial;
- `Novomoskovsky Administrative Okrug`: é distrito administrativo de Moscou, não cidade;
- `Changhai County`: é condado de Liaoning, não cidade.

Correções documentadas incluem `Anápolis / Goiás` (IBGE), `Huanggang / Hubei` (governo de Hubei), prefeituras japonesas e transliterações. Treze grupos de cidades americanas homônimas exigem área administrativa; o nome sozinho não resolve.

## 2. Evidência CJ obtida sem clique

Consultas somente leitura confirmaram:

- 223 anunciantes com relacionamento `joined`, todos `Active` no Advertiser Lookup;
- 242 contratos no Program Terms: 229 `ACTIVE`, 11 `EXPIRED`, 1 `PENDING_OFFER` e 1 `CANCELLED`; todos os 223 anunciantes `joined` possuem termo ativo;
- os 15.663 feeds do mercado foram coletados integralmente por 252 partições de país (a soma das partições e os IDs únicos fecharam em 15.663); o inventário completo restrito aos anunciantes associados contém 402 feeds;
- cinco feeds associados se declaram `TRAVEL`, mas isso não equivale a produto de viagem servível em cada cidade;
- 337 anunciantes não associados encontrados pela busca temática são apenas descoberta e nunca entram em roteamento;
- Link Search tem links temáticos ativos para US, CN, DE, BR, GB, JP e IN; não retornou link para RU.

A política local reteve 87 combinações país/locale/intenção, representando 69 links únicos. O filtro exige relacionamento e conta ativos, termo ativo, link de texto gerado para o PID, país-alvo correspondente, idioma suportado, janela de datas vigente e categoria de viagem. URLs de afiliado não foram salvas nos relatórios nem no repositório.

### Capacidade local comprovada por mercado

| Mercado | Locales retidos | Intenções com evidência | Políticas | Situação |
|---|---|---:|---:|---|
| US | en-US, es-US | viagem, voo, hotel, férias, carro | 33 | candidata; URL criptografada ainda ausente |
| CN | zh-CN | voo | 1 | candidata; não prova oferta para uma cidade chinesa |
| RU | — | — | 0 | fechada |
| DE | de-DE | viagem, hotel | 10 | candidata |
| BR | pt-BR | viagem | 3 | candidata |
| GB | en-GB | viagem, voo, hotel, férias, carro, bem-estar | 34 | candidata |
| JP | ja-JP | voo | 1 | candidata |
| IN | en-IN | voo, férias | 5 | candidata |

“País-alvo” é evidência de segmentação do link, **não** prova entrega, inventário ou disponibilidade na cidade. Nenhuma cópia afirma isso.

## 3. Estratégia de descoberta legítima

1. **Não criar 853 páginas doorway.** Cada URL só pode sair de `noindex` depois de possuir conteúdo local útil, fonte pública verificável, intenção explícita e pelo menos uma rota atual válida.
2. **Canonical e hreflang reais.** Uma página por entidade e locale efetivamente revisado; aliases redirecionam apenas para a canonical sem criar duplicatas indexáveis.
3. **Sitemaps incrementais.** Incluir somente páginas HTTP 200, canonical próprias e publicáveis. IndexNow deve receber apenas URLs realmente novas/alteradas e continuar obedecendo às restrições já instaladas.
4. **Conteúdo útil antes do anúncio.** Informações práticas da cidade, contexto do usuário e critérios de comparação vêm antes do bloco comercial. Não gerar texto por troca de nome da cidade.
5. **Sem prova de cidade por cabeçalho CDN.** `CF-IPCountry` e `x-vercel-ip-country` só limitam o país. A cidade precisa vir de consulta explícita do usuário ou URL escolhida.

## 4. Relevância e cópia

A função v3360 usa correspondência lexical exata de país, cidade/alias, área administrativa quando ambígua, locale e intenção. O texto é determinístico e neutro. Ele manda confirmar disponibilidade, preço, cobertura e condições no parceiro; não promete desconto, comissão, estoque ou venda.

O disclosure é um campo separado, `#ad`, que deve aparecer em linha própria imediatamente antes do link. O resolver e o adaptador Edge internos não devolvem URL e não redirecionam.

## 5. Ativação interna dos links

Na janela operacional de 13/09/2026, a instalação interna:

1. consultou novamente Advertiser Lookup, Program Terms e cada uma das 87 combinações Link ID/país;
2. confirmou conta `Active`, relacionamento `joined`, termo `ACTIVE`, link ativo, geração pelo PID vinculado, filtro de país e datas;
3. enviou 87 linhas por corpo preparado do PostgREST a um RPC temporário restrito a `service_role`;
4. criptografou cada URL individualmente no PostgreSQL com AES-256/OpenPGP;
5. validou fisicamente 87 ciphertexts, 87 rotas, 5 hashes de host permitidos e o resolver sem devolver nem seguir URL;
6. removeu o RPC de hidratação e validou o adaptador Edge interno em produção.

Isso **não** publicou página, sitemap, IndexNow ou endpoint de clique. O prazo de validade da evidência operacional é 24 horas. Expirada, a seleção fecha automaticamente; uma revalidação futura deve repetir todo o preflight e a hidratação protegida.

## 6. Medição e otimização

- `page_view`: somente evento real do navegador, sem base aleatória;
- `affiliate_click`: somente navegação iniciada pelo usuário; sem prefetch, scanner, HEAD ou robô que siga o link;
- `conversion`: apenas postback autenticado da rede, com ID externo e idempotência transacional;
- falha de rede é `Sintonizado em Análise`, nunca `VENDAS`;
- EPC da CJ pode ser armazenado apenas como métrica reportada pela rede, com horário e moeda, nunca como resultado próprio;
- a ordenação inicial é determinística. Otimização só começa depois de volume humano mínimo e dados de conversão confirmados; sem urgência, “mais vendido” ou falsa escassez.

## 7. Anti-IVT e privacidade

- proibir testes que carreguem URLs de tracking;
- não renderizar pixel/link de afiliado antes de ação do usuário;
- `rel="sponsored nofollow noopener"` em links publicáveis;
- limitar repetição por identificador anônimo e janela de tempo sem afirmar que isso prova humanidade;
- respeitar consentimento e minimização de dados;
- separar telemetria de visualização, clique e conversão;
- não usar bots, workers ou health checks para produzir clique/impressão.

## 8. Critérios para publicação

Uma cidade só fica publicável quando todos forem verdadeiros: entidade validada; ambiguidade resolvida; conteúdo local revisado; locale suportado; intenção explícita; relação e termo ativos; link PID válido; país correspondente; datas atuais; URL criptografada; disclosure próprio; endpoint de clique anti-IVT testado; canonical/sitemap corretos; e nenhuma alteração nos placements protegidos. Se qualquer item falhar, permanece `noindex` e sem link.
