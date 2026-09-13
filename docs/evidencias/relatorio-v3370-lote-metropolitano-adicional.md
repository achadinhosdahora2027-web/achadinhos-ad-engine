# v3370.0 — lote metropolitano adicional

## Fontes e deduplicação

Foram recebidos oito PDFs. Três são byte a byte idênticos a fontes já processadas: EUA 2, Reino Unido original e Índia original. Eles foram comprovados por SHA-256 e não são reinseridos.

Os cinco documentos novos ou estendidos contêm 319 linhas:

- Austrália: 51;
- México: 50;
- Indonésia: 66;
- Índia 2: 99;
- Reino Unido 2: 53.

A comparação cumulativa encontrou 117 destinos já presentes em v3340/v3360. Isso inclui 74 linhas indianas, 42 linhas britânicas do primeiro PDF e York, que já existia no v3340 embora não estivesse no primeiro PDF britânico. O delta real é de **202 linhas**: AU 51, MX 50, ID 66, IN 25 e GB 10.

## Validação territorial

As 202 linhas foram cruzadas com `cities15000`, `admin1CodesASCII`, os dumps integrais AU/ID e `alternateNamesV2` do GeoNames, com hashes registrados. O resultado possui 126 linhas com aliases e 22 com alias não latino.

Três componentes metropolitanos indonésios foram preservados como evidência documental, mas não podem ser roteados como cidade: Deli Serdang, Gowa e Ogan Ilir são entidades administrativas ADM2 no mapeamento selecionado. Elas ficam desativadas. Restam **199 linhas territorialmente elegíveis**.

Nomes compostos australianos, como Shepparton–Mooroopna e Traralgon–Morwell, são mantidos como áreas urbanas combinadas; o sistema não os converte silenciosamente em uma cidade diferente.

## Evidência CJ atual

A consulta somente leitura confirmou 223 anunciantes associados e ativos, 242 contratos, 229 contratos ativos e três propriedades promocionais ativas. O Link Search com PID vinculado e filtro de país retornou:

- AU: 170 links temáticos; sete links de texto atuais e estritamente relevantes foram selecionados, cobrindo hotel, voo, aluguel de carro e atrações;
- MX: 86 links, mas nenhum link de texto de viagem em espanhol elegível. Os registros `Services` são modelos jurídicos, e os links `Vacation` em inglês são específicos para a Itália;
- ID: 31 links, mas nenhum em indonésio ou com relevância local suficiente. Os links ingleses são específicos para a Itália e o único registro aéreo é um banner em polonês.

Assim, somente AU recebe política nova. MX e ID ficam fail-closed. O filtro de país da CJ não é tratado como prova de disponibilidade em cada cidade.

## Arquitetura segura

A migração é aditiva e LOGGED. Ela não modifica os catálogos `ads`, `nexus_v370_keyword_source` ou `nexus_v380_keyword_vectors`; mantém a contagem canônica de 17.605 keywords e não ativa os jobs 15, 16 ou 64.

As sete URLs australianas não são versionadas. Em produção, elas foram enviadas por corpo preparado do PostgREST ao RPC temporário restrito a `service_role`, cifradas individualmente com o KMS existente, verificadas sem navegação e preservadas após a remoção física do RPC. O resolver retorna somente copy, intenção e `placement_key`, nunca URL ou ciphertext. As dez novas cidades britânicas e 25 indianas reutilizam apenas políticas v3360 ainda frescas; não há fallback silencioso quando elas expiram.

A migração e o adaptador Edge interno foram aplicados e validados fisicamente. Nenhuma página, sitemap, IndexNow, redirecionador, clique, impressão, conversão ou alegação de venda foi criado.
