'use strict';

/* Service worker do OncoGenYX.
 *
 * Existe por duas razões, nesta ordem:
 *  1. é o que faz o Android oferecer "instalar aplicativo" — sem ele, o
 *     navegador só oferece "adicionar atalho", que abre com barra de endereço
 *     e não parece um aplicativo;
 *  2. guarda a casca (ícones, manifesto) para o app abrir mesmo com a rede
 *     oscilando no consultório.
 *
 * O que ele NÃO faz, de propósito:
 *  - não guarda NADA de /api/. Caso clínico, resultado de triagem e nome de
 *    paciente nunca entram em cache. O app promete ao médico que o material
 *    não fica guardado, e um cache de resposta de API quebraria essa promessa
 *    em silêncio.
 *  - não serve a página a partir do cache quando há rede. A estratégia é
 *    rede-primeiro: um app clínico servido de uma versão velha é pior que um
 *    app lento, porque a regra desatualizada não se anuncia.
 */

const VERSAO = 'oncogenyx-v2';
const CASCA = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/tumors.js',
  '/manifest.webmanifest',
  '/icone.svg',
  '/icone-192.png',
  '/icone-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(CASCA))
      // Um item que falhe no cache não pode impedir a instalação inteira.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Dado clínico não passa por aqui.
  if (url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        if (resposta && resposta.ok && resposta.type === 'basic') {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(req, copia)).catch(() => undefined);
        }
        return resposta;
      })
      .catch(() => caches.match(req).then((guardada) => guardada || caches.match('/index.html'))),
  );
});
