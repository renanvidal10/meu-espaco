'use strict';
const path=require('path');const {execSync}=require('child_process');
const {arquivoDeDadosTemporario}=require('/home/user/meu-espaco/server/test/temporario.js');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(execSync('npm root -g').toString().trim(),'playwright'));}
let falhas=0;const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m);if(!c)falhas++;};
(async()=>{
  const {criarStub}=require('/home/user/meu-espaco/server/test/stub-anthropic.js');
  const stub=criarStub();const ps=await stub.ouvir(0);
  const porta=7900+Math.floor(Math.random()*90);const BASE=`http://127.0.0.1:${porta}`;
  const srv=require('child_process').spawn(process.execPath,['/home/user/meu-espaco/server/index.js'],{env:{...process.env,PORT:String(porta),NODE_ENV:'test',DATA_FILE:arquivoDeDadosTemporario('pwa'),ANTHROPIC_API_KEY:'x',ANTHROPIC_BASE_URL:`http://127.0.0.1:${ps}`,DATABASE_URL:'',RESEND_API_KEY:'',APP_ORIGIN:''},stdio:['ignore','ignore','ignore']});
  for(let i=0;i<120;i++){try{if((await fetch(BASE+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}

  console.log('\n=== ARQUIVOS DO APLICATIVO ===');
  for(const caminho of ['/manifest.webmanifest','/sw.js','/icone.svg','/icone-180.png','/icone-192.png','/icone-512.png','/icone-512-mascara.png']){
    const r=await fetch(BASE+caminho);
    ok(r.ok,`${caminho} → ${r.status} ${r.headers.get('content-type')||''}`);
  }
  const man=await (await fetch(BASE+'/manifest.webmanifest')).json();
  ok(man.display==='standalone','abre sem barra de endereço (display standalone)');
  ok(man.icons.some(i=>i.purpose==='maskable'),'tem ícone maskable para o Android');
  ok(!!man.id && !!man.start_url,'tem id e start_url');

  console.log('\n=== NO NAVEGADOR ===');
  const browser=await pw.chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await browser.newContext({viewport:{width:390,height:780}});
  const p=await ctx.newPage();
  const erros=[];p.on('pageerror',e=>erros.push(e.message));
  await p.goto(BASE);await p.waitForTimeout(1500);
  const reg=await p.evaluate(async()=>{
    if(!('serviceWorker' in navigator))return 'sem suporte';
    const r=await navigator.serviceWorker.getRegistration();
    return r? (r.active?'ativo':'registrado') : 'nenhum';
  });
  ok(reg==='ativo'||reg==='registrado',`service worker: ${reg}`);
  ok(erros.length===0,`erros de página: ${erros.join(' | ')||'nenhum'}`);

  // O cache não pode guardar nada de /api/ — é a promessa de privacidade.
  const guardou=await p.evaluate(async()=>{
    const chaves=await caches.keys();
    for(const k of chaves){
      const c=await caches.open(k);
      const reqs=await c.keys();
      const api=reqs.filter(r=>new URL(r.url).pathname.startsWith('/api/'));
      if(api.length) return api.map(r=>r.url);
    }
    return [];
  });
  ok(guardou.length===0,`nada de /api/ no cache (achado: ${JSON.stringify(guardou)})`);

  await browser.close();srv.kill('SIGTERM');stub.fechar&&stub.fechar();
  console.log('\n'+'='.repeat(56));
  console.log(falhas?`FALHAS: ${falhas}`:'Instalação como aplicativo: tudo verificado.');
  process.exit(falhas?1:0);
})();
