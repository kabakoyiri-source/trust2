import React,{useEffect,useRef,useState} from 'react'
import QRCode from 'qrcode'
import {FiArrowDown,FiArrowUpRight,FiCheck,FiCopy,FiExternalLink,FiRefreshCw} from 'react-icons/fi'
import {TRANSFER_ASSETS,displayUnits,prepareTransfer,readTransferBalance} from './wallet-transfers.mjs'

export default function ConnectedWallet({state,connection,onDisconnect,copy}) {
  const [account,setAccount]=useState(state.accounts[0]),[symbol,setSymbol]=useState('USDT'),[tab,setTab]=useState('send')
  const [recipient,setRecipient]=useState(''),[amount,setAmount]=useState('1'),[balance,setBalance]=useState(null),[refresh,setRefresh]=useState(0),[balanceError,setBalanceError]=useState('')
  const [qr,setQr]=useState(''),[qrError,setQrError]=useState(false),[quote,setQuote]=useState(null),[status,setStatus]=useState('idle'),[error,setError]=useState(''),[hash,setHash]=useState('')
  const active=useRef(true),working=useRef(false),busy=['preparing','sending'].includes(status)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  useEffect(()=>{
    let cancelled=false
    setBalance(null);setBalanceError('')
    readTransferBalance(symbol,account).then(value=>{if(!cancelled)setBalance(displayUnits(value,TRANSFER_ASSETS[symbol].decimals))},()=>{if(!cancelled)setBalanceError('Solde indisponible')})
    return()=>{cancelled=true}
  },[account,symbol,refresh])
  useEffect(()=>{
    let cancelled=false
    setQr('');setQrError(false)
    if(tab==='receive')QRCode.toDataURL(account,{width:1000,margin:4,errorCorrectionLevel:'M',color:{dark:'#101114',light:'#ffffff'}}).then(value=>{if(!cancelled)setQr(value)},()=>{if(!cancelled)setQrError(true)})
    return()=>{cancelled=true}
  },[account,tab])
  function reset(){setQuote(null);setError('');setHash('');setStatus('idle')}
  async function review(event){
    event.preventDefault()
    if(working.current)return
    working.current=true;setStatus('preparing');setError('');setHash('')
    try{const prepared=await prepareTransfer({symbol,from:account,to:recipient.trim(),amount});if(active.current){setQuote({...prepared,at:Date.now()});setStatus('review')}}
    catch(problem){if(active.current){setError(problem.message);setStatus('idle')}}
    finally{working.current=false}
  }
  async function send(){
    if(working.current||!quote)return
    if(Date.now()-quote.at>60000){reset();setError('Vérifiez à nouveau le montant et les frais avant de confirmer.');return}
    working.current=true;setStatus('sending');setError('')
    try{const result=await connection.sendTransfer(quote);if(active.current){setHash(result);setQuote(null);setStatus('submitted');setRefresh(value=>value+1)}}
    catch(problem){if(active.current){setError(problem.message);setQuote(null);setStatus('idle')}}
    finally{working.current=false}
  }
  return <div className="connection-account">
    <span className="connection-success"><FiCheck/>Portefeuille connecté</span>
    <h2>{state.walletName}</h2><p>Ethereum · ETH / USDT / USDC</p>
    {state.accounts.length>1&&<label className="connection-field">Compte<select aria-label="Compte connecté" value={account} disabled={busy} onChange={event=>{setAccount(event.target.value);reset()}}>{state.accounts.map(address=><option key={address} value={address}>{address}</option>)}</select></label>}
    <div className="connection-address"><code>{account}</code><button aria-label={`Copier ${account}`} onClick={()=>copy(account,'Adresse publique copiée')}><FiCopy/></button></div>
    <div className="connection-tabs" aria-label="Actions du portefeuille">
      <button aria-pressed={tab==='send'} disabled={busy} onClick={()=>{setTab('send');reset()}}><FiArrowUpRight/>Envoyer</button>
      <button aria-pressed={tab==='receive'} disabled={busy} onClick={()=>{setTab('receive');reset()}}><FiArrowDown/>Recevoir</button>
    </div>
    <label className="connection-field">Crypto<select aria-label="Crypto" value={symbol} disabled={busy||Boolean(quote)} onChange={event=>{setSymbol(event.target.value);reset()}}>{Object.keys(TRANSFER_ASSETS).map(value=><option key={value}>{value}</option>)}</select></label>
    <div className="connection-balance"><span>{balance!==null?`Solde : ${balance} ${symbol}`:balanceError||'Chargement du solde…'}</span><button aria-label="Actualiser le solde" disabled={busy} onClick={()=>{reset();setRefresh(value=>value+1)}}><FiRefreshCw/></button></div>
    {tab==='receive'?<div className="connection-receive">
      <div className="connection-code has-code">{qr?<img data-testid="connected-receive-qr" src={qr} alt={`QR de réception ${symbol} sur Ethereum : ${account}`}/>:<p role="status">{qrError?'QR indisponible. Copiez votre adresse.':'Génération du QR…'}</p>}</div>
      <p>Recevoir {symbol} sur Ethereum{symbol==='ETH'?'':' (ERC20)'}.</p>
      <button className="soft full" onClick={()=>copy(account,'Adresse de réception copiée')}><FiCopy/>Copier mon adresse</button>
    </div>:hash?<div className="connection-submitted" role="status">
      <FiCheck/><h3>Transaction envoyée au réseau</h3><p>Confirmation en cours sur Ethereum.</p>
      <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer noopener">Voir la transaction<FiExternalLink/></a>
      <button className="soft full" onClick={()=>{reset();setRecipient('');setAmount('1')}}>Nouveau transfert</button>
    </div>:quote?<div className="connection-review">
      <h3>Vérifier le transfert</h3>
      <dl><div><dt>Montant</dt><dd>{quote.amount} {quote.symbol}</dd></div><div><dt>Depuis</dt><dd>{quote.from}</dd></div><div><dt>Destinataire</dt><dd>{quote.to}</dd></div><div><dt>Réseau</dt><dd>Ethereum</dd></div><div><dt>Frais estimés</dt><dd>{quote.fee} ETH</dd></div></dl>
      <p>Les frais définitifs sont affichés dans votre wallet.</p>
      <button className="trading-primary" disabled={busy} onClick={send}>{status==='sending'?'Confirmez dans votre wallet…':'Confirmer dans mon wallet'}</button>
      <button className="text-button" disabled={busy} onClick={reset}>Modifier le transfert</button>
    </div>:<form className="connection-transfer-form" onSubmit={review}>
      <label className="connection-field">Adresse du destinataire<input required aria-label="Adresse du destinataire" value={recipient} maxLength={42} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="0x…" disabled={busy} onChange={event=>{setRecipient(event.target.value);setError('')}}/></label>
      <label className="connection-field">Montant ({symbol})<input required aria-label="Montant du transfert" value={amount} maxLength={100} inputMode="decimal" autoComplete="off" disabled={busy} onChange={event=>{setAmount(event.target.value);setError('')}}/></label>
      <button className="trading-primary" type="submit" disabled={busy||!recipient.trim()||!amount.trim()}>{status==='preparing'?'Vérification…':'Vérifier le transfert'}</button>
    </form>}
    {error&&<p className="connection-error" role="alert">{error}</p>}
    <button className="text-button connection-disconnect" onClick={onDisconnect}>Déconnecter mon portefeuille</button>
  </div>
}
