/*
  ============================================================
   LISTA DE VÍDEOS DO CANTINHO KIDS
   Este é o ÚNICO arquivo que você precisa mexer no dia a dia.
  ============================================================

  COMO ADICIONAR UM VÍDEO DO YOUTUBE
    1. No YouTube, abra o vídeo e copie o link (botão Compartilhar).
    2. Escolha a prateleira onde ele vai morar (mais abaixo).
    3. Copie uma linha de vídeo que já existe, cole logo abaixo dela
       e troque o título e o link. Exemplo:

         { titulo: "Nome que as crianças vão ver", link: "https://youtu.be/XXXXXXXXXXX" },

    Cuidados:
      • Título e link ficam sempre entre aspas "assim".
      • Toda linha de vídeo termina com vírgula.
      • Serve qualquer formato de link do YouTube (youtube.com/watch?v=...,
        youtu.be/..., youtube.com/shorts/...).

  COMO ADICIONAR UM DESENHO DO DISNEY+ OU DO PRIME VIDEO
    Esses serviços não deixam o vídeo tocar dentro de outro app.
    Então o card aparece aqui, e ao clicar a TV mostra um aviso
    "chame o papai ou a mamãe para abrir no Disney+".

         { titulo: "Bluey", servico: "Disney+" },
         { titulo: "Pocoyo", servico: "Prime Video" },

  COMO CRIAR UMA PRATELEIRA NOVA
    Copie um bloco inteiro de prateleira (de "{ nome:" até o "]}," que
    fecha ele) e cole embaixo. Cores que existem:
      laranja, rosa, verde, azul, roxo, amarelo
    Ícones que existem:
      livro, musica, estrela, coracao, sol, tv
*/

var CANTINHO = {
  nome: "Cantinho Kids",
  saudacao: "Oi, turminha!",
  pergunta: "O que vamos assistir hoje?",

  prateleiras: [
    {
      nome: "Meus vídeos",
      cor: "laranja",
      icone: "estrela",
      videos: [
        // Cole seus vídeos aqui, um por linha. Exemplo (tire as duas barras da frente):
        // { titulo: "Nome do vídeo", link: "https://youtu.be/XXXXXXXXXXX" },
      ],
    },
  ],
};
