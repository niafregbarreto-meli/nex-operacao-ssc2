# Nex — Operação SSC2 (Biguaçu)

App estática (pré-triagem) para o fluxo Nex: importar o arquivo de separação,
associar sacas físicas a cada rota e imprimir os QR Codes de estação.

## Estrutura

```
grid-site/            ← bundle a ser publicado no Grid (index.html precisa estar na raiz do zip)
  index.html
  assets/
    app.js            ← lógica da aplicação (import, atribuição, QR)
    app.css
    grid-shim.js       ← camada de persistência: window.GRID.state em Grid, localStorage fora dele
    qrcode.js          ← gerador de QR vendorizado (qrcode-generator, MIT, Kazuhiko Arase)
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

O Grid exige `index.html` na raiz do zip (não em subpasta):

```bash
cd grid-site
zip -r ../nex-ssc2-presorting.zip .
```

Depois subir com a skill `grid-sharing:grid` (ou engine direto), por exemplo:

> "Subí `nex-ssc2-presorting.zip` ao Grid como site bundle e compartilhá com minha equipe"

Cada atualização de código deve ser reenviada com `file_new_version: true` (ou
substituindo o zip do doc existente) — bundles ZIP não têm backup automático
no servidor, então convém baixar a versão atual antes de sobrescrever.

## Fase atual: pré-triagem (pré-sorting)

1. **Importar** — sobe o CSV do arquivo de separação, mapeia colunas (rota,
   quantidade de sacas, híbrida) e importa as rotas.
2. **Asignar sacas** — para cada rota (1 a 6+ sacas físicas, pode variar por
   exceção), o operador define quais sacas realmente serão usadas na estação.
3. **QR de estação** — gera e imprime uma etiqueta com QR por saca atribuída.

Formato do payload do QR (provisório, até integrar com a query real do Nex):

```
NEX-SSC2|ROTA:<id_da_rota>|SACA:<label>|LOTE:<lote_ou_turno>|HIB:<0|1>
```

## Próximas fases (placeholders no app)

- **Sorting** — query que, ~1h após o início da triagem, capta em qual
  rota/estação cada saca física ficou e permite imprimir o QR final da saca.
- **Post-sorting** — auditoria/conferência da saca antes do despacho.

## Nota sobre conectividade com Grid

Este ambiente de execução (sandbox remoto) não tem acesso de saída para
`grid.melioffice.com` (bloqueado no proxy de rede). O código foi desenhado
contra o contrato documentado da skill `grid-sharing` (`window.GRID.state`,
upload de `.zip` como site bundle), mas ainda não foi testado com uma chamada
real à API do Grid — isso precisa ser validado a partir de um ambiente com
acesso à VPN corporativa da MELI.
