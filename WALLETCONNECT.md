# Connexion publique en lecture seule

Le parcours **Recevoir → Connecter mon portefeuille** ouvre un écran distinct pour Ethereum. Le bouton est disponible sur ETH, USDC et USDT. La session concerne Ethereum ; pour USDT et USDC, il s’agit des versions ERC20. L’ancien QR de dépôt reste une adresse de réception et n’est jamais remplacé silencieusement par un lien de connexion.

L’écran et la proposition envoyée au wallet portent le nom **Trust Send — lecture seule**, l’origine réelle du site et une icône propre au projet. Ils identifient le prototype indépendant. Les adresses partagées ne remplacent ni l’adresse de réception configurée, ni les soldes, ni les transactions locales.

## Activer le relais

Le Project ID public fourni pour ce projet est préconfiguré dans `src/concept/walletconnect-config.json`. Une nouvelle installation permet donc d’afficher le QR directement, sans saisie supplémentaire. Une configuration enregistrée sur l’appareil ou la variable de compilation `VITE_WALLETCONNECT_PROJECT_ID` reste prioritaire.

1. Créer un projet dans [Reown Dashboard](https://dashboard.reown.com/).
2. Autoriser l’origine utilisée, par exemple `https://trustsendplus.vercel.app`, dans la liste des domaines du projet.
3. Copier le **Project ID public WalletConnect**, constitué de 32 caractères hexadécimaux. Le client ID thirdweb de QrConnector2 n’est pas un Project ID WalletConnect.
4. Dans l’écran de connexion, ouvrir la roue de configuration, saisir cet identifiant et enregistrer. L’application conserve uniquement cet identifiant public sur l’appareil.

Pour préconfigurer l’hébergement, ajouter la variable publique de compilation `VITE_WALLETCONNECT_PROJECT_ID` dans Vercel, puis reconstruire. Aucune clé secrète n’est utilisée côté navigateur. Sans Project ID configuré, l’application affiche le formulaire et ne génère aucun faux QR.

L’infrastructure Reown reste nécessaire pour établir une vraie session. Un identifiant inconnu, un domaine non autorisé ou une panne réseau donnent un état d’erreur et un bouton Réessayer. L’application ne restaure pas automatiquement d’ancienne connexion.

## Autorisations et cycle de vie

Le client officiel `@walletconnect/sign-client` propose uniquement `eip155:1`, sans aucune méthode RPC (`methods: []`). L’adresse et le réseau sont lus dans les comptes partagés par la session. Les seuls événements suivis sont les changements de comptes, de réseau et de session. Le contrôleur n’expose aucune API de requête au portefeuille.

Les sessions accordant des méthodes de signature ou de transfert sont rejetées et déconnectées, y compris après une mise à jour de leurs autorisations. Les méthodes publiques `eth_accounts` et `eth_chainId`, éventuellement accordées par le wallet, sont tolérées mais ne sont pas appelées.

Le QR est généré localement depuis une URI WalletConnect v2 éphémère, après un clic explicite. Il expire au plus tard après cinq minutes ; Nouveau QR ferme la tentative précédente. Le refus, l’expiration et l’annulation retirent le QR. La fermeture de l’écran et Déconnecter ferment le relais et la session. Les résultats arrivant après fermeture sont ignorés et nettoyés.

Les clés de session et les liens de connexion restent dans une mémoire dédiée, sans restauration depuis localStorage. Les connexions ne sont pas copiées vers Firebase, un historique partagé ou le portefeuille de démonstration. QrConnector2 n’a pas été modifié ; son protocole de connexion a été repris avec des autorisations plus limitées, au lieu du connecteur thirdweb standard et de ses méthodes de signature.

## Vérifications

- `npm run verify:walletconnect` : proposition sans signature, origine réelle, stockage éphémère, validation des autorisations, refus et fermeture, résultats tardifs et changements de compte/réseau.
- `npm run verify:walletconnect-ui` : parcours dans le bundle de production, QR décodé indépendamment sur cinq tailles, configuration, copie, renouvellement, approbation, refus, expiration et isolation des soldes/adresses/historiques. Le relais et le wallet sont simulés pour ces tests ; ils ne prouvent pas une connexion à un wallet physique.
- `node scripts/verify-walletconnect-relay.cjs` : test réseau explicite avec le SDK et le relais réels, en servant le bundle local dans le contexte de `https://trustsendplus.vercel.app`. Vérifie le Project ID préconfiguré, l’acquittement de la proposition et le décodage du QR, puis annule. Il ne déploie rien, n’approuve aucun wallet et ne demande aucune transaction. L’option `--origin=https://votre-site` permet de vérifier une autre origine autorisée.
- La validation avec un wallet réel nécessite le Project ID du projet et une approbation explicite dans l’application du propriétaire.

Sources techniques : [Sign Client](https://docs.reown.com/advanced/api/sign/dapp-usage), [Namespaces WalletConnect](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces), [Project ID et domaines autorisés](https://docs.reown.com/cloud/relay).

Portions © 2025 Reown, Inc. All Rights Reserved. La licence livrée avec le SDK est conservée dans `public/licenses/walletconnect-community.txt` et accessible depuis l’écran de connexion.
