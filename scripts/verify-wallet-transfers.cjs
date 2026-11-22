const {test}=require('node:test'),assert=require('node:assert/strict');
const source=import('../src/concept/wallet-transfers.mjs'),from='0x1111111111111111111111111111111111111111',to='0x2222222222222222222222222222222222222222';

test('encodes native ETH and six-decimal ERC20 transfers without floating-point rounding',async()=>{
 const {amountUnits,buildTransfer,displayUnits}=await source;
 assert.equal(amountUnits('1',6),1000000n);assert.equal(amountUnits('0,000001',6),1n);assert.equal(amountUnits('0.000000000000000001',18),1n);
 assert.equal(displayUnits(1000001n,6),'1.000001');assert.equal(displayUnits(0n,18),'0');
 for(const amount of ['0','-1','1e6','1.0000001','NaN','Infinity','1,2,3'])assert.throws(()=>amountUnits(amount,6));
 assert.throws(()=>amountUnits('9'.repeat(80),6));
 assert.deepEqual(buildTransfer({symbol:'ETH',from,to,amount:'0.000000000000000001'}),{from,to,value:'0x1'});
 for(const symbol of ['USDT','USDC']){
  const tx=buildTransfer({symbol,from,to,amount:'1.000001'});
  assert.equal(tx.value,'0x0');assert.equal(tx.data,'0xa9059cbb'+'2'.repeat(40).padStart(64,'0')+'f4241'.padStart(64,'0'));
  assert.equal(tx.to,symbol==='USDT'?'0xdac17f958d2ee523a2206206994597c13d831ec7':'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
 }
 for(const input of [{symbol:'BTC'},{to:'0x'+'0'.repeat(40)},{to:'malformed'},{from:'bad'},{to:'0xdac17f958d2ee523a2206206994597c13d831ec7'}])assert.throws(()=>buildTransfer({symbol:'USDT',from,to,amount:'1',...input}));
});

test('checks chain, real balances and ETH gas fees before review',async()=>{
 const {prepareTransfer}=await source,requests=[];
 const rpc=async(method,params)=>{requests.push({method,params});return {eth_chainId:1n,eth_getBalance:10n**18n,eth_call:2000000n,eth_estimateGas:50000n,eth_gasPrice:10n**9n}[method]};
 const input={symbol:'USDT',from,to,amount:'1'};
 assert.deepEqual(await prepareTransfer(input,rpc),{...input,fee:'0.00005'});
 assert.equal(requests.find(item=>item.method==='eth_call').params[0].data,'0x70a08231'+'1'.repeat(40).padStart(64,'0'));
 assert(requests.every(item=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(item.method)));
 await assert.rejects(prepareTransfer({...input,amount:'3'},rpc),/Solde USDT insuffisant/);
 await assert.rejects(prepareTransfer(input,async(method,params)=>method==='eth_getBalance'?0n:rpc(method,params)),/Solde ETH insuffisant/);
 await assert.rejects(prepareTransfer({...input,symbol:'ETH',amount:'1'},rpc),/Solde ETH insuffisant/);
 await assert.rejects(prepareTransfer(input,async(method,params)=>method==='eth_chainId'?56n:rpc(method,params)),/réseau/);
});

test('public RPC enforces read methods, validates responses and surfaces outages',async()=>{
 const {ethereumRpc}=await source;
 const fetchImpl=async(url,options)=>{assert.equal(url,'https://ethereum-rpc.publicnode.com');assert.equal(JSON.parse(options.body).method,'eth_getBalance');return {ok:true,json:async()=>({result:'0x10'})}};
 assert.equal(await ethereumRpc('eth_getBalance',[from,'latest'],fetchImpl),16n);
 await assert.rejects(ethereumRpc('eth_sendTransaction',[],()=>{throw Error('must not call')}),/non autorisée/);
 for(const result of [null,'bad','0x',{},'0x'+'f'.repeat(65)])await assert.rejects(ethereumRpc('eth_call',[],async()=>({ok:true,json:async()=>({result})})),/indisponible/);
 await assert.rejects(ethereumRpc('eth_call',[],async()=>({ok:false})),/indisponible/);
 await assert.rejects(ethereumRpc('eth_call',[],async()=>{throw Error('offline')}),/indisponible/);
});
