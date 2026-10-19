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
  for(const caminho of ['/manifest.webmanifest','/sw.js','/app.css','/app.js','/icone.svg','/icone-180.png','/icone-192.png','/icone-512.png','/icone-512-mascara.png']){
    const r=await fetch(BASE+caminho);
    ok(r.ok,`${caminho} → ${r.status} ${r.headers.get('content-type')||''}`);
  }
  const man=await (await fetch(BASE+'/manifest.webmanifest')).json();
  ok(man.display==='standalone','abre sem barra de endereço (display standalone)');
  ok(man.icons.some(i=>i.purpose==='maskable'),'tem ícone maskable para o Android');
  ok(!!man.id && !!man.start_url,'tem id e start_url');

  /* §78. A cor da marca estava declarada em TRÊS lugares — o manifesto, a
   * marcação theme-color do HTML e os tokens do app.css — e dois deles
   * tinham ficado no verde da paleta antiga. O resultado: a plataforma teal
   * por dentro, e a barra do sistema no celular e a tela de abertura do app
   * instalado em verde. Ninguém abre o manifesto para conferir, então a
   * divergência vive para sempre.
   * O teste lê o app.css como fonte da verdade e exige que os outros dois
   * digam o mesmo. */
  console.log('\n=== A COR DA MARCA É UMA SÓ ===');
  const css=await (await fetch(BASE+'/app.css')).text();
  const token=(nome,onde)=>{
    const bloco=onde==='escuro'
      ? css.slice(css.indexOf('prefers-color-scheme: dark'))
      : css;
    const m=new RegExp('--'+nome+':\\s*(#[0-9a-fA-F]{3,8})').exec(bloco);
    return m?m[1].toLowerCase():null;
  };
  const acento=token('accent','claro');
  const fundoClaro=token('bg','claro');
  const fundoEscuro=token('bg','escuro');
  ok(!!acento && !!fundoClaro && !!fundoEscuro,`tokens lidos do app.css: accent=${acento} bg=${fundoClaro} bg-escuro=${fundoEscuro}`);
  ok(String(man.theme_color).toLowerCase()===acento,`manifesto theme_color=${man.theme_color}, e o acento do app é ${acento}`);
  ok(String(man.background_color).toLowerCase()===fundoClaro,`manifesto background_color=${man.background_color}, e o fundo do app é ${fundoClaro}`);
  const html=await (await fetch(BASE+'/')).text();
  const corDe=(esquema)=>{
    const re=new RegExp('<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})" media="\\(prefers-color-scheme: '+esquema+'\\)"');
    const m=re.exec(html);return m?m[1].toLowerCase():null;
  };
  ok(corDe('light')===acento,`theme-color claro=${corDe('light')}, e o acento do app é ${acento}`);
  ok(corDe('dark')===fundoEscuro,`theme-color escuro=${corDe('dark')}, e o fundo escuro do app é ${fundoEscuro}`);

  /* §78. Pré-visualização do link: é a primeira coisa que o médico vê quando
   * recebe o endereço por mensagem, e vinha em branco. As marcações exigem
   * URL ABSOLUTA — caminho relativo o WhatsApp não resolve —, e o endereço é
   * escrito pelo servidor, não à mão, para não quebrar quando o domínio
   * próprio entrar no ar. */
  console.log('\n=== PRÉ-VISUALIZAÇÃO DO LINK ===');
  ok(!html.includes('__ORIGEM__'),'o marcador de endereço foi substituído pelo servidor');
  const marcacao=(prop)=>{
    const m=new RegExp('<meta property="'+prop+'" content="([^"]*)"').exec(html);
    return m?m[1]:null;
  };
  const ogUrl=marcacao('og:url');const ogImg=marcacao('og:image');
  ok(/^https?:\/\/[^/]+\/$/.test(String(ogUrl)),`og:url absoluto: ${ogUrl}`);
  ok(/^https?:\/\/[^/]+\/compartilhar\.png$/.test(String(ogImg)),`og:image absoluto: ${ogImg}`);
  ok(!!marcacao('og:title') && !!marcacao('og:description'),'tem título e descrição próprios no cartão');
  ok(/twitter:card" content="summary_large_image/.test(html),'o cartão usa a imagem grande, não a miniatura');
  const img=await fetch(BASE+'/compartilhar.png');
  ok(img.ok && (img.headers.get('content-type')||'').includes('image/png'),`a imagem do cartão existe → ${img.status} ${img.headers.get('content-type')||''}`);
  ok(Number(img.headers.get('content-length')||0)>10000,'e não é um arquivo vazio');
  ok(marcacao('og:image:width')==='1200' && marcacao('og:image:height')==='630','as medidas declaradas são as do formato de cartão grande');

  const robots=await fetch(BASE+'/robots.txt');
  const textoRobots=await robots.text();
  ok(robots.ok,`robots.txt → ${robots.status}`);
  ok(/Disallow:\s*\/api\//.test(textoRobots),'robots.txt mantém a API fora do alcance de rastreador');
  ok(!/Disallow:\s*\/\s*$/m.test(textoRobots),'e não bloqueia o site inteiro, o que apagaria a pré-visualização do link');

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
