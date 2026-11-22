// Opt-in live check: local production files, real SDK/relay, no wallet approval or signing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {safeJsonParse}=require('@walletconnect/safe-json');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(__dirname,'../qa/browsers');
const {webkit}=require('playwright'),{marketFixture,perpetualFixture}=require('./market-fixture.cjs'),{scanQrPng}=require('./receive-qr-test.cjs');
const origin=new URL(process.argv.find(arg=>arg.startsWith('--origin='))?.slice(9)||'https://trustsendplus.vercel.app').origin,dist=path.resolve(__dirname,'../dist');
async function main(){
 assert(origin.startsWith('https://'),'Use the actual HTTPS origin configured for this project.');
 const browser=await webkit.launch({headless:true});let page;
 try{
  const acknowledgements=new Set(),pending=new Map(),relayHosts=new Set(),methods=new Set(),relayErrorCodes=new Set();let acknowledge,closedSockets=0,socketErrors=0;const subscribed=new Promise(resolve=>acknowledge=resolve);
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
  await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/market')return route.fulfill({json:marketFixture(url.href)});
   if(url.pathname==='/api/perpetuals')return route.fulfill({json:perpetualFixture()});
   let file=path.join(dist,decodeURIComponent(url.pathname));if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(dist,'index.html');
   return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});
  });
  page=await context.newPage();page.setDefaultTimeout(35000);
  page.on('websocket',socket=>{
   const host=new URL(socket.url()).hostname;relayHosts.add(host);
   // Relay request IDs exceed Number.MAX_SAFE_INTEGER; preserve them when matching ACKs.
   const parse=frame=>{try{return safeJsonParse(String(frame.payload))}catch{return null}};
   socket.on('framesent',frame=>{const body=parse(frame);if(body&&typeof body.method==='string'){methods.add(body.method);pending.set(String(body.id),body.method)}});
   socket.on('socketerror',()=>socketErrors++);socket.on('close',()=>closedSockets++);
   socket.on('framereceived',frame=>{const parsed=parse(frame);for(const body of Array.isArray(parsed)?parsed:[parsed]){if(body?.error?.code)relayErrorCodes.add(body.error.code);if(body&&pending.has(String(body.id))&&Object.hasOwn(body,'result')&&body.result!==false&&!body.error){const method=pending.get(String(body.id));acknowledgements.add(method);if(/subscribe|^wc_proposeSession$/i.test(method))acknowledge()}}});
  });
  await page.goto(origin);for(const digit of '787878')await page.getByRole('button',{name:digit,exact:true}).click();
  await page.getByRole('button',{name:'Recevoir',exact:true}).click();await page.getByRole('button',{name:'Connecter mon portefeuille',exact:true}).click();
  assert.equal(await page.locator('#connection-project').count(),0,'The supplied Project ID must be configured by default.');
  await page.getByRole('button',{name:'Afficher le QR WalletConnect',exact:true}).click();
  const result=await Promise.race([
   page.getByTestId('walletconnect-qr').waitFor({state:'visible'}).then(()=>({ready:true})).catch(()=>({ready:false})),
   page.locator('.connection-error').waitFor({state:'visible'}).then(async()=>({ready:false,message:await page.locator('.connection-error').innerText()})).catch(()=>({ready:false}))
  ]);
  assert(result.ready,result.message||'The real WalletConnect relay did not provide a QR before timeout.');
  await page.getByTestId('walletconnect-qr').evaluate(element=>element.decode());
  const uri=scanQrPng(await page.locator('.connection-code').screenshot());assert(/^wc:[a-f0-9]{64}@2\?/i.test(uri));
  await Promise.race([subscribed,page.waitForTimeout(10000)]);
  assert(relayHosts.size>0,'The SDK must contact the real relay.');assert([...acknowledgements].some(method=>/subscribe|^wc_proposeSession$/i.test(method)),'The relay must acknowledge the pairing proposal. '+JSON.stringify({methods:[...methods],acknowledged:[...acknowledgements],relayErrorCodes:[...relayErrorCodes],closedSockets,socketErrors}));
  assert.equal(await page.locator('.connection-address').count(),0,'Generating a QR must not create an approved wallet session.');
  await page.getByRole('button',{name:'Annuler la connexion',exact:true}).click();assert.equal(await page.getByTestId('walletconnect-qr').count(),0);
  console.log(JSON.stringify({result:'PASS',origin,relayHosts:[...relayHosts],acknowledged:[...acknowledgements],qrDecoded:true,approvedWallet:false,transactionsRequested:0,note:'Local production bundle; real SDK and relay. No deployed version or physical wallet approval is implied.'}));
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
