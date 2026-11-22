const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(__dirname,'../qa/browsers');
const {webkit}=require('playwright'),{marketFixture,perpetualFixture}=require('./market-fixture.cjs'),{scanQrPng}=require('./receive-qr-test.cjs');
const ID='1'.repeat(32),ADDRESS='0x1111111111111111111111111111111111111111',OTHER='0x2222222222222222222222222222222222222222',KEY='trust-concept-local-v1';
const dist=path.resolve(__dirname,'../dist'),out=path.resolve(__dirname,'../qa/walletconnect'),sizes=[{width:320,height:568},{width:375,height:812},{width:393,height:852},{width:430,height:932},{width:844,height:390}];
const sdk=fs.readdirSync(path.join(dist,'assets')).find(file=>file.endsWith('.js')&&fs.readFileSync(path.join(dist,'assets',file),'utf8').includes('SIGN_CLIENT_CONTEXT'));
const session=(methods=[])=>({topic:'a'.repeat(64),expiry:Math.floor(Date.now()/1000)+3600,peer:{metadata:{name:'Wallet de test'}},namespaces:{eip155:{accounts:[`eip155:1:${ADDRESS}`],chains:['eip155:1'],methods,events:['accountsChanged','chainChanged']}}});
async function main(){
 assert(sdk,'WalletConnect must be loaded from a separate production chunk');fs.mkdirSync(out,{recursive:true});
 const browser=await webkit.launch({headless:true});let page;
 try{
  const errors=[],external=[];let sdkLoads=0;
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:2,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addInitScript(()=>{
   window.__wc={initializers:[],proposals:[],instances:[],mode:'waiting',ttl:300};
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.__copied=value}});
   window.__mockWalletConnect=async options=>{
    const mock=window.__wc;mock.initializers.push(options);
    if(mock.mode==='offline')throw Error('relay unavailable');
    const handlers={},instance={handlers,sessions:[],pairings:[],disconnects:[],closed:0,stopped:0,rpc:0};mock.instances.push(instance);mock.latest=instance;
    const client={on:(name,handler)=>handlers[name]=handler,off:name=>delete handlers[name],session:{getAll:()=>instance.sessions},core:{heartbeat:{stop:()=>instance.stopped++},relayer:{transportClose:async()=>instance.closed++},pairing:{getPairings:()=>instance.pairings,disconnect:async()=>instance.pairings=[]}},disconnect:async({topic})=>{instance.disconnects.push(topic);instance.sessions=instance.sessions.filter(item=>item.topic!==topic)},request:()=>{instance.rpc++;throw Error('Wallet RPC must never be called')},connect:async proposal=>{
     mock.proposals.push(proposal);const topic=mock.instances.length.toString(16).padStart(64,'b');instance.pairings=[{topic}];instance.uri=`wc:${topic}@2?relay-protocol=irn&symKey=${'c'.repeat(64)}&expiryTimestamp=${Math.floor(Date.now()/1000)+mock.ttl}`;
     return {uri:instance.uri,approval:()=>new Promise((resolve,reject)=>{instance.approve=value=>{instance.sessions.push(value);resolve(value)};instance.reject=reject})};
    }};
    if(mock.mode==='slow')await new Promise(resolve=>mock.resolveInit=resolve);
    return client;
   };
  });
  await context.route('https://connection.test/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/api/market')return route.fulfill({json:marketFixture(url.href)});if(url.pathname==='/api/perpetuals')return route.fulfill({json:perpetualFixture()});
   if(url.pathname===`/assets/${sdk}`){sdkLoads++;return route.fulfill({contentType:'application/javascript',body:'export default {init: options => window.__mockWalletConnect(options)};'})}
   let file=path.join(dist,decodeURIComponent(url.pathname));if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');return route.fulfill({path:file,contentType:({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});
  });
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('https://connection.test')&&!request.url().startsWith('data:'))external.push(request.url())});
  const click=name=>page.getByRole('button',{name,exact:true}).click(),unlock=async()=>{for(const digit of '787878')await click(digit)},read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  async function generate(){await click('Afficher le QR WalletConnect');await page.getByTestId('walletconnect-qr').waitFor();await page.getByTestId('walletconnect-qr').evaluate(element=>element.decode())}
  async function approve(value=session()){await page.evaluate(value=>window.__wc.latest.approve(value),value)}
  await page.goto('https://connection.test');await unlock();await click('Recevoir');const receiveAddress=await page.locator('.receive-address').innerText();await click('Connecter mon portefeuille');assert.equal(sdkLoads,0);assert.equal(await page.getByTestId('walletconnect-qr').count(),0);assert(await page.getByRole('heading',{name:'Connecter mon portefeuille',exact:true}).isVisible());assert(await page.getByText('Prototype indépendant · Lecture seule',{exact:true}).isVisible());
  assert.equal(await page.locator('#connection-project').count(),0);assert(await page.getByRole('button',{name:'Afficher le QR WalletConnect',exact:true}).isEnabled());await generate();assert.equal(await page.evaluate(()=>window.__wc.initializers[0].projectId),require('../src/concept/walletconnect-config.json').projectId);await click('Annuler la connexion');await click('Configurer WalletConnect');assert.equal(await page.locator('#connection-project').inputValue(),require('../src/concept/walletconnect-config.json').projectId);
  await page.locator('#connection-project').fill('invalid');await click('Enregistrer la configuration');await page.getByRole('alert').waitFor();assert.equal(sdkLoads,1);await page.locator('#connection-project').fill(ID);await click('Enregistrer la configuration');
  const walletBefore=(await read()).wallets,historyBefore=(await read()).history;
  await generate();assert.equal(sdkLoads,1);let uri=await page.evaluate(()=>window.__wc.latest.uri);assert.equal(scanQrPng(await page.locator('.connection-code').screenshot()),uri);
  const proposal=await page.evaluate(()=>window.__wc.proposals[0]);assert.deepEqual(proposal,{requiredNamespaces:{eip155:{chains:['eip155:1'],methods:[],events:['accountsChanged','chainChanged']}},optionalNamespaces:{}});
  const meta=await page.evaluate(()=>window.__wc.initializers[0].metadata);assert.equal(meta.url,'https://connection.test');assert.equal(meta.name,'Trust Send — lecture seule');assert.deepEqual(meta.icons,['https://connection.test/connection-icon.svg']);
  for(const size of sizes){await page.setViewportSize(size);await page.locator('.connection-code').scrollIntoViewIfNeeded();assert.equal(scanQrPng(await page.locator('.connection-code').screenshot()),uri);assert(await page.locator('.connection-content').evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Connection layout overflow at '+size.width)}
  await page.setViewportSize({width:393,height:852});await page.locator('.connection-content').evaluate(element=>element.scrollTop=0);await page.screenshot({path:path.join(out,'01-connection-qr.png')});await click('Copier le lien');assert.equal(await page.evaluate(()=>window.__copied),uri);
  await click('Nouveau QR');await page.waitForFunction(old=>window.__wc.latest.uri!==old,uri);await page.getByTestId('walletconnect-qr').evaluate(element=>element.decode());uri=await page.evaluate(()=>window.__wc.latest.uri);assert.equal(scanQrPng(await page.locator('.connection-code').screenshot()),uri);assert(await page.evaluate(()=>window.__wc.instances[0].closed>0));
  await approve();await page.getByText('Connecté en lecture seule',{exact:true}).waitFor();assert.equal(await page.getByTestId('walletconnect-qr').count(),0);await click(`Copier ${ADDRESS}`);assert.equal(await page.evaluate(()=>window.__copied),ADDRESS);assert.deepEqual((await read()).wallets,walletBefore);assert.deepEqual((await read()).history,historyBefore);assert(await page.evaluate(()=>window.__wc.instances.every(item=>item.rpc===0)));await page.screenshot({path:path.join(out,'02-connected-public-address.png')});
  await page.evaluate(address=>window.__wc.latest.handlers.session_event({topic:'a'.repeat(64),params:{chainId:'eip155:1',event:{name:'accountsChanged',data:[address]}}}),OTHER);await page.getByRole('button',{name:`Copier ${OTHER}`,exact:true}).waitFor();
  await click('Déconnecter mon portefeuille');assert.equal(await page.locator('.connection-address').count(),0);await page.waitForFunction(()=>window.__wc.latest.closed>0);
  // Refusal, extra permissions, remote disconnect, expiry, cancellation and late approval.
  await generate();await page.evaluate(()=>window.__wc.latest.reject({code:5000}));await page.getByText('Connexion refusée dans le portefeuille.',{exact:true}).waitFor();await click('Réessayer la connexion');await page.getByTestId('walletconnect-qr').waitFor();await approve(session(['personal_sign']));await page.getByText(/autorisations supplémentaires/).waitFor();assert.equal(await page.locator('.connection-address').count(),0);
  await click('Réessayer la connexion');await page.getByTestId('walletconnect-qr').waitFor();await approve();await page.getByText('Connecté en lecture seule',{exact:true}).waitFor();await page.evaluate(()=>window.__wc.latest.handlers.session_delete({topic:'a'.repeat(64)}));await page.getByText('Le portefeuille a fermé la connexion.',{exact:true}).waitFor();
  await page.evaluate(()=>window.__wc.ttl=1);await click('Réessayer la connexion');await page.getByTestId('walletconnect-qr').waitFor();await page.getByText('Ce QR a expiré. Générez un nouveau code.',{exact:true}).waitFor();assert.equal(await page.getByTestId('walletconnect-qr').count(),0);await page.evaluate(()=>window.__wc.ttl=300);
  await click('Réessayer la connexion');await page.getByTestId('walletconnect-qr').waitFor();await click('Annuler la connexion');await approve();await page.waitForFunction(()=>window.__wc.latest.disconnects.includes('a'.repeat(64)));assert.equal(await page.locator('.connection-address').count(),0);
  await page.evaluate(()=>window.__wc.mode='offline');await click('Afficher le QR WalletConnect');await page.getByText(/Connexion impossible/).waitFor();await page.evaluate(()=>window.__wc.mode='slow');await click('Réessayer la connexion');await page.waitForFunction(()=>Boolean(window.__wc.resolveInit));await click('Retour');await page.evaluate(()=>window.__wc.resolveInit());await page.waitForFunction(()=>window.__wc.latest.closed>0);assert.equal(await page.locator('.receive-address').innerText(),receiveAddress);
  await page.evaluate(()=>window.__wc.mode='waiting');await click('Connecter mon portefeuille');assert.equal(await page.getByTestId('walletconnect-qr').count(),0);assert(await page.getByRole('button',{name:'Afficher le QR WalletConnect',exact:true}).isEnabled());await click('Retour');
  // ETH/USDC/USDT expose the explicit Ethereum connection; other receipt networks keep their QR.
  for(const [symbol,available] of [['USDC',true],['USDT',true],['BTC',false],['SOL',false]]){await page.locator('.receive-network').click();await click(`Choisir ${symbol}`);assert.equal(await page.getByRole('button',{name:/^Connecter mon portefeuille/}).count(),available?1:0)}
  await click('Retour');await page.reload();await unlock();await click('Recevoir');await click('Connecter mon portefeuille');assert.equal(await page.locator('#connection-project').count(),0);assert.equal(await page.getByTestId('walletconnect-qr').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: distinct read-only screen; truthful origin/metadata; public project configuration; real QR decoding at five sizes; renew/copy; approval/refusal/expiry/cancel/late callbacks; no signatures, balance/history changes, address overwrite, hidden reconnect or external data collection. Relay SDK mocked; physical wallet approval requires a real Project ID.');
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
