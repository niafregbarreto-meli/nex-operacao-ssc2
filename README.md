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
   Um botão **só fica habilitado quando tem QR real** (da extração) — fiel ao
   original, que cinza as sacas sem QR na base em vez de inventar um.
3. **Imprimir** — CARTÃO (4x1, A4) ou FOLHA (1x1). Cada cartão: número da
   saca (grande) + prefixo da rota + QR (o `CONTAINER_QR` verbatim que o
   sistema oficial da MELI já gerou).

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

## Ainda por confirmar / próximos passos

- Ajustar o visual fino ao guia Andes oficial (tipografia Proxima Nova só
  carrega dentro da rede MELI; localmente usa fallback de sistema).
- Definir se o site é fixo (SSC2) ou multi-site.
- Confirmar o layout exato de impressão desejado (tamanho de etiqueta,
  campos: só rota, ou também agência/veículo como na versão CHP).
