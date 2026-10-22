# Cantinho Kids

O "YouTube da família": uma tela só com os vídeos que você escolheu, feita
para usar com o controle da TV. Sem anúncios de outros vídeos, sem sugestões
estranhas no fim (quando o vídeo acaba, volta sozinho para a tela inicial).

Endereço do app (depois de publicado):
**https://renanvidal10.github.io/meu-espaco/**

---

## 1. Publicar o app na internet (uma vez só)

1. No computador ou no celular, entre em
   **https://github.com/renanvidal10/meu-espaco/settings/pages**
2. Em **Build and deployment**, no campo **Source**, escolha
   **GitHub Actions**. Não precisa clicar em mais nada.
3. Pronto. Toda vez que a pasta `cantinho-kids` mudar, o site se atualiza
   sozinho em mais ou menos 1 minuto.
4. Para conferir: abra **https://github.com/renanvidal10/meu-espaco/actions**.
   O item "Publicar Cantinho Kids" com bolinha verde quer dizer que deu certo.

---

## 2. Colocar na TV

### Fire TV Stick (aplicativo completo, abre Prime e Disney+ direto)

No Fire TV o Cantinho é um aplicativo de verdade. Instalação, uma vez só:

**Parte A: liberar a instalação**
1. No controle, vá em **Configurações** (engrenagem) > **Minha Fire TV**.
2. Se não aparecer **Opções do desenvolvedor**: entre em **Sobre**, fique
   em cima do nome do aparelho e aperte **OK 7 vezes**, até aparecer
   "Você agora é um desenvolvedor". Volte uma tela.
3. Entre em **Opções do desenvolvedor**.

**Parte B: instalar o Downloader**
4. Volte para a tela inicial, vá na **lupa** e procure **Downloader**
   (ícone laranja). Instale.
5. Volte em **Configurações** > **Minha Fire TV** > **Opções do
   desenvolvedor** > **Instalar apps desconhecidos** e ative o **Downloader**.
   (Em aparelhos mais antigos a opção se chama **Apps de fontes
   desconhecidas**: é só ligar.)

**Parte C: instalar o Cantinho**
6. Abra o **Downloader**. Se pedir permissão, aperte **Permitir**.
7. Na caixa de endereço, digite exatamente:

   `https://raw.githubusercontent.com/renanvidal10/meu-espaco/cantinho-kids/cantinho-kids/cantinho.apk`

8. Aperte **Go**. Quando terminar de baixar, aperte **Instalar** e depois
   **Concluído** (o Downloader pergunta se quer apagar o arquivo: pode apagar).
9. O Cantinho Kids aparece em **Seus apps e canais** (os quadradinhos da
   tela inicial). Dica: fique em cima dele, aperte o botão de **menu**
   (três risquinhos) e escolha **Mover** para deixar na primeira fileira.

A lista de vídeos é baixada do GitHub toda vez que o app abre: mexeu no
`videos.js`, é só fechar e abrir o Cantinho de novo. Não precisa reinstalar.


### TV Samsung

1. Na tela inicial da TV, abra o aplicativo **Internet** (ícone de globo azul).
2. Na barra de endereço digite `renanvidal10.github.io/meu-espaco`.
3. Com a página aberta, aperte o botão de **estrela** no topo (ou o menu do
   navegador) e escolha **Adicionar aos favoritos**.
4. Em algumas TVs Samsung aparece também a opção **Adicionar à página
   inicial** (Add to Home). Se aparecer, use: o Cantinho vira um atalho
   na fileira de aplicativos, igual aos outros.

### Como as crianças usam

* **Setas** do controle: andam entre os vídeos.
* **OK** (botão do meio): começa o vídeo.
* **Voltar**: sai do vídeo e volta para a escolha.

---

## 3. Adicionar ou trocar vídeos (do celular mesmo)

1. No YouTube, abra o vídeo, toque em **Compartilhar** e em **Copiar link**.
2. Entre em
   **https://github.com/renanvidal10/meu-espaco/edit/main/cantinho-kids/videos.js**
   (precisa estar logado no GitHub).
3. Ache a prateleira certa. Copie uma linha de vídeo que já existe, cole
   embaixo dela e troque o título e o link. Fica assim:

   ```
   { titulo: "Davi e Golias", link: "https://youtu.be/XXXXXXXXXXX" },
   ```

4. Role até o fim e toque no botão verde **Commit changes** (pode ser que
   apareça uma janelinha, toque de novo em **Commit changes**).
5. Espere 1 minuto e recarregue o app na TV.

**Se aparecer na TV "Tem um errinho na lista de vídeos":** a própria tela diz
a linha do problema. Quase sempre é uma aspa ou uma vírgula que faltou na
última linha que você mexeu.

**Para remover um vídeo:** apague a linha inteira dele e salve do mesmo jeito.

---

## 4. Prime Video, Disney+ e Netflix

No **Fire TV**, ao clicar no filme, o Cantinho abre ele direto dentro do
app do streaming, que já está logado na TV (o Cantinho nunca vê senha).
A capa oficial aparece sozinha.

Esses serviços não deixam o filme tocar *dentro* do Cantinho (é uma trava
deles chamada DRM), por isso quem toca é o app oficial. Para voltar ao
Cantinho depois, aperte **Voltar** algumas vezes ou abra o Cantinho de novo.

Na **TV Samsung** (pelo navegador) isso não funciona: um site não tem
permissão para abrir outro aplicativo. Lá, o card avisa que o filme abre
pelo Fire TV.

**Modo teste:** no começo do `videos.js` existe a linha `modoTeste: true`.
Com ela ligada, a TV mostra um aviso pequeno dizendo como abriu cada
streaming ("Prime Video: jeito 1 de 13"). Depois que tudo estiver certo,
troque para `modoTeste: false`.

## 5. Se um vídeo do YouTube não tocar

Alguns donos de canal bloqueiam o vídeo fora do site do YouTube. Nesse caso
o app mostra "Esse vídeo não quis tocar aqui". A solução é trocar por outro
vídeo do mesmo desenho (muitas vezes o mesmo episódio existe em outro canal
oficial).

---

## Arquivos desta pasta

| Arquivo | Para que serve | Precisa mexer? |
|---|---|---|
| `videos.js` | Lista de prateleiras e vídeos | **Sim, é aqui** |
| `index.html` | Estrutura da página | Não |
| `estilo.css` | Cores, tamanhos, visual | Não |
| `app.js` | Funcionamento (controle, player) | Não |
| `icone.svg`, `manifest.webmanifest` | Ícone do app | Não |
| `cantinho.apk` | Aplicativo pronto para o Fire TV | Não |
| `firetv/` | Código do aplicativo do Fire TV | Não |
