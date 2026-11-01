# Quadrado Mágico

Quadro branco infinito no estilo Excalidraw, em HTML/CSS/JavaScript puro (sem build, **sem Firebase**). O login é feito com a sua conta Google (Google Identity Services) e tudo é salvo diretamente no **seu Google Drive**, no arquivo `Quadrado Mágico/quadrado-magico.json`.

## Recursos
- Tela infinita com pan (espaço + arrastar, botão do meio do mouse, dois dedos, ferramenta ✋, rolagem do trackpad) e zoom (roda do mouse, pinça no iPad/trackpad, botões − / + / ⟲).
- Ferramentas: selecionar/mover (V), caneta (P), retângulo (R), elipse (O), linha (L), seta (A), texto (T, duplo clique edita), borracha (E), mover tela (H).
- Cor do traço, preenchimento, espessura (aplicados também ao elemento selecionado).
- Desfazer/refazer (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z), excluir (Delete/Backspace), salvar (Ctrl/⌘+S).
- Funciona com mouse (MacBook) e toque/Apple Pencil (iPad).
- Salvamento automático no Drive 2 s após a última alteração + botão **Salvar agora**; status na tela: *Não conectado*, *Salvando…*, *Salvo*, *Erro*.
- Backup no `localStorage` do navegador (funciona mesmo sem login).
- O JSON guarda elementos, posições, estilos e viewport (posição e zoom).

## 1. Configurar o Google Cloud Console (uma vez)
1. Acesse https://console.cloud.google.com/ e entre com sua conta Google.
2. **Criar projeto**: no seletor de projetos (topo) → *Novo projeto* → nome "Quadrado Mágico" → *Criar*. Selecione o projeto.
3. **Ativar a API do Drive**: *APIs e serviços → Biblioteca* → procure **Google Drive API** → *Ativar*.
4. **Tela de consentimento OAuth** (*APIs e serviços → Tela de consentimento OAuth* / *Google Auth Platform*):
   - Tipo de usuário: **Externo** → *Criar*.
   - Preencha nome do app, e-mail de suporte e e-mail do desenvolvedor → salve.
   - Em *Escopos* (Acesso a dados), adicione `https://www.googleapis.com/auth/drive.file` (opcional, o app pede na hora do login).
5. **Adicionar usuário de teste**: em *Usuários de teste* (Público-alvo) → *Add users* → coloque o seu e-mail do Gmail. Enquanto o app estiver em modo "Teste", só esses e-mails conseguem entrar.
6. **Criar o Client ID**: *APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth*:
   - Tipo de aplicativo: **Aplicativo da Web**.
   - **Origens JavaScript autorizadas**: `http://localhost:8000`
   - (URIs de redirecionamento não são necessárias.) → *Criar*.
7. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).

> Não é preciso chave de API nem client secret. O escopo `drive.file` só dá acesso aos arquivos criados pelo próprio app — ele não lê o resto do seu Drive.

## 2. Colar o Client ID
Abra `app.js` e troque a primeira constante:
```js
const CLIENT_ID = 'SEU_ID.apps.googleusercontent.com';
```

## 3. Rodar
No terminal, dentro da pasta do projeto:
```bash
python3 -m http.server 8000
```
Abra **http://localhost:8000** no navegador e clique em **Entrar com Google**.

⚠️ **Não abra o `index.html` com duplo clique (`file://`)**: o login do Google só funciona a partir de uma origem http(s) cadastrada nas "Origens JavaScript autorizadas". Use `localhost:8000` exatamente (não `127.0.0.1`, a menos que também cadastre essa origem).

### Usar no iPad
`localhost` só existe no próprio computador. Para usar no iPad, hospede o app em HTTPS (GitHub Pages: https://drthaleschateaubriand.github.io/quadrado-magico/) e cadastre essa origem.

## 4. Hospedar no GitHub Pages
1. Envie estes arquivos para um repositório no GitHub.
2. *Settings → Pages → Build and deployment*: Source = *Deploy from a branch*, branch `main`, pasta `/ (root)` → *Save*.
3. O site oficial fica em **https://drthaleschateaubriand.github.io/quadrado-magico/** (repositório: https://github.com/drthaleschateaubriand/quadrado-magico).
4. No Google Cloud Console, edite o Client ID e adicione em **Origens JavaScript autorizadas**: `https://drthaleschateaubriand.github.io` (só a origem, sem `/quadrado-magico/` e sem barra no final). Mantenha também `http://localhost:8000` para testes locais.
5. Espere alguns minutos para a alteração propagar.

O Client ID não é segredo (ele aparece no navegador de qualquer forma), então pode ficar no repositório público. Nunca coloque client secret ou tokens no código.

## Como funciona o salvamento
- No login, o app procura (ou cria) a pasta **Quadrado Mágico** e o arquivo **quadrado-magico.json** e carrega o último estado. Se o backup local for mais recente (ex.: você editou sem login), ele é mantido e enviado ao Drive.
- Cada alteração agenda um salvamento 2 s depois da última mudança (debounce).
- Quando o token de acesso expira (~1 h), o app pede um novo automaticamente (pode aparecer um pop-up rápido do Google; permita pop-ups para o site).

## Imagem do quadro no Drive
A cada salvamento o app também gera **`quadrado-magico.png`** (o quadro inteiro, fundo branco, com margem) na pasta *Quadrado Mágico* do Drive, para você ver o desenho direto no Drive.

## Enviar arquivos (PDF, Word, imagens, qualquer tipo)
- Clique em **📎 Arquivo** (pode escolher vários), **arraste** arquivos para o quadro ou **cole** (Ctrl/⌘+V).
- Cada arquivo é enviado para **Quadrado Mágico/Arquivos** no seu Drive (upload resumível, serve para arquivos grandes); o progresso aparece na barra de status.
- Imagens aparecem no quadro como imagem de verdade (mova com 🖱️ e redimensione pelo quadradinho no canto inferior direito). Outros arquivos aparecem como um cartão com ícone, nome e tamanho.
- **Duplo clique** (ou duplo toque no iPad, com a ferramenta 🖱️) abre o arquivo no Google Drive em nova aba.
- Apagar o elemento do quadro **não apaga** o arquivo do Drive.
- É preciso estar conectado ao Google para enviar arquivos.

## Continuar conectado
O token de acesso (válido ~1 h) e o e-mail ficam guardados no `localStorage` (chave `quadrado-magico-token`). Ao recarregar a página o app reconecta e carrega o Drive sozinho. Se o token expirou, ele tenta renovar em silêncio (com o seu e-mail como dica); se o navegador bloquear, aparece o botão **Entrar com Google**. **Sair** apaga o token salvo e revoga o acesso.

## Limitações
- Sem colaboração em tempo real; se o mesmo quadro estiver aberto em dois dispositivos, vence o último salvamento.
- Um único quadro por conta (um arquivo JSON).
- Renovar o token pode exigir interação se o navegador bloquear pop-ups.

## Selecionar, mover e navegar

- A ferramenta **Selecionar** (V) é a padrão ao abrir e depois de enviar arquivos.
- Arraste **sobre um elemento** (mouse, dedo ou Apple Pencil) para mover só ele; a seleção mostra alças nos cantos (imagens: alça de redimensionar). Ctrl+Z desfaz.
- Arraste **no espaço vazio** para mover a tela. Toque no vazio limpa a seleção.
- **Shift + arrastar** no vazio seleciona vários elementos; arraste um deles para mover o grupo.
- Toque em um cartão de arquivo seleciona; toque duplo (ou clique duplo) abre no Drive.
- Nas ferramentas de desenho, dois dedos continuam movendo e dando zoom.

## Arquivos abertos direto no quadro
Cada arquivo enviado aparece já aberto dentro do cartão no quadro: PDF (páginas com ◀ ▶, renderizado com PDF.js — funciona no iPad), imagem, vídeo, áudio, Word (.docx), Excel/CSV e textos. Arraste pelo título para mover, puxe o canto inferior direito para redimensionar, e use **⤢ Abrir** (ou clique duplo no título) para tela cheia. Só os cartões visíveis na tela são baixados. Se aparecer "Conecte o Google", clique em **Entrar com Google** uma vez.
