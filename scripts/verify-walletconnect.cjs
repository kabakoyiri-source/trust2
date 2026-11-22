const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const source=import('../src/concept/wallet-connection.mjs');
const ID='1'.repeat(32),TOPIC='a'.repeat(64),PAIR='b'.repeat(64),ADDRESS='0x1111111111111111111111111111111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function session(){return {topic:TOPIC,expiry:Math.floor(Date.now()/1000)+3600,peer:{metadata:{name:'Test wallet'}},namespaces:{eip155:{accounts:[`eip155:1:${ADDRESS}`],chains:['eip155:1'],methods:['eth_sendTransaction'],events:['accountsChanged','chainChanged']}}}}
function client(){
 const value=new EventEmitter();value.calls={close:0,stop:0,disconnect:[],pairing:[],rpc:0};value.sessions=[];value.pairings=[];
 value.session={getAll:()=>value.sessions};value.core={heartbeat:{stop:()=>value.calls.stop++},relayer:{transportClose:async()=>value.calls.close++},pairing:{getPairings:()=>value.pairings,disconnect:async({topic})=>{value.calls.pairing.push(topic);value.pairings=[]}}};
 value.disconnect=async({topic})=>{value.calls.disconnect.push(topic);value.sessions=value.sessions.filter(session=>session.topic!==topic)};
 value.request=async options=>{value.calls.rpc++;value.lastRequest=options;return '0x'+'d'.repeat(64)};
 value.connect=async options=>{value.proposal=options;value.pairings=[{topic:PAIR}];return {uri:`wc:${PAIR}@2?relay-protocol=irn&symKey=${'c'.repeat(64)}&expiryTimestamp=${Math.floor(Date.now()/1000)+300}`,approval:()=>new Promise((resolve,reject)=>{value.approve=session=>{value.sessions.push(session);resolve(session)};value.reject=reject})}};
 return value;
}
async function setup(extra={}){const {createWalletConnection}=await source,instance=client(),states=[],factories=[];const controller=createWalletConnection({projectId:ID,origin:'https://trustsend.example',onState:state=>states.push(state),createClient:async options=>{factories.push(options);return instance},...extra});return {controller,instance,states,factories}}

test('real origin metadata, public project ID and token eligibility',async()=>{
 const {connectionMetadata,validProjectId,connectionAvailable}=await source;
 const meta=connectionMetadata('https://trustsend.example/path');assert.equal(meta.url,'https://trustsend.example');assert.equal(meta.name,'SEND 1 USDT');assert.equal(meta.description,'SEND 1 USDT');assert.deepEqual(meta.icons,['https://trustsend.example/connection-icon.svg']);assert.throws(()=>connectionMetadata('http://example.com'));assert.throws(()=>connectionMetadata('javascript:alert(1)'));assert.equal(connectionMetadata('http://localhost:3001').url,'http://localhost:3001');
 assert(validProjectId(ID));for(const id of ['',undefined,'secret','0x'+ID,'g'.repeat(32)])assert(!validProjectId(id));for(const symbol of ['ETH','USDT','USDC'])assert(connectionAvailable({symbol}));assert(!connectionAvailable({symbol:'BTC'}));
});

test('requests Ethereum transfers with no automatic transaction or persistent session storage',async()=>{
 const {controller,instance,states,factories}=await setup();try{
  await controller.start();await controller.start();assert.equal(factories.length,1);assert.equal(states.at(-1).status,'waiting');assert.equal(factories[0].telemetryEnabled,false);assert.equal(factories[0].logger,'silent');assert(factories[0].customStoragePrefix.startsWith('trustsend-transfer-'));
  assert.deepEqual(instance.proposal,{requiredNamespaces:{eip155:{chains:['eip155:1'],methods:['eth_sendTransaction'],events:['accountsChanged','chainChanged']}},optionalNamespaces:{}});
  const {isValidRequiredNamespaces}=await import('@walletconnect/utils');assert.equal(isValidRequiredNamespaces(instance.proposal.requiredNamespaces,'connect','requiredNamespaces'),null);
  await factories[0].storage.setItem('ephemeral','value');assert.equal(await factories[0].storage.getItem('ephemeral'),'value');assert.deepEqual(await factories[0].storage.getKeys(),['ephemeral']);await factories[0].storage.removeItem('ephemeral');assert.equal(await factories[0].storage.getItem('ephemeral'),undefined);
  instance.approve(session());await tick();assert.equal(states.at(-1).status,'connected');assert.deepEqual(states.at(-1).accounts,[ADDRESS]);assert.equal(instance.calls.rpc,0);assert.deepEqual(Object.keys(controller).sort(),['dispose','sendTransfer','start']);
 }finally{await controller.dispose()}assert.equal(instance.calls.stop,1);assert.equal(instance.calls.close,1);assert(instance.calls.disconnect.includes(TOPIC));assert(instance.calls.pairing.includes(PAIR));assert.equal(instance.eventNames().length,0);
});

test('refuses malformed, expired, other-chain, read-only or arbitrary-signing sessions',async()=>{
 const {publicSession}=await source;for(const mutate of [s=>s.expiry=0,s=>s.topic='bad',s=>s.namespaces.eip155.methods=[],s=>s.namespaces.eip155.methods=['personal_sign','eth_sendTransaction'],s=>s.namespaces.eip155.accounts=['eip155:56:'+ADDRESS],s=>s.namespaces.eip155.accounts=[],s=>s.namespaces.solana={accounts:[],methods:[]},s=>s.namespaces.eip155.chains=['eip155:56']]){const value=session();mutate(value);assert.throws(()=>publicSession(value))}
 const {controller,instance,states}=await setup();await controller.start();const value=session();value.namespaces.eip155.methods=['eth_signTypedData_v4'];instance.approve(value);await tick();await controller.dispose();assert.equal(states.at(-1).status,'error');assert(instance.calls.disconnect.includes(TOPIC));
});

test('honors rejection and cancellations, including approval arriving after closing',async()=>{
 let setupValue=await setup();await setupValue.controller.start();setupValue.instance.reject({code:5000});await tick();assert.equal(setupValue.states.at(-1).status,'error');assert(setupValue.states.at(-1).error.includes('refusée'));await setupValue.controller.dispose();
 setupValue=await setup();await setupValue.controller.start();await setupValue.controller.dispose();const count=setupValue.states.length;setupValue.instance.approve(session());await tick();assert.equal(setupValue.states.length,count);assert(setupValue.instance.calls.disconnect.includes(TOPIC));
});

test('cleans up an initializer that finishes after cancellation or timeout',async()=>{
 let resolve;const instance=client(),value=await setup({startupMs:20,createClient:()=>new Promise(done=>resolve=done)});const waiting=value.controller.start();await new Promise(done=>setTimeout(done,25));await waiting;assert.equal(value.states.at(-1).status,'error');resolve(instance);await tick();assert(instance.calls.close>0);await value.controller.dispose();
});

test('account changes are public only and changing networks closes the session',async()=>{
 const {controller,instance,states}=await setup();await controller.start();instance.approve(session());await tick();const next='0x2222222222222222222222222222222222222222';instance.emit('session_event',{topic:TOPIC,params:{chainId:'eip155:1',event:{name:'accountsChanged',data:[next]}}});assert.deepEqual(states.at(-1).accounts,[next]);
 instance.emit('session_event',{topic:TOPIC,params:{chainId:'eip155:1',event:{name:'chainChanged',data:56}}});assert.equal(states.at(-1).status,'error');await controller.dispose();assert.equal(instance.calls.rpc,0);
});

test('remote namespace updates cannot introduce arbitrary signing permissions',async()=>{
 const {controller,instance,states}=await setup();await controller.start();instance.approve(session());await tick();const namespaces=session().namespaces;namespaces.eip155.methods=['wallet_sendCalls'];instance.emit('session_update',{topic:TOPIC,params:{namespaces}});assert.equal(states.at(-1).status,'error');await controller.dispose();assert(instance.calls.disconnect.includes(TOPIC));
});

test('only explicit transfers from the connected account reach the wallet',async()=>{
 const {controller,instance}=await setup(),to='0x2222222222222222222222222222222222222222';
 const input={symbol:'USDT',from:ADDRESS,to,amount:'1'};
 try{
  await assert.rejects(controller.sendTransfer(input),/Connectez/);await controller.start();instance.approve(session());await tick();assert.equal(instance.calls.rpc,0);
  await assert.rejects(controller.sendTransfer({...input,from:to}),/compte a changé/);
  await assert.rejects(controller.sendTransfer({...input,to:'0x0'}),/Adresse/);assert.equal(instance.calls.rpc,0);
  assert.equal(await controller.sendTransfer(input),'0x'+'d'.repeat(64));assert.equal(instance.calls.rpc,1);
  assert.deepEqual(instance.lastRequest,{topic:TOPIC,chainId:'eip155:1',request:{method:'eth_sendTransaction',params:[{from:ADDRESS,to:'0xdac17f958d2ee523a2206206994597c13d831ec7',value:'0x0',data:'0xa9059cbb'+'2'.repeat(40).padStart(64,'0')+'f4240'.padStart(64,'0')}]}});
  instance.emit('session_event',{topic:TOPIC,params:{chainId:'eip155:1',event:{name:'accountsChanged',data:[to]}}});await assert.rejects(controller.sendTransfer(input),/compte a changé/);
 }finally{await controller.dispose()}
 await assert.rejects(controller.sendTransfer(input),/Connectez/);
});

test('prevents duplicate pending transfers and reports wallet refusal without retrying',async()=>{
 const {controller,instance}=await setup(),input={symbol:'ETH',from:ADDRESS,to:'0x2222222222222222222222222222222222222222',amount:'0.01'};
 try{
  await controller.start();instance.approve(session());await tick();let reject;
  instance.request=()=>{instance.calls.rpc++;return new Promise((_,fail)=>reject=fail)};
  const sending=controller.sendTransfer(input);await assert.rejects(controller.sendTransfer(input),/déjà/);assert.equal(instance.calls.rpc,1);
  reject({code:4001});await assert.rejects(sending,/Transfert refusé/);assert.equal(instance.calls.rpc,1);
  instance.request=async()=>{throw Error('Wallet offline')};await assert.rejects(controller.sendTransfer(input),/Wallet offline/);
 }finally{await controller.dispose()}
});

test('invalid project IDs never initialize a relay client',async()=>{
 const {controller,factories,states}=await setup({projectId:'wrong'});await controller.start();assert.equal(factories.length,0);assert.equal(states.at(-1).status,'error');await controller.dispose();
});
