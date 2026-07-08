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

## As duas fontes de dados (confirmado com dados reais da operação)

O app entende dois arquivos completamente diferentes, e os junta pela chave
**ROTAPL = ID Planejado** (ex. `CHP_3`, `AM1_5`):

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

### Como se combinam

Los dos archivos se pueden importar **en cualquier orden, cuantas veces
haga falta**, y el merge es por campo (no pisa todo el objeto):

- El archivo de **optimización** sólo escribe `stationLabel`,
  `detalheRoteiro`, `veiculoPlanejado`, `pacotesEstimados`, `hybridExplicit`
  y `expectedSacas` (esto último **solo si la ruta todavía no tiene sacas
  reales**).
- El archivo de **separação** sólo escribe `sacas` (reemplaza) y
  `expectedSacas` (al conteo real) **cuando trae `ROTASACA` poblado** para
  esa ruta; si no lo trae, no toca nada de lo que ya había.

Esto está probado con Playwright en ambos órdenes de importación.

## Flujo en el app

1. **Importar** — sube cualquiera de los dos archivos; se autodetecta el
   tipo por las columnas y se puede corregir a mano.
2. **Asignar sacas** — el operador confirma/ajusta las sacas por ruta (1 a
   6+ sacas físicas, puede variar por excepción). El checkbox "Híbrida"
   muestra su origen (`(del archivo)` cuando viene de `Tipos de serviços`,
   `(sugerida)` cuando es heurística, sin sufijo una vez que se corrige a
   mano).
3. **QR de estação** — genera e imprime una etiqueta con QR por saca, usando
   `ID Otimizado` como rótulo principal y el código físico real
   (`ROTASACAPL`) cuando está disponible.

Formato del payload del QR (provisorio, hasta integrar con el formato real
de lectura del Nex):

```
NEX-SSC2|ROTA:<ID_Otimizado_o_pool>|POOL:<ROTAPL>|SACA:<código_físico_o_label>|LOTE:<lote_o_turno>|HIB:<0|1>
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
