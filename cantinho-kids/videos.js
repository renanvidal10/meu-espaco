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

  COMO ADICIONAR UM FILME DO PRIME VIDEO, DISNEY+ OU NETFLIX
    É igual ao YouTube: no app do streaming (pode ser no celular), abra o
    filme, toque em Compartilhar, copie o link e cole numa linha nova:

         { titulo: "Ratatouille", link: "https://disneyplus.com/pt-BR/browse/entity-..." },

    No Fire TV, ao clicar, o Cantinho abre o filme direto no app do
    streaming (que já está logado na TV). A capa aparece sozinha.

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

  // Enquanto estamos testando, a TV mostra um aviso pequeno dizendo como
  // abriu cada streaming. Depois dos testes, troque true por false.
  modoTeste: true,

  prateleiras: [
    {
      nome: "Meus vídeos",
      cor: "laranja",
      icone: "estrela",
      videos: [
        { titulo: "Detetive Labrador: Cuidando dos Bichinhos", link: "https://youtu.be/NXX9IBmeZ-g" },
        { titulo: "O Grinch", link: "https://app.primevideo.com/detail?gti=amzn1.dv.gti.bcb3c57a-7581-7d30-af92-0db26d4103cd&territory=BR" },
        { titulo: "Ratatouille", link: "https://disneyplus.com/pt-BR/browse/entity-ab7c4e29-04f1-46dd-931a-d43be1ce0f8c" },
      ],
    },
  ],
};
