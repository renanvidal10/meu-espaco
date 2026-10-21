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

### Fire TV Stick

1. Na tela inicial do Fire TV, vá na **lupa** (buscar) e digite **Silk**.
2. Instale o **Silk Browser** (é o navegador da própria Amazon, grátis).
3. Abra o Silk e, na barra de endereço, digite:
   `renanvidal10.github.io/meu-espaco`
4. Quando a página abrir, aperte o botão de **menu** do controle
   (o de três risquinhos) e escolha **Adicionar aos favoritos**.
5. Das próximas vezes: abra o Silk e escolha o Cantinho Kids nos favoritos.

Dica: no Silk, se a barra de endereço ficar aparecendo, aperte o menu e
escolha **Tela cheia** (ou o app pede tela cheia sozinho quando o vídeo começa).

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

## 4. Sobre Disney+ e Prime Video (importante)

Esses serviços protegem os vídeos com uma trava digital (chamada DRM) e
**não deixam nenhum outro app tocar o conteúdo deles**, nem mesmo um app
caseiro. Isso vale para qualquer pessoa, não é limitação deste projeto.

O que o Cantinho faz: se você colocar um desenho desses na lista (o jeito
está explicado no começo do `videos.js`), ele aparece com a cor do serviço
para as crianças saberem que ele existe e pedirem. Ao clicar, aparece
"Chame o papai ou a mamãe para abrir no Disney+".

Para esses serviços, o caminho seguro é usar o **perfil infantil** de cada um
(Disney+ e Prime Video têm perfil Kids com controle de classificação).

---

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
