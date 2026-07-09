# GESTÃO NEX — Operação SSC2 (Biguaçu)

Réplica da ferramenta **GESTÃO NEX** (hoje em Apps Script, sendo
descontinuada) migrada para **Grid**, num único arquivo HTML, redesenhada
com visual **Andes / Mercado Livre**.

O operador: escolhe o site → **anexa só o CSV de otimização** (o QR real
chega solo, sincronizado direto da planilha via Grid) → vê cada rota (L1,
L2, M1…) como uma grade de **botões de saca numerados**, seleciona quais
imprimir (pode excluir sacas pontuais com o ×) → imprime cartões com número
grande + prefixo da rota + QR real da saca.

## Estrutura

```
grid-site/                        ← código fonte editável
  index.html                      ← estrutura (usa assets/ para dev local)
  assets/
    app.js                        ← lógica: import, grade de sacas, seleção, impressão
    app.css                       ← design system Andes/ML
    grid-shim.js                  ← persistência: window.GRID.state (memória em preview local)
    qrcode.js                     ← gerador de QR vendorizado (qrcode-generator, MIT)
  build_single_file.py            ← funde tudo em um único .html
dist/
  nex-ssc2-presorting.html        ← ARQUIVO A SUBIR NO GRID (gerado)
```

Regras do Grid respeitadas: **um único `.html` inline** (sem `.zip`, sem
CDN externo — Tailwind/qrcodejs por CDN não funcionam no Grid), e **zero
`localStorage`/`sessionStorage`** (o Grid rejeita o upload com `invalid_file`
se encontrar). Rebuild + verificação antes de subir:

```bash
cd grid-site && python3 build_single_file.py
grep -c "localStorage\|sessionStorage\|cdn\.\|cdnjs\|tailwindcss" dist/nex-ssc2-presorting.html   # = 0
```

## Fluxo (fiel ao Apps Script original)

1. **Otimização (manual) + Extração (automática)**:
   - **Anexar CSV** (otimização) — o **único upload manual**. Rota +
     quantidade de sacas. Numera as sacas com um **contador global
     sequencial** por todo o site (L1 = 1–36, L2 continua 37–41…), não
     reinicia por rota.
   - **Extração (QR) — automática**: ao abrir o app dentro do Grid, ele lê
     sozinho a aba `SEPARACAO_NEX` da planilha "SSC2 BASE 2026"
     (`Grid.sheets.get('1w31lqax56lMcjbvoj5VhdDf9gwEYSh2ldjMuTb9WV8Y',
     'SEPARACAO_NEX')` — saída da query `Q_SEPARACAO`), sem nenhum passo do
     operador. Um badge no cabeçalho mostra "Sincronizado às HH:MM" ou o
     motivo da falha; o botão "Atualizar planilha" força um novo sync a
     qualquer momento. Só entram linhas cuja `ROTASACA` é **puramente
     numérica** (sacas NEX); linhas de rota/CHP são ignoradas. Constrói as
     rotas **e** traz o `CONTAINER_QR` real de cada saca.
   - **"CSV manual"** — fallback caso o Grid não consiga ler a planilha
     (Google não conectado, `Grid.sheets` indisponível, etc.): mesmo CSV de
     extração, só que subido à mão.
   - **Recuperar salvo**: recarrega o estado salvo no Grid.
2. **Grade de sacas** — cada rota mostra seus números. Clicar seleciona
   (azul); o × exclui uma saca pontual (fica um buraco na numeração, igual à
   ferramenta real); "Sel. grupo" / "Sel. todos" / "Restaurar excluídas".
   Todas as sacas são **sempre selecionáveis**; um ponto verde/cinza no canto
   indica se aquela saca já tem QR real da base, e um banner avisa quando a
   base ainda não foi carregada.
3. **Imprimir** — três formatos fiéis aos PDFs da ferramenta atual:
   - **CARTÃO (4x1)**: número (grande) · rota (faixa cinza) · **AGÊNCIA** ·
     **MODAL** (veículo limpo, ex. "PASSEIO 6H") · QR.
   - **FOLHA (1x1)**: etiqueta grande dobrável (espelho oeste/leste, QR em
     cima e embaixo, número rotacionado, agência/rota/modal na lateral).
   - **ETIQUETA**: tamanho configurável (padrão 12×5 cm) com QR na lateral e
     as linhas SACA / ROTA / AGÊNCIA / MODAL.
   O QR é o `CONTAINER_QR` verbatim do sistema oficial (ou reconstruído
   `{container_id, facility_id, assignment}` quando a base traz só o
   `CONTAINER_ID`). Veículo é normalizado para o modal curto igual ao
   `limparTextoVeiculo` original.

O QR nunca é inventado: vem pré-impresso pela plataforma oficial
(`envios.adminml.com/logistics/sorting/containers`) e chega aqui via a
extração BigQuery. Fonte da query em `docs/` da conversa
(`SHIPPING_SORTING_HISTORY` → `CONTAINER_QR` JSON).

### "+ QR adicional" — planilha de "salvados" como fonte extra

A planilha de "salvados" do Apps Script antigo (`NUMERO_NEX`, `CÓDIGO QR`
fixos; `ROTAPL`/`ROTAOT` que mudam a diário ao subir a otimização) **não**
é usada para criar/atualizar rotas — só como fallback para tapar buracos de
QR em sacas que **já existem** nas rotas carregadas (via "Anexar CSV" ou
"Extração (QR)"). Nunca sobrescreve um QR que já tem, nunca cria rota nova.
Botão "+ QR adicional" no cabeçalho, aceita `NUMERO_NEX`/`ROTASACA` +
`CÓDIGO QR`/`CONTAINER_QR` (ou `CONTAINER_ID`, reconstruindo o JSON).
Testado: idempotente (reimportar não duplica nem some com nada).

## Rodar localmente

```bash
cd grid-site && python3 -m http.server 8080   # abrir http://localhost:8080
```

## Publicar no Grid

Subir `dist/nex-ssc2-presorting.html` (upload manual na UI do Grid ou via
skill `grid-sharing:grid`). Atualizações: reenviar sobre o mesmo `doc_id`.

## Testado

Fluxo completo verificado com Playwright/Chromium (import da extração →
grade com numeração global e buracos corretos → Sel. grupo / exclusão /
restaurar / Sel. todos → visor de extração → impressão gerando os cartões
com QR real), tanto no código fonte quanto no `.html` único final.

## Nota sobre conectividade

Este ambiente (sandbox remoto) não tem saída de rede para
`grid.melioffice.com`, `grid.adminml.com` nem `docs.google.com`. Todo o
trabalho foi feito a partir do código Apps Script real e das capturas/dados
compartilhados na conversa; a integração com a API do Grid e o
`window.GRID.state` em produção precisam ser validados de um ambiente com
VPN corporativa da MELI.

## Auto-sync da planilha via Grid.sheets — status

**Bug real encontrado e corrigido** (era a causa provável do "QR PENDENTE"
mesmo com Google já conectado): a API de Sheets vive em `window.Grid`
(mixed-case, carregado via `<script src="/d/_assets/grid-sdk.js">` +
`Grid.configure({docId})`) — **não** em `window.GRID` (all-caps, injetado
automaticamente, só tem `.state`/`.states`). O código anterior checava
`window.GRID.sheets`, que nunca existe; por isso a sincronização nunca
chegava a tentar a chamada real, silenciosamente.

Corrigido em `app.js`:
- `<script src="/d/_assets/grid-sdk.js">` adicionado no `index.html`.
- `Grid.configure({docId})` chamado uma vez, com o `docId` obtido de
  `window.GRID.docId` (com fallback ao path `/d/<id>/raw`) — não precisa
  hardcodear o ID do documento.
- `syncFromSheet()` agora checa `window.Grid.sheets` (certo) e trata os 4
  formatos de resposta documentados: array puro, `{values:[...]}`,
  `{rows:[...]}` e `{sheets:{TAB:[...]}}`.
- `grid-shim.js`: `window.GRID.state.get()` resolve `{state, updated_at}`,
  não o state puro — o código antigo devolvia o objeto errado (isso quebraria
  a leitura do estado salvo silenciosamente). Corrigido para desempacotar e
  guardar `updated_at` para o próximo `.set(next, updated_at)`.
- **Regressão evitada:** como a sincronização agora corre em **todo** load
  (silenciosa), `importExtracao()` deixou de resetar a seleção de impressão
  e as sacas excluídas a cada vez — só `importOptimization()` (nova
  numeração) reseta os dois.

Testado com Playwright simulando `window.GRID` (docId + state) e
`window.Grid` (configure + sheets.get) como dois objetos separados — não dá
para chamar a API real deste sandbox (sem rede para
`grid.melioffice.com`/VPN da MELI). Confirmado: `Grid.configure` chamado uma
vez só, `Grid.sheets.get(sheetId, tab)` com os args certos, os 4 formatos de
resposta populam igual, seleção/exclusão sobrevivem a um re-sync manual, e
o estado sobrevive a um reload.

**Ainda por confirmar num Grid real:**
- Se `Grid.sheets.get(sheetId, tab)` aceita o nome do tab puro (`'SEPARACAO_NEX'`)
  como no exemplo da doc, ou exige A1 notation (`'SEPARACAO_NEX!A:Z'`).
- Se o ID da planilha (`1w31lqax56lMcjbvoj5VhdDf9gwEYSh2ldjMuTb9WV8Y`) e a
  aba (`SEPARACAO_NEX`) são exatamente isso — está no topo de `app.js`
  (`GRID_SHEET_ID`, `GRID_SHEET_TAB`) para editar fácil se mudar.

Se ainda aparecer "QR PENDENTE" depois desta correção, me manda o texto
exato do `#syncStatus` (ao lado do botão "Atualizar planilha") — agora ele
deveria dizer a causa específica em vez de falhar em silêncio.

## Ainda por confirmar

- Tipografia: Proxima Nova só carrega dentro da rede MELI; localmente usa
  fallback de sistema.
- Site fixo (SSC2) ou multi-site.
- Se querem o QR também na ETIQUETA (foi adicionado) ou só as 4 linhas de
  texto como no PDF original.
