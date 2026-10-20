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
