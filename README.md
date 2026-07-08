# Nex — Operação SSC2 (Biguaçu)

App estática para o fluxo Nex: importar os dois arquivos-fonte, associar
sacas físicas a cada rota e imprimir os QR Codes de estação/saca.

## Estrutura

```
grid-site/                        ← código fonte editável
  index.html                      ← usa <link>/<script src> para assets/ (dev local)
  assets/
    app.js                        ← lógica da aplicação (import, atribuição, QR)
    app.css
    grid-shim.js                  ← persistência: window.GRID.state (memória em preview local)
    qrcode.js                     ← gerador de QR vendorizado (qrcode-generator, MIT, Kazuhiko Arase)
  build_single_file.py            ← funde tudo em um único .html
dist/
  nex-ssc2-presorting.html        ← ARQUIVO A SUBIR NO GRID (gerado, não editar à mão)
```

Grid, nesta conta, só aceita subir um `.html` solto (não `.zip`/pasta) — e
**rejeita (400 `invalid_file`) qualquer HTML que use `localStorage` ou
`sessionStorage`**. Por isso o fallback de persistência fora do Grid é só em
memória (não sobrevive a um reload da página; dentro do Grid isso não
importa porque `window.GRID.state` é o storage real). Sempre que editar algo
em `grid-site/assets/`, rodar de novo:

```bash
cd grid-site && python3 build_single_file.py
```

E antes de subir qualquer versão nova a Grid, convém confirmar que não
reaparecem os padrões proibidos:

```bash
grep -c "localStorage\|sessionStorage\|confirm(\|alert(\|prompt(" dist/nex-ssc2-presorting.html
# tem que dar 0
```

## Rodar localmente

```bash
cd grid-site
python3 -m http.server 8080
# abrir http://localhost:8080
```

## Publicar no Grid

Subir `dist/nex-ssc2-presorting.html` diretamente (upload manual pela UI de
Grid, ou via skill `grid-sharing:grid`). Atualizações seguintes: reenviar o
mesmo arquivo sobre o `doc_id` existente — arquivos HTML simples têm backup
automático no servidor.

## As três fontes de dados (confirmado com dados reais da operação)

O app entende três arquivos completamente diferentes. Os dois primeiros se
juntam pela chave **ROTAPL = ID Planejado** (ex. `CHP_3`, `AM1_5`); o
terceiro se junta pelo **número de saca** (`ROTASACA`/`NUMERO_NEX`), que é
um pool sequencial global do site — não reinicia em 1 por rota.

### 1. Arquivo de **optimização** (pré-triagem — "Ver layout" / UC)

Ex.: `ID Planejado, ID Otimizado, Detalhe do roteiro, Tipos de serviços,
Quantidade de sacas, Tipo de Veículo, Pacotes estimados`.

- **`ID Planejado`** (`CHP_3`) = a chave/pool da rota (mesma coisa que
  `ROTAPL` no outro arquivo).
- **`ID Otimizado`** (`X1_CHP`) = o rótulo operacional da estação — o que
  vai impresso no QR e o que o operador vê na tela "Ver layout".
- **`Tipos de serviços`** = **fonte real do flag híbrida** (valor `hybrid`).
  Isso substitui a heurística anterior (vehículo/empresa distintos), que
  ficou só como sugestão de segunda linha quando este arquivo não fornece o
  dado.
- **`Quantidade de sacas`** = quantidade esperada, usada só enquanto a rota
  ainda não tem sacas reais.

### 2. Arquivo de **separação / Q_SEPARACAO** (sorting, ~1h depois)

Mesmas colunas reais de antes: `ROTAPL, ROTAOT, ROTA, ROTACOMPLETA,
ROTASACA, ROTASACAPL, VEICULO, EMPRESA, AGENCIA, SERVICO`. Filtra por
`SERVICO` (default: só `NEX*`, fora `XPT`/`NORMAL`). Uma linha por saca real
quando `ROTASACA` está preenchido.

### 3. Arquivo de **extração** (o QR físico real — origem confirmada)

Confirmado com o código real (`nex_index.html` + `abastecimento_index.html`
do Apps Script que está sendo descontinuado): **nenhuma das telas gera QR
novo.** O QR físico já vem pré-impresso pela plataforma oficial da Mercado
Livre (`envios.adminml.com/logistics/sorting/containers`), como um JSON
`{"container_id": ..., "facility_id": "SSC2", "assignment": "..."}`. O
Apps Script só espelha esse dado (via BigQuery, tab "Extração") ou, como
fallback manual, lê o PDF oficial com `pdf.js` + `jsQR`.

Optamos pelo caminho BigQuery: a query real é

```sql
-- meli-bi-data.WHOWNER_FEED.SHIPPING_SORTING_HISTORY, CONTAINER_TYPE IN ('bag','baker_cart')
-- CONTAINER_QR = TO_JSON_STRING(STRUCT(container_id, facility_id, assignment))
-- daí extrai SITE, CICLO, ROTA, ROTAOT por JSON_EXTRACT_SCALAR
```

Colunas relevantes: `SITE, ROTA, CONTAINER_ID, CONTAINER_QR`. Só interessam
as linhas onde `ROTA` é **puramente numérica** (ex. `"24"`) — são as sacas
NEX (`assignment` sem `_`, por isso `CICLO` fica vazio na query e o Apps
Script antigo classificava como NEX). Linhas com `ROTA` tipo `D1_AM1` ou
`X1_CHP` são racks/carts de rota normal ou CHP, não sacas — se ignoram.

A chave de cruzamento é `ROTA` (desse arquivo) `== ROTASACA` (do arquivo de
separação/`Q_SEPARACAO`) — o mesmo campo `assignment` do histórico de
sorting, visto por duas queries diferentes. Uma vez cruzado, `CONTAINER_QR`
(o JSON completo, verbatim) passa a ser o payload real do QR impresso —
sem isso, o app usa um payload provisório e marca a etiqueta como tal.

**Limitação conhecida:** a query de extração, do jeito que está, não carrega
ciclo/data para as sacas NEX (`ROTA` puramente numérica) — então se dois
ciclos ativos tiverem números de saca sobrepostos ao mesmo tempo no app, o
cruzamento pode confundir um com o outro. Na prática isso não deveria
acontecer porque o operador importa os arquivos de um ciclo/lote por vez.

### Como se combinam

Los dos archivos se pueden importar **en cualquier orden, cuantas veces
haga falta**, y el merge es por campo (no pisa todo el objeto):

- El archivo de **optimización** sólo escribe `stationLabel`,
  `detalheRoteiro`, `veiculoPlanejado`, `pacotesEstimados`, `hybridExplicit`
  y `expectedSacas` (esto último **solo si la ruta todavía no tiene sacas
  reales**).
- El archivo de **separação** sólo escribe `sacas` (reemplaza) y
  `expectedSacas` (al conteo real) **cuando trae `ROTASACA` poblado** para
  esa ruta; si no lo trae, no toca nada de lo que ya había. Al reemplazar,
  conserva el `realQrPayload` que ya tuviera cada número de saca (no lo pisa
  con `null`).
- El archivo de **extração** sólo escribe `realQrPayload`/`containerId` en
  sacas que ya existen (por `ROTASACA`); si una saca todavía no fue
  importada por separação, se reporta como "no encontrada" y no crea nada.

Esto está probado con Playwright en los tres órdenes de importación
relevantes (incluyendo reimportar separação después de tener el QR real, y
verificar que sobrevive).

## Flujo en el app

1. **Importar** — sube cualquiera de los dos archivos; se autodetecta el
   tipo por las columnas y se puede corregir a mano.
2. **Asignar sacas** — el operador confirma/ajusta las sacas por ruta (1 a
   6+ sacas físicas, puede variar por excepción). El checkbox "Híbrida"
   muestra su origen (`(del archivo)` cuando viene de `Tipos de serviços`,
   `(sugerida)` cuando es heurística, sin sufijo una vez que se corrige a
   mano).
3. **QR de estação** — genera e imprime una etiqueta con QR por saca, usando
   `ID Otimizado` como rótulo principal. El QR en sí usa el `CONTAINER_QR`
   real (del archivo de extração) cuando ya está disponible — marcado
   "QR real" en verde tanto en la lista de sacas como en la etiqueta. Si
   todavía no llegó, usa un payload provisorio y lo marca explícitamente en
   la etiqueta ("no usar en producción") para que no se confunda con uno
   real.

Formato del payload del QR provisorio (solo mientras no haya `CONTAINER_QR`
real para esa saca):

```
NEX-SSC2-PROVISORIO|ROTA:<ID_Otimizado_o_pool>|POOL:<ROTAPL>|SACA:<código_físico_o_label>|LOTE:<lote_o_turno>|HIB:<0|1>
```

## Próximas fases (placeholders no app)

- **Post-sorting** — auditoria/conferência da saca antes do despacho.

## Nota sobre conectividade

Este ambiente de execução (sandbox remoto) não tem acesso de saída para
`grid.melioffice.com`, `grid.adminml.com` nem `docs.google.com` (bloqueados
no proxy de rede). Todo o desenvolvimento e teste foi feito com dados reais
compartilhados na conversa (a query SQL de `Q_SEPARACAO` e amostras de CSV
reais) e testado ponta a ponta com Playwright/Chromium local — mas a
integração com a API real do Grid (upload, `window.GRID.state` em produção)
ainda precisa ser validada por alguém com VPN corporativa da MELI.
