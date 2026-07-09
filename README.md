# GESTÃO NEX — Operação SSC2 (Biguaçu)

Réplica da ferramenta **GESTÃO NEX** (hoje em Apps Script, sendo
descontinuada) migrada para **Grid**, num único arquivo HTML, redesenhada
com visual **Andes / Mercado Livre**.

O operador: escolhe o site → importa a otimização/extração → vê cada rota
(L1, L2, M1…) como uma grade de **botões de saca numerados**, seleciona
quais imprimir (pode excluir sacas pontuais com o ×) → imprime cartões com
número grande + prefixo da rota + QR real da saca.

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

1. **Otimização / Extração** — três formas de carregar as rotas e suas sacas:
   - **Anexar CSV** (otimização): rota + quantidade de sacas. Numera as
     sacas com um **contador global sequencial** por todo o site (L1 = 1–36,
     L2 continua 37–41…), não reinicia por rota.
   - **Extração (QR)**: o CSV da query BigQuery
     (`ROTAOT, ROTAPL, ROTASACA, ROTASACAPL, CONTAINER_QR, AGENCIA, VEICULO`).
     Só entram linhas cuja `ROTASACA` é **puramente numérica** (sacas NEX);
     linhas de rota/CHP são ignoradas. Constrói as rotas **e** traz o
     `CONTAINER_QR` real de cada saca — é o caminho que deixa os botões
     "acesos" e prontos para imprimir.
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

## Próximo passo importante: auto-carga da base via Grid Sheets

Hoje a base de QR/agência/modal entra por **upload de CSV** (botão "Extração
(QR)"). O usuário confirmou que o Grid lê planilhas do Google direto (só
leitura) — isso corresponde ao SDK `Grid.sheets.get(sheetId, 'TAB')`. O
plano é, rodando dentro do Grid, ler automaticamente a aba de extração da
planilha "SSC2 BASE 2026" (`1w31lqax56lMcjbvoj5VhdDf9gwEYSh2ldjMuTb9WV8Y`,
atualizada por queries diariamente), sem passo manual. Não foi implementado
ainda porque não dá para testar `Grid.sheets` fora do Grid — precisa ser
feito/validado num ambiente com Grid + VPN.

## Ainda por confirmar

- Tipografia: Proxima Nova só carrega dentro da rede MELI; localmente usa
  fallback de sistema.
- Site fixo (SSC2) ou multi-site.
- Se querem o QR também na ETIQUETA (foi adicionado) ou só as 4 linhas de
  texto como no PDF original.
