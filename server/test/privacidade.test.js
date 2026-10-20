'use strict';

// O que a tela promete sobre dado de saúde precisa ser verdade. O ditado usa o
// reconhecimento de voz do navegador, que no Chrome envia o áudio ao Google e
// no Edge à Microsoft. A tela dizia que "o áudio nunca sai do seu navegador",
// o que era falso (achado do plano de conformidade LGPD, outubro de 2026).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('a tela não promete que o áudio do ditado fica no aparelho', () => {
  assert.doesNotMatch(HTML, /áudio nunca sai|nunca sai do seu navegador/i);
});

test('a tela avisa que o áudio é transcrito nos servidores do fabricante', () => {
  assert.match(HTML, /transcrevem o áudio nos servidores do Google e da Microsoft/);
});

// LGPD art. 41, §1º: identidade e contato do encarregado divulgados de forma
// clara, de preferência no site. Decisão do dono (20/10/2026): o encarregado é
// o próprio Renan Vidal. Precisa estar visível antes do login (rodapé da
// entrada) e dentro de "Minha conta".
test('o contato do encarregado aparece na entrada e em Minha conta', () => {
  const entrada = HTML.slice(HTML.indexOf('id="gate"'), HTML.indexOf('class="topbar"'));
  const conta = HTML.slice(HTML.indexOf('id="conta"'), HTML.indexOf('id="conferencia"'));
  for (const [onde, trecho] of [['entrada', entrada], ['Minha conta', conta]]) {
    assert.match(trecho, /Renan Vidal, encarregado/, `${onde}: falta o nome do encarregado`);
    assert.match(trecho, /href="mailto:renan\.lvidal@gmail\.com"/, `${onde}: falta o e-mail do encarregado`);
  }
});
