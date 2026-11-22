import React,{useEffect,useRef,useState} from 'react'
import QRCode from 'qrcode'
import {FiArrowLeft,FiCheck,FiCopy,FiExternalLink,FiLink,FiRefreshCw,FiSettings} from 'react-icons/fi'
import AssetIcon from './AssetIcon'
import {createReadOnlyConnection,PROJECT_ID_KEY,validProjectId} from './wallet-connection.mjs'
import connectionConfig from './walletconnect-config.json'
import './wallet-connection.css'

function savedProject(){const configured=import.meta.env.VITE_WALLETCONNECT_PROJECT_ID||connectionConfig.projectId||'';try{return localStorage.getItem(PROJECT_ID_KEY)||configured}catch{return configured}}

export default function WalletConnection({onClose,say}) {
  const [projectId,setProjectId]=useState(savedProject),[draft,setDraft]=useState(savedProject),[configuring,setConfiguring]=useState(()=>!validProjectId(savedProject())),[configError,setConfigError]=useState('')
  const [state,setState]=useState({status:'idle'}),[qr,setQr]=useState(null),[qrError,setQrError]=useState(false),[clock,setClock]=useState(Date.now())
  const controller=useRef(),starting=useRef(false),active=useRef(true)
  const busy=['starting','waiting','connected'].includes(state.status),origin=window.location.origin
  useEffect(()=>{active.current=true;return()=>{active.current=false;void controller.current?.dispose()}},[])
  useEffect(()=>{
    setQr(null);setQrError(false)
    if(state.status!=='waiting'||!state.uri)return
    let cancelled=false
    QRCode.toDataURL(state.uri,{width:1000,margin:4,errorCorrectionLevel:'M',color:{dark:'#101114',light:'#ffffff'}}).then(src=>{if(!cancelled)setQr({uri:state.uri,src})},()=>{if(!cancelled)setQrError(true)})
    return()=>{cancelled=true}
  },[state.status,state.uri])
  useEffect(()=>{if(state.status!=='waiting')return;setClock(Date.now());const interval=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(interval)},[state.status,state.expiresAt])
  async function connect(){
    if(starting.current||!validProjectId(projectId))return
    starting.current=true
    await controller.current?.dispose()
    if(!active.current){starting.current=false;return}
    const next=createReadOnlyConnection({projectId,origin,onState:value=>{if(active.current&&controller.current===next)setState(value)}})
    controller.current=next
    try{await next.start()}finally{starting.current=false}
  }
  function disconnect(){void controller.current?.dispose();controller.current=null;setState({status:'idle'});setQr(null)}
  function close(){disconnect();onClose()}
  function configure(event){
    event.preventDefault();const value=draft.trim()
    if(!validProjectId(value)){setConfigError('Le Project ID public contient 32 caractères hexadécimaux.');return}
    try{localStorage.setItem(PROJECT_ID_KEY,value)}catch{setProjectId(value);setConfiguring(false);say('Identifiant utilisé pour cette session : stockage local indisponible.');return}
    setProjectId(value);setConfiguring(false);setConfigError('');setState({status:'idle'})
  }
  async function copy(value,label){try{await navigator.clipboard.writeText(value);say(label)}catch{say('Copie indisponible sur ce navigateur.')}}
  const seconds=Math.max(0,Math.ceil(((state.expiresAt||0)-clock)/1000)),remaining=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`
  return <section className="wallet-connection-screen">
    <header className="connection-header"><button className="reference-round" aria-label="Retour" onClick={close}><FiArrowLeft/></button><h1>Connecter mon portefeuille</h1><button className="reference-round" aria-label="Configurer WalletConnect" disabled={busy} onClick={()=>{setDraft(projectId);setConfigError('');setConfiguring(value=>!value)}}><FiSettings/></button></header>
    <main className="connection-content">
      <div className="connection-identity"><img src="/connection-icon.svg" width="46" height="46" alt=""/><div><strong>Trust Send</strong><span>{window.location.host}</span></div></div>
      <span className="connection-mode">Prototype indépendant · Lecture seule</span>
      <p className="connection-intro">Partagez votre adresse publique et le réseau avec ce site. Les soldes de démonstration restent distincts du portefeuille connecté.</p>
      <div className="connection-network"><AssetIcon asset={{id:'eth',symbol:'ETH'}}/><strong>Ethereum</strong><span>ETH · USDT ERC20 · USDC ERC20</span></div>
      {configuring&&<form className="connection-config" onSubmit={configure}>
        <label htmlFor="connection-project">Project ID public WalletConnect</label>
        <input id="connection-project" value={draft} maxLength={32} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} placeholder="Identifiant public Reown" onChange={event=>{setDraft(event.target.value);setConfigError('')}}/>
        <p>Cet identifiant public appartient au site. Le client ID thirdweb est différent.</p>
        <a href="https://dashboard.reown.com/" target="_blank" rel="noreferrer noopener">Obtenir mon Project ID<FiExternalLink/></a>
        {configError&&<p className="connection-error" role="alert">{configError}</p>}
        <button className="trading-primary" type="submit">Enregistrer la configuration</button>
      </form>}
      {state.status==='connected'?<div className="connection-account">
        <span className="connection-success"><FiCheck/>Connecté en lecture seule</span>
        <h2>{state.walletName}</h2><p>Réseau {state.chain}</p>
        {state.accounts.map(address=><div className="connection-address" key={address}><code>{address}</code><button aria-label={`Copier ${address}`} onClick={()=>copy(address,'Adresse publique copiée')}><FiCopy/></button></div>)}
        <button className="soft full" onClick={disconnect}>Déconnecter mon portefeuille</button>
      </div>:<>
        <div className={`connection-code ${state.status==='waiting'?'has-code':''}`}>
          {state.status==='waiting'&&qr?.uri===state.uri?<img data-testid="walletconnect-qr" src={qr.src} alt="QR de connexion WalletConnect à Trust Send"/>:<div className="connection-placeholder"><FiLink/><strong>{state.status==='starting'?'Préparation de la connexion…':state.status==='waiting'?qrError?'Affichage du QR indisponible':'Génération du QR…':'Connexion WalletConnect'}</strong><p>{state.status==='starting'?'Connexion au relais sécurisé.':'Confirmez la connexion dans votre application de portefeuille.'}</p></div>}
        </div>
        {state.status==='waiting'?<>
          <p className="connection-expiry" role="status">Scannez avec votre wallet · QR valable {remaining}</p>
          <div className="connection-actions"><button className="soft" onClick={()=>copy(state.uri,'Lien de connexion copié')}><FiCopy/>Copier le lien</button><button className="soft" onClick={connect}><FiRefreshCw/>Nouveau QR</button></div>
          <button className="text-button" onClick={disconnect}>Annuler la connexion</button>
        </>:<button className="trading-primary" disabled={!validProjectId(projectId)||state.status==='starting'||configuring} onClick={connect}>{state.status==='starting'?'Connexion…':state.status==='error'?'Réessayer la connexion':'Afficher le QR WalletConnect'}</button>}
        {state.status==='error'&&<p className="connection-error" role="alert">{state.error}</p>}
      </>}
      <div className="connection-permissions"><FiCheck/><p>Adresse publique et réseau uniquement. Aucune signature ni autorisation de dépense demandée.</p></div>
      <p className="connection-footer">Vérifiez « Trust Send — lecture seule » et <strong>{window.location.host}</strong> dans votre wallet avant de confirmer.</p>
      <p className="connection-footer connection-license">WalletConnect · Portions © 2025 Reown, Inc. All Rights Reserved · <a href="/licenses/walletconnect-community.txt" target="_blank" rel="noreferrer noopener">Licence</a></p>
    </main>
  </section>
}
