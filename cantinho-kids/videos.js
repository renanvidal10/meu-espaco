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
      nome: "Histórias da Bíblia",
      cor: "laranja",
      icone: "livro",
      videos: [
        { titulo: "A Arca de Noé", link: "https://www.youtube.com/watch?v=6McGweruDpk" },
        { titulo: "Superbook: Raabe", link: "https://www.youtube.com/watch?v=08LMi4iXwrM" },
        { titulo: "Superbook: Rugido!", link: "https://www.youtube.com/watch?v=2ajdL6rxQUg" },
        { titulo: "Superbook: A Torre de Babel", link: "https://www.youtube.com/watch?v=5yAy-pfrqmM" },
        { titulo: "Superbook: O Nascimento de João Batista", link: "https://www.youtube.com/watch?v=41WMuAd-Eaw" },
      ],
    },

    {
      nome: "Louvor para cantar junto",
      cor: "rosa",
      icone: "musica",
      videos: [
        { titulo: "Deus Grandão", link: "https://www.youtube.com/watch?v=AHqqzUkjRjw" },
        { titulo: "Toc Toc Toc", link: "https://www.youtube.com/watch?v=80NHdIPpj-8" },
        { titulo: "Estátua de Sal", link: "https://www.youtube.com/watch?v=I87yflE0YcM" },
        { titulo: "Eu Li na Bíblia", link: "https://www.youtube.com/watch?v=07ukIP3VmUM" },
        { titulo: "Arca de Noé (Aline Barros)", link: "https://www.youtube.com/watch?v=2zAgltMW6uA" },
      ],
    },

    {
      nome: "Cantar e brincar",
      cor: "verde",
      icone: "sol",
      videos: [
        { titulo: "Pintinho Amarelinho", link: "https://www.youtube.com/watch?v=59GM_xjPhco" },
        { titulo: "Galinha Pintadinha", link: "https://www.youtube.com/watch?v=1i7p0vTGcBk" },
      ],
    },

    {
      nome: "No Disney+ e no Prime",
      cor: "azul",
      icone: "tv",
      videos: [
        { titulo: "Bluey", servico: "Disney+" },
        { titulo: "Toy Story", servico: "Disney+" },
        { titulo: "Pocoyo", servico: "Prime Video" },
      ],
    },
  ],
};
