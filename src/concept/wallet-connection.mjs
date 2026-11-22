const READ_METHODS=new Set(['eth_accounts','eth_chainId'])
const REASON={code:6000,message:'Read-only connection closed by user'}
const HEX64=/^[a-f0-9]{64}$/i
const ADDRESS=/^0x[0-9a-f]{40}$/i
export const PROJECT_ID_KEY='trustsend-walletconnect-project-v1'
export const validProjectId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value)
export const connectionAvailable=asset=>['ETH','USDT','USDC'].includes(asset.symbol)

export function connectionMetadata(origin) {
  const url=new URL(origin)
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Une connexion HTTPS est nécessaire.')
  return {name:'Trust Send — lecture seule',description:'Prototype indépendant : connexion à ce site pour partager une adresse publique et le réseau. Aucun transfert ni signature.',url:url.origin,icons:[new URL('/connection-icon.svg',url.origin).href]}
}

export function memoryStorage() {
  const data=new Map()
  return {getKeys:async()=>[...data.keys()],getEntries:async()=>[...data.entries()],getItem:async key=>data.get(key),setItem:async(key,value)=>{data.set(key,value)},removeItem:async key=>{data.delete(key)}}
}

export function publicSession(session,now=Date.now()) {
  if(!session||!HEX64.test(session.topic)||!Number.isFinite(session.expiry)||session.expiry*1000<=now)throw Error('Session expirée ou non valide.')
  const namespaces=Object.entries(session.namespaces||{})
  if(!namespaces.length||namespaces.some(([name,namespace])=>!['eip155','eip155:1'].includes(name)||!Array.isArray(namespace.methods)||namespace.methods.some(method=>!READ_METHODS.has(method))))throw Error('Ce portefeuille propose des autorisations supplémentaires. La connexion a été fermée.')
  const accounts=[]
  for(const [,namespace] of namespaces){
    if(!Array.isArray(namespace.accounts)||namespace.chains?.some(chain=>chain!=='eip155:1'))throw Error('Cette connexion est limitée au réseau Ethereum.')
    for(const account of namespace.accounts){const match=/^eip155:1:(0x[0-9a-f]{40})$/i.exec(account);if(!match)throw Error('Adresse Ethereum non valide dans la session.');if(!accounts.includes(match[1]))accounts.push(match[1])}
  }
  if(!accounts.length)throw Error('Aucune adresse Ethereum partagée par le portefeuille.')
  return {accounts,chain:'Ethereum',walletName:String(session.peer?.metadata?.name||'Portefeuille').slice(0,80),expiresAt:session.expiry*1000}
}

function pairing(uri,now) {
  const match=/^wc:([a-f0-9]{64})@2\?(.+)$/i.exec(uri||'')
  if(!match)throw Error('Lien WalletConnect non valide.')
  const params=new URLSearchParams(match[2]),timestamp=Number(params.get('expiryTimestamp'))
  if(params.get('relay-protocol')!=='irn'||!HEX64.test(params.get('symKey')||''))throw Error('Lien WalletConnect non valide.')
  const expiresAt=Math.min(now+300000,timestamp>0?timestamp*1000:Infinity)
  if(expiresAt<=now)throw Error('Ce QR a expiré. Générez un nouveau code.')
  return {topic:match[1],expiresAt}
}

async function within(promise,milliseconds) {
  let timer
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Délai de connexion dépassé. Réessayez.')),milliseconds)})])}finally{clearTimeout(timer)}
}

async function cleanup(client,topic) {
  if(!client)return
  const sessions=new Set([topic,...(client.session?.getAll?.()||[]).map(session=>session.topic)].filter(Boolean))
  const pairings=client.core?.pairing?.getPairings?.()||[]
  await Promise.allSettled([...sessions].map(session=>within(Promise.resolve().then(()=>client.disconnect({topic:session,reason:REASON})),1000)))
  await Promise.allSettled(pairings.map(item=>within(Promise.resolve().then(()=>client.core.pairing.disconnect({topic:item.topic})),1000)))
  client.core?.heartbeat?.stop?.()
  await within(Promise.resolve().then(()=>client.core?.relayer?.transportClose?.()),1000).catch(()=>{})
  const prefix=client.core?.opts?.customStoragePrefix
  if(prefix?.startsWith('trustsend-readonly-')){const key=`_walletConnectCore_${prefix}`;if(globalThis[key]===client.core)delete globalThis[key]}
}

async function defaultClient(options) {
  const {default:SignClient}=await import('@walletconnect/sign-client')
  return SignClient.init(options)
}

// The SDK remains private to this controller. There is no request/sign/transaction API.
export function createReadOnlyConnection({projectId,origin,onState,createClient=defaultClient,now=Date.now,startupMs=25000}) {
  let client,session,disposed=false,started=false,timer,closing
  const listeners=[]
  const publish=state=>{if(!disposed)onState(state)}
  const listen=(name,callback)=>{client.on(name,callback);listeners.push([name,callback])}
  function dispose(){
    if(closing)return closing
    disposed=true;clearTimeout(timer)
    for(const [name,callback] of listeners)client?.off(name,callback)
    closing=cleanup(client,session?.topic)
    return closing
  }
  function failure(message){publish({status:'error',error:message});void dispose()}
  function connected(updated){
    const info=publicSession(updated,now());session=updated;clearTimeout(timer)
    timer=setTimeout(()=>failure('La session a expiré. Reconnectez votre portefeuille.'),Math.min(info.expiresAt-now(),2147483647))
    publish({status:'connected',...info})
  }
  async function start(){
    if(started||disposed)return
    started=true;publish({status:'starting'})
    try{
      if(!validProjectId(projectId))throw Error('Renseignez un Project ID public Reown/WalletConnect valide.')
      const metadata=connectionMetadata(origin)
      const pending=createClient({projectId,metadata,logger:'silent',telemetryEnabled:false,storage:memoryStorage(),customStoragePrefix:`trustsend-readonly-${crypto.randomUUID()}`})
      // A slow initializer may finish after cancellation or a timeout: close that instance too.
      Promise.resolve(pending).then(value=>{if(disposed)void cleanup(value)},()=>{})
      client=await within(pending,startupMs)
      if(disposed){await cleanup(client);return}
      listen('session_update',event=>{if(event.topic!==session?.topic)return;try{connected({...session,namespaces:event.params.namespaces})}catch(error){failure(error.message)}})
      for(const name of ['session_delete','session_expire'])listen(name,event=>{if(event.topic===session?.topic)failure(name==='session_expire'?'La session a expiré. Reconnectez votre portefeuille.':'Le portefeuille a fermé la connexion.')})
      listen('session_event',event=>{
        if(event.topic!==session?.topic)return
        const {event:change,chainId}=event.params||{}
        if(chainId!=='eip155:1'){failure('Le réseau a changé. Reconnectez sur Ethereum.');return}
        if(change?.name==='accountsChanged'){
          if(!Array.isArray(change.data)||!change.data.length||change.data.some(address=>!ADDRESS.test(address))){failure('Le portefeuille ne partage plus d’adresse Ethereum.');return}
          try{connected({...session,namespaces:{eip155:{methods:[],events:['accountsChanged','chainChanged'],chains:['eip155:1'],accounts:change.data.map(address=>`eip155:1:${address}`)}}})}catch(error){failure(error.message)}
        }else if(change?.name==='chainChanged'&&!['1','0x1','eip155:1'].includes(String(change.data)))failure('Le réseau a changé. Reconnectez sur Ethereum.')
      })
      const response=await within(client.connect({requiredNamespaces:{eip155:{chains:['eip155:1'],methods:[],events:['accountsChanged','chainChanged']}},optionalNamespaces:{}}),startupMs)
      // Observe approval immediately, even if a cancellation happened while connect was pending.
      const approved=Promise.resolve().then(()=>response.approval())
      approved.then(async value=>{if(disposed){await cleanup(client,value?.topic);return}try{connected(value)}catch(error){session=value;failure(error.message)}},error=>{if(!disposed)failure([4001,5000].includes(error?.code)?'Connexion refusée dans le portefeuille.':'Connexion interrompue ou expirée. Générez un nouveau QR.')})
      if(disposed){await cleanup(client);return}
      const code=pairing(response.uri,now())
      timer=setTimeout(()=>failure('Ce QR a expiré. Générez un nouveau code.'),code.expiresAt-now())
      publish({status:'waiting',uri:response.uri,expiresAt:code.expiresAt})
    }catch(error){if(!disposed)failure(error.message?.startsWith('Renseignez')||error.message?.startsWith('Une connexion')||error.message?.includes('QR')||error.message?.startsWith('Délai')?error.message:'Connexion impossible. Vérifiez le Project ID, le domaine autorisé et votre accès Internet.')}
  }
  return Object.freeze({start,dispose})
}
