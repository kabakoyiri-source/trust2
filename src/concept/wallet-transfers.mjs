export const TRANSFER_ASSETS=Object.freeze({
  ETH:Object.freeze({symbol:'ETH',decimals:18}),
  USDT:Object.freeze({symbol:'USDT',decimals:6,contract:'0xdac17f958d2ee523a2206206994597c13d831ec7'}),
  USDC:Object.freeze({symbol:'USDC',decimals:6,contract:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'})
})
export const ETHEREUM_RPC='https://ethereum-rpc.publicnode.com'
const ADDRESS=/^0x[0-9a-f]{40}$/i,HEX=/^0x[0-9a-f]+$/i,MAX=(1n<<256n)-1n
export const validTransferAddress=value=>typeof value==='string'&&ADDRESS.test(value)&&!/^0x0{40}$/i.test(value)

export function amountUnits(value,decimals) {
  if(typeof value!=='string'||value.length>100)throw Error('Montant non valide.')
  const normalized=value.trim().replace(',','.')
  if(!/^\d+(?:\.\d+)?$/.test(normalized))throw Error('Saisissez un montant positif.')
  const [whole,fraction='']=normalized.split('.')
  if(fraction.length>decimals)throw Error(`Ce token accepte au maximum ${decimals} décimales.`)
  const units=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0')
  if(units<=0n||units>MAX)throw Error('Montant non valide.')
  return units
}

export function displayUnits(value,decimals) {
  const units=BigInt(value),base=10n**BigInt(decimals)
  const fraction=(units%base).toString().padStart(decimals,'0').replace(/0+$/,'')
  return `${units/base}${fraction?'.'+fraction:''}`
}

export function buildTransfer({symbol,from,to,amount}) {
  const asset=TRANSFER_ASSETS[symbol]
  if(!asset)throw Error('Choisissez ETH, USDT ou USDC sur Ethereum.')
  if(!validTransferAddress(from)||!validTransferAddress(to))throw Error('Adresse Ethereum non valide.')
  if(Object.values(TRANSFER_ASSETS).some(item=>item.contract===to.toLowerCase()))throw Error('Le destinataire doit être une adresse de réception, pas le contrat du token.')
  const units=amountUnits(amount,asset.decimals)
  return asset.contract
    ?{from,to:asset.contract,value:'0x0',data:`0xa9059cbb${to.slice(2).toLowerCase().padStart(64,'0')}${units.toString(16).padStart(64,'0')}`}
    :{from,to,value:`0x${units.toString(16)}`}
}

// Public Ethereum reads only. Transaction signing and broadcast stay in the wallet.
export async function ethereumRpc(method,params,fetchImpl=globalThis.fetch) {
  if(!['eth_chainId','eth_getBalance','eth_call','eth_estimateGas','eth_gasPrice'].includes(method))throw Error('Méthode de consultation non autorisée.')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  try {
    const response=await fetchImpl(ETHEREUM_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:controller.signal})
    if(!response.ok)throw Error('RPC unavailable')
    const body=await response.json()
    if(body.error||!HEX.test(body.result)||body.result.length>66)throw Error('Invalid RPC response')
    return BigInt(body.result)
  } catch {throw Error('Consultation Ethereum indisponible. Réessayez.')} finally {clearTimeout(timer)}
}

export async function readTransferBalance(symbol,address,rpc=ethereumRpc) {
  const asset=TRANSFER_ASSETS[symbol]
  if(!asset||!validTransferAddress(address))throw Error('Compte ou token non valide.')
  return asset.contract
    ?rpc('eth_call',[{to:asset.contract,data:`0x70a08231${address.slice(2).toLowerCase().padStart(64,'0')}`},'latest'])
    :rpc('eth_getBalance',[address,'latest'])
}

export async function prepareTransfer(input,rpc=ethereumRpc) {
  const transaction=buildTransfer(input),asset=TRANSFER_ASSETS[input.symbol]
  if(await rpc('eth_chainId',[])!==1n)throw Error('Le réseau de consultation doit être Ethereum.')
  const [balance,nativeBalance,gas,gasPrice]=await Promise.all([
    readTransferBalance(input.symbol,input.from,rpc),
    asset.contract?readTransferBalance('ETH',input.from,rpc):Promise.resolve(null),
    rpc('eth_estimateGas',[transaction]),rpc('eth_gasPrice',[])
  ])
  const units=amountUnits(input.amount,asset.decimals),fee=gas*gasPrice
  if(gas<=0n||gasPrice<=0n)throw Error('Estimation des frais indisponible.')
  if(units>balance)throw Error(`Solde ${input.symbol} insuffisant.`)
  if((nativeBalance??balance)<fee+(asset.contract?0n:units))throw Error('Solde ETH insuffisant pour le montant et les frais réseau.')
  return {symbol:input.symbol,from:input.from,to:input.to,amount:displayUnits(units,asset.decimals),fee:displayUnits(fee,18)}
}
