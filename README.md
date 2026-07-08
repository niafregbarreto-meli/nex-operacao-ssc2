# Nex — Operação SSC2 (Biguaçu)

App estática (pré-triagem) para o fluxo Nex: importar o arquivo de separação,
associar sacas físicas a cada rota e imprimir os QR Codes de estação.

## Estrutura

```
grid-site/                        ← código fonte editável
  index.html                      ← usa <link>/<script src> para assets/ (dev local)
  assets/
    app.js                        ← lógica da aplicação (import, atribuição, QR)
    app.css
    grid-shim.js                  ← persistência: window.GRID.state em Grid, localStorage fora dele
    qrcode.js                     ← gerador de QR vendorizado (qrcode-generator, MIT, Kazuhiko Arase)
  build_single_file.py            ← funde tudo em um único .html
dist/
  nex-ssc2-presorting.html        ← ARQUIVO A SUBIR NO GRID (gerado, não editar à mão)
```

Grid, nesta conta, só aceita subir um `.html` solto (não `.zip`/pasta). Por
isso o app é escrito de forma modular em `grid-site/` para facilitar edição,
e um script funde tudo (`build_single_file.py`) num único arquivo autocontido
em `dist/`. **Sempre que editar algo em `grid-site/assets/`, rodar de novo:**

```bash
cd grid-site && python3 build_single_file.py
```

Sem backend próprio: os dados (rotas, sacas atribuídas) ficam salvos no estado
colaborativo do documento Grid (`window.GRID.state`). Fora do Grid (preview
local), cai automaticamente para `localStorage`.

## Rodar localmente

```bash
cd grid-site
python3 -m http.server 8080
# abrir http://localhost:8080
```

## Publicar no Grid

Subir `dist/nex-ssc2-presorting.html` diretamente (é um arquivo único, sem
dependências externas) usando a skill `grid-sharing:grid`, por exemplo:

> "Subí `dist/nex-ssc2-presorting.html` ao Grid e compartilhá com minha equipe"

Atualizações seguintes: reenviar o mesmo arquivo sobre o `doc_id` existente
(a skill pergunta e faz o versionamento; arquivos simples como HTML têm
backup automático no servidor, ao contrário de bundles ZIP).

## Fase atual: pré-triagem / sorting (mesma tela cobre as duas)

O arquivo de separação real (export do `Q_SEPARACAO`, BigQuery → planilha
"SSC2 BASE 2026") é consultado duas vezes: uma vez cedo (sem `ROTASACA`
ainda) e de novo ~1h depois do início da triagem (já com `ROTASACAPL`
preenchido). O importador foi desenhado para as duas situações:

1. **Importar** — sobe o CSV, autodetecta as colunas reais (`ROTAPL`,
   `ROTAOT`, `ROTA`, `ROTACOMPLETA`, `ROTASACA`, `ROTASACAPL`, `VEICULO`,
   `EMPRESA`, `AGENCIA`, `SERVICO`) e deixa ajustar manualmente. Filtra por
   `SERVICO` (por padrão só entra o que contém "NEX" — `NEXMAE`/`NEXSACA` —
   ficando de fora `XPT`/`NORMAL`, que não passam pelo fluxo Nex).
   - Se o arquivo ainda **não** tem `ROTASACA` preenchido para uma rota, ela
     entra só com a quantidade esperada (se houver coluna de quantidade) e o
     operador atribui as sacas manualmente na tela seguinte.
   - Se o arquivo **já** tem `ROTASACA`/`ROTASACAPL` (dado real, pós-scan),
     essas linhas substituem qualquer atribuição manual anterior daquela
     rota — reimportar não apaga o trabalho de rotas que ainda não têm dado
     real.
2. **Asignar sacas** — o operador confirma/ajusta as sacas por rota (1 a 6+
   sacas físicas, pode variar por exceção).
3. **QR de estação** — gera e imprime uma etiqueta com QR por saca, usando o
   código físico real (`ROTASACAPL`) quando disponível.

**Híbrida:** por ora é uma *sugestão* editável — marca automaticamente como
híbrida toda rota cujas sacas aparecem com mais de um `VEICULO` ou `EMPRESA`
distinto (ex.: `AM1_5` com sacas em "Extra 4h" e "Extra 6h"). O operador pode
corrigir manualmente com o checkbox "Híbrida" em cada rota. **Regra ainda
não confirmada** — pendente de material adicional do usuário.

Formato do payload do QR (provisório, até integrar com o formato real de
leitura do Nex):

```
NEX-SSC2|ROTA:<chave_da_rota>|SACA:<código_físico_ou_label>|LOTE:<lote_ou_turno>|HIB:<0|1>
```

## Próximas fases (placeholders no app)

- **Post-sorting** — auditoria/conferência da saca antes do despacho.

## Nota sobre conectividade

Este ambiente de execução (sandbox remoto) não tem acesso de saída para
`grid.melioffice.com` nem para `docs.google.com` (bloqueados no proxy de
rede). O código foi desenhado a partir de capturas de tela e amostras de
dados reais compartilhadas na conversa, mas ainda não foi testado com uma
chamada real à API do Grid nem com o CSV completo de produção — isso precisa
ser validado a partir de um ambiente com acesso à VPN corporativa da MELI.
