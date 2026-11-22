# Connexion et transferts WalletConnect

Le parcours **Recevoir → Connecter mon portefeuille** ouvre un écran distinct pour Ethereum. Le bouton est disponible sur ETH, USDC et USDT. La session concerne Ethereum ; pour USDT et USDC, il s’agit des versions ERC20. L’ancien QR de dépôt reste une adresse de réception et n’est jamais remplacé silencieusement par un lien de connexion.

L’écran initial contient uniquement le bloc **Connexion WalletConnect** et le bouton **Afficher le QR WalletConnect**. La proposition envoyée au wallet utilise **SEND 1 USDT** pour son nom et sa description, avec l’origine réelle du site. La roue de configuration donne accès au Project ID et à la licence du SDK.

Après approbation de la connexion, cet écran propose **Envoyer** et **Recevoir** avec le compte connecté. Le QR de réception et le bouton de copie utilisent son adresse réelle. Les transferts sont accessibles dans cet écran ; les autres parcours de démonstration de l’application conservent leur fonctionnement local.

## Activer le relais

Le Project ID public fourni pour ce projet est préconfiguré dans `src/concept/walletconnect-config.json`. Une nouvelle installation permet donc d’afficher le QR directement, sans saisie supplémentaire. Une configuration enregistrée sur l’appareil ou la variable de compilation `VITE_WALLETCONNECT_PROJECT_ID` reste prioritaire.

1. Créer un projet dans [Reown Dashboard](https://dashboard.reown.com/).
2. Autoriser l’origine utilisée, par exemple `https://trustsendplus.vercel.app`, dans la liste des domaines du projet.
3. Copier le **Project ID public WalletConnect**, constitué de 32 caractères hexadécimaux. Le client ID thirdweb de QrConnector2 n’est pas un Project ID WalletConnect.
4. Dans l’écran de connexion, ouvrir la roue de configuration, saisir cet identifiant et enregistrer. L’application conserve uniquement cet identifiant public sur l’appareil.

Pour préconfigurer l’hébergement, ajouter la variable publique de compilation `VITE_WALLETCONNECT_PROJECT_ID` dans Vercel, puis reconstruire. Aucune clé secrète n’est utilisée côté navigateur. Sans Project ID configuré, l’application affiche le formulaire et ne génère aucun faux QR.

L’infrastructure Reown reste nécessaire pour établir une vraie session. Un identifiant inconnu, un domaine non autorisé ou une panne réseau donnent un état d’erreur et un bouton Réessayer. L’application ne restaure pas automatiquement d’ancienne connexion.

## Autorisations et cycle de vie

Le client officiel `@walletconnect/sign-client` propose uniquement `eip155:1` et la méthode `eth_sendTransaction`. La connexion seule ne déclenche aucune transaction. Le contrôleur expose `sendTransfer` pour construire un transfert ETH ou un appel ERC20 `transfer(address,uint256)` pour USDT/USDC. Le destinataire et le montant sont saisis et affichés dans l’interface. Les montants sont convertis en unités entières avec `BigInt` (18 décimales pour ETH, 6 pour USDT/USDC).

Les soldes sont consultés par le RPC public `https://ethereum-rpc.publicnode.com`. Avant de présenter le récapitulatif, l’application vérifie le réseau, le solde du token, le solde ETH et une estimation des frais réseau. Le récapitulatif expire après une minute. Un clic sur **Confirmer dans mon wallet** déclenche la demande WalletConnect ; le portefeuille du propriétaire reste responsable de la confirmation, de la signature et de la diffusion. Aucun `approve`, permis ou message arbitraire à signer n’est demandé. Les méthodes de signature supplémentaires sont rejetées ; les méthodes publiques `eth_accounts` et `eth_chainId` sont tolérées.

Le résultat affiche le hash et un lien Etherscan sous le statut **Transaction envoyée au réseau**. Il ne prouve pas la confirmation du transfert ; celle-ci se vérifie dans le portefeuille ou l’explorateur. Un refus du wallet est affiché sans réessai automatique. Les demandes simultanées sont bloquées. Un changement de compte efface le récapitulatif et le formulaire ; un changement de réseau ferme la session.

Le QR est généré localement depuis une URI WalletConnect v2 éphémère, après un clic explicite. Il expire au plus tard après cinq minutes ; Nouveau QR ferme la tentative précédente. Le refus, l’expiration et l’annulation retirent le QR. La fermeture de l’écran et Déconnecter ferment le relais et la session. Les résultats arrivant après fermeture sont ignorés et nettoyés.

Les clés de session et les liens de connexion restent dans une mémoire dédiée, sans restauration depuis localStorage. Les soldes et historiques de démonstration ne sont pas modifiés par les transferts réels. Les adresses de dépôt configurées ailleurs dans l’application restent indépendantes du compte WalletConnect.

## Vérifications

- `npm run verify:walletconnect` : permissions de transfert, métadonnées, stockage éphémère, encodage ETH/ERC20, précision des montants, contrôle des soldes/frais, refus, demandes simultanées, fermeture et changements de compte/réseau.
- `npm run verify:walletconnect-ui` : écran allégé, QR décodé sur cinq tailles, configuration, approbation, réception sur le compte connecté, vérification du transfert, refus du wallet, attente de confirmation, hash/explorateur et isolation des soldes de démonstration. Le relais, le wallet et le RPC sont simulés ; aucun fonds réel n’est transféré.
- `node scripts/verify-walletconnect-relay.cjs` : test réseau explicite avec le SDK et le relais réels, en servant le bundle local dans le contexte de `https://trustsendplus.vercel.app`. Vérifie le Project ID préconfiguré, l’acquittement de la proposition et le décodage du QR, puis annule. Il ne déploie rien, n’approuve aucun wallet et ne demande aucune transaction. L’option `--origin=https://votre-site` permet de vérifier une autre origine autorisée.
- La validation avec un wallet réel nécessite le Project ID du projet et une approbation explicite dans l’application du propriétaire.

Sources techniques : [Sign Client](https://docs.reown.com/advanced/api/sign/dapp-usage), [Namespaces WalletConnect](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces), [Project ID et domaines autorisés](https://docs.reown.com/cloud/relay), [contrat USDT](https://tether.to/en/supported-protocols/), [contrat USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses).

Portions © 2025 Reown, Inc. All Rights Reserved. La licence livrée avec le SDK est conservée dans `public/licenses/walletconnect-community.txt` et accessible depuis la configuration de connexion.
