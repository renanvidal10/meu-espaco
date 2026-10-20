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

// LGPD art. 41, §1º: o contato para assuntos de dados pessoais precisa estar
// público. Decisão do dono (20/10/2026, §85.4): só dentro do Aviso de
// Privacidade, discreto, sem nome nem cargo, e nunca solto na tela de entrada
// ou em Minha conta.
test('o contato de privacidade fica só no Aviso de Privacidade', () => {
  const aviso = HTML.slice(HTML.indexOf('id="privacidade"'), HTML.indexOf('id="instalar"'));
  const entrada = HTML.slice(HTML.indexOf('id="gate"'), HTML.indexOf('class="topbar"'));
  const conta = HTML.slice(HTML.indexOf('id="conta"'), HTML.indexOf('id="conferencia"'));
  assert.match(aviso, /href="mailto:renan\.lvidal@gmail\.com"/, 'o Aviso de Privacidade perdeu o contato');
  for (const [onde, trecho] of [['entrada', entrada], ['Minha conta', conta]]) {
    assert.doesNotMatch(trecho, /renan\.lvidal@gmail\.com|encarregado/i, `${onde}: o contato pessoal voltou a aparecer solto na tela`);
  }
  assert.doesNotMatch(aviso, /Renan Vidal|encarregado/i, 'nome ou cargo na tela, contra a decisão do dono');
});
