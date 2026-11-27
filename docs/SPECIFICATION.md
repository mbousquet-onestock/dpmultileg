---
title: "Delivery promise — spécification fonctionnelle et technique"
subtitle: "Extension UI OneStock · promesse de livraison multi-legs recalculée localement · règles de gestion et API"
---

# Partie A — Spécification fonctionnelle

## A1. Objet

L'extension **Delivery promise**, ouverte depuis le back office OneStock, permet de **simuler la promesse de
livraison** d'une commande : l'utilisateur choisit des articles et une destination, l'extension affiche pour chaque
mode de livraison la date estimée, les frais de port, le coût transporteur, l'empreinte carbone, le nombre
d'expéditions, puis le **schéma logistique** retenu (routes, étapes, articles par route, transferts) et les raisons
des choix et des exclusions.

La promesse est **recalculée localement** à partir de la configuration OneStock, du stock et des capacités.
L'API `/delivery_promises` n'est pas utilisée.

## A2. Utilisateurs et accès

| Profil | Accès |
|---|---|
| Utilisateur back office | onglet de simulation (articles, options, résultats, schéma) |
| Administrateur de l'extension | onglet caché **Configuration** (roue dentée) : identifiants API, priorités par mode, options d'affichage |

L'accès à l'extension est réglé dans OneStock (rôles autorisés sur le point d'injection).

## A3. Parcours

1. **Ouverture** : l'extension lit son contexte (site, environnement, utilisateur) et charge la configuration
   logistique (rapport de chargement disponible en option d'affichage).
2. **Articles** : recherche (5 résultats par page, bouton « 5 de plus »), saisie de la quantité, ajout, retrait.
   La carte article affiche l'identifiant et le poids.
3. **Options** :
   - canal de vente ;
   - destination : **adresse** (pays, code postal, région, fuseau), **zone**, ou **lieu de stock** (magasin) ;
   - prix de la commande (optionnel, sinon somme des prix des articles) ;
   - modes de livraison à tester (optionnel, sinon tous ceux du canal) ;
   - date et heure de commande (optionnel, sinon maintenant) ;
   - **consolidation** : livrer en un minimum de colis.
4. **Tester la promesse de livraison** : une carte par mode de livraison.
5. **Sélection d'une option** : affichage du schéma logistique.

## A4. Résultat par mode de livraison

| Information | Règle |
|---|---|
| Statut | **Disponible** (tous les articles servis), **Partielle** (une partie), **Indisponible** (aucun) avec la raison |
| Livraison estimée | fourchette « au plus tôt – au plus tard » ; une seule date si identiques ; « jour, heure – heure » le même jour |
| Commander avant | heure limite (cutoff transporteur moins la durée des opérations à faire avant) |
| Frais de port | somme des `shipping_fees` des lignes de grille de coûts utilisées |
| Coût transporteur | somme des `cost_by_parcel` des lignes de grille utilisées (transferts compris) |
| Empreinte carbone | somme des `carbon_footprint` des lignes utilisées (transferts compris), en gCO₂ |
| Expéditions | nombre de colis (« 1 expédition », « 2 expéditions ») |
| Click & collect | liste déroulante **Magasin de retrait** (voir A5.9) |

Raisons d'indisponibilité : configuration absente pour la destination / le canal / le mode, article inconnu, aucune
route éligible, stock insuffisant, nombre d'expéditions autorisé dépassé.

## A5. Règles de gestion

### A5.1 Choix de la configuration du mode

- **RG-01** — Pour un mode et un canal de vente, la delivery_config retenue est celle dont une **zone de livraison**
  (`delivery_zone_ids`) contient la destination ; à défaut une configuration sans zone ; sinon le mode est
  « non configuré ».
- **RG-02** — Les **transporteurs** autorisés sont ceux de `carriers` (nom + option). **Chaque étape** d'un schéma,
  transferts compris, doit utiliser l'un d'eux (ex. Standard : GLS standard, pas GLS express).
- **RG-03** — Les **restrictions** appliquées sont uniquement celles listées dans `applied_restrictions`.
- **RG-04** — Le nombre maximal d'expéditions est `authorized_shipment_number` (4 par défaut).
- **RG-05** — La requête de stock du mode est `stock_request` (`detailed` par défaut).

### A5.2 Schémas logistiques candidats

- **RG-10** — Un schéma est une chaîne de **1 à 3 routes** : la dernière arrive dans une zone contenant la
  destination, chaque route part d'une zone reliée à l'arrivée de la précédente, sans repasser par une zone déjà
  traversée.
- **RG-11** — Au plus 50 schémas par mode, les plus courts d'abord.
- **RG-12** — Appartenance à une zone : lieu inclus / exclu explicitement d'abord, puis zones incluses / exclues
  (récursif), puis critères pays, régions, code postal (expression régulière), codes postaux exclus, fuseaux : tous
  les critères renseignés doivent correspondre.

### A5.3 Exclusions d'un article sur un schéma

Un article est exclu d'un schéma pour l'une des raisons suivantes (visibles via **« Origine de l'exclusion »**) :

- **RG-20 Restriction** — une restriction appliquée vise un transporteur du schéma (`carrier_blacklist`) et
  l'article correspond à son filtre :
  - catégorie (`category`, y compris sous-catégories `cat>sous-cat`) ;
  - caractéristique (`feature`) : `{ "weight": [{ "op": "gt", "value": 30 }] }` ; opérateurs `eq, ne, gt, gte, lt,
    lte, in, nin, exists` ; le **poids et les dimensions** sont lus sur les champs de la fiche article
    (prioritaires sur les caractéristiques) ;
  - **SKU** : `{ "sku": [{ "op": "eq", "value": "0136-5401099" }] }` ou listes `sku / ids / item_ids` : seuls les
    articles dont l'`id`, l'`item_id` ou le `sku` correspond sont exclus ;
  - un filtre vide vise tous les articles.
- **RG-21 Grille de coûts** — aucune ligne de la grille de coûts de la route n'accepte l'article : contraintes colis
  (`parcel_constraints` : `W`/`sumW` poids total, `qty`, dimensions `d1 d2 d3` max, volume) et commande
  (`order_constraints` : `price`, `qty`, `weight`). Une contrainte non évaluable (donnée article absente) est
  ignorée et signalée.
- **RG-22 Stock** — aucun lieu de la zone d'origine n'a la quantité (stock disponible ou futur, A5.5).
- **RG-23 Timetable** — aucun créneau d'enlèvement, de transit ou de livraison dans l'horizon de calcul (8 semaines).

Un schéma est **non éligible** si **tous** les articles en sont exclus ; il est affiché dans le groupe
« Routes non éligibles ».

### A5.4 Ligne de grille de coûts

- **RG-30** — Pour chaque route, la ligne retenue est la première dont toutes les contraintes évaluables sont
  respectées, en privilégiant celle qui a le moins de contraintes non évaluables ; elle est testée sur l'ensemble de
  la commande, sinon article par article.
- **RG-31** — Coût, frais de port et carbone viennent des `metric_values` de cette ligne.

### A5.5 Stock

- **RG-40** — Types de stock du site (`/configurations`, clé `stock`) : `stock.on_hand` = **disponible** ; les autres
  `stock.types` (ex. `asn`) = **stock futur** quand la ligne porte `eta_start` / `eta_end` ; tout autre type est
  ignoré.
- **RG-41** — Stock futur : la quantité est disponible au plus tôt à `eta_start`, au plus tard à `eta_end` ; les lignes
  sont cumulées par date d'arrivée jusqu'à couvrir la quantité.
- **RG-42** — Le stock disponible est utilisé en priorité ; un schéma servi par du stock futur passe **après** ceux
  servis par du stock disponible.
- **RG-43** — Stock illisible : la disponibilité n'est pas vérifiée (alerte), le calcul continue.

### A5.6 Calcul des dates

Pour un lieu d'expédition donné, sur deux pistes (« au plus tôt » et « au plus tard ») :

- **RG-50** — Départ : date de commande, puis opérations `always_at_start` (ex. Paiement) sur leur calendrier.
- **RG-51** — Disponibilité du stock (RG-41).
- **RG-52** — Préparation : opérations `before_shipping` au lieu d'expédition. Durée = temps d'exécution du lieu
  (`endpoints.execution_times`) sinon de la configuration (`global_execution_times`) ; calendrier = timetable
  d'exécution du temps d'exécution, sinon horaires d'ouverture du lieu, sinon 24/7. Durée illisible = 0 (signalée).
- **RG-53** — Pour chaque route : prochain **cutoff transporteur** (timetable pickup), puis **transit** en heures
  comptées uniquement les jours de roulage (timetable transit, `minimum_transit_hours` pour la piste au plus tôt,
  `maximum_transit_hours` au plus tard), puis prochain **créneau de livraison** (timetable delivery) : début du
  créneau au plus tôt, fin au plus tard. Sans timetable, pas de contrainte.
- **RG-54** — Réception : opérations `after_shipping` (ex. réception C&C) au lieu de destination.
- **RG-55** — Plages horaires contiguës fusionnées (les timetables OneStock finissent à :59 / :01).
- **RG-56** — Commander avant = fin du créneau d'enlèvement − durée des opérations avant enlèvement.

### A5.7 Capacités

- **RG-60** — **Préparation** d'un lieu de stock (en lignes de commande) : si le restant du jour est inférieur au
  nombre de lignes de l'expédition, la préparation passe au jour suivant, puis au suivant, jusqu'au premier jour
  disponible (90 jours maximum).
- **RG-61** — **Chargement transporteur** (en colis, transporteur de la première route au lieu d'expédition) : jour
  plein → enlèvement suivant. Un colis par expédition.
- **RG-62** — Restant du jour = (`capacities`, sinon `defaults`) − `consumed` ; `+Inf` = illimité ; capacité inconnue
  ou en erreur = illimitée.
- **RG-63** — Les capacités s'appliquent aux expéditions, aux **transferts** de consolidation, au colis regroupé et au
  click & collect préparé en magasin. Chaque report est affiché (« Capacité atteinte : date reportée »).

### A5.8 Choix du schéma et allocation

- **RG-70** — Lieu d'expédition d'un schéma : parmi les lieux de la zone d'origine ayant le stock, celui qui livre le
  plus tôt (l'orchestrateur choisira entre lieux équivalents).
- **RG-71** — Tri des schémas selon les **priorités du mode** : réglage de l'extension, sinon champ de priorité de la
  configuration, sinon date de livraison au plus tard. Préréglages : plus rapide ; moins cher puis plus rapide
  (Standard) ; plus rapide puis moins cher ; plus vert puis plus rapide. Valeurs **réelles** (dates calculées, coût
  de la grille).
- **RG-72** — **Dédoublonnage** : un seul schéma par suite identique (transporteurs + zones), le premier sans exclusion.
- **RG-73** — Allocation : une seule expédition si un schéma et un lieu servent tous les articles ; sinon découpage
  (meilleur schéma servant le plus d'articles d'abord) dans la limite de RG-04 ; articles restants = non servis
  (statut Partielle).
- **RG-74** — Date de la promesse = date la plus tardive des expéditions ; coûts et carbone additionnés.

### A5.9 Click & collect

- **RG-80** — Mode click & collect : configuration dont le type, le code ou le nom évoque le retrait
  (ckc, click, collect, pickup, retrait, store_delivery).
- **RG-81** — Les articles **en stock dans le magasin de retrait** y sont préparés **sans transport**
  (opérations `from_destination`, capacité de préparation du magasin) ; seuls les autres sont expédiés au magasin.
  Le colis préparé en magasin compte pour une expédition ; la date est la plus tardive des deux.
- **RG-82** — Si les autres articles ne peuvent pas être expédiés au magasin : statut Partielle, articles du magasin seuls.
- **RG-83** — Liste **Magasin de retrait** : lieux de stock des zones de livraison du mode, triés par proximité de
  l'adresse (même pays, puis code postal au plus long préfixe commun, puis écart de code postal). Avec une adresse,
  le magasin **le plus proche** est retenu par défaut ; choisir un autre magasin recalcule ce mode seul.

### A5.10 Consolidation (option)

- **RG-90** — Si l'option est cochée et que plusieurs colis seraient nécessaires (ou des articles non servis) :
  recherche d'un **point de consolidation** (lieu de la zone d'origine d'un schéma final éligible pour tous les
  articles, avec une ligne de grille acceptant le colis regroupé).
- **RG-91** — Les articles absents du point y sont **transférés** depuis un lieu qui les a en stock, par des routes
  (1 ou 2 étapes) des **transporteurs du mode** ; le transfert le plus rapide est retenu.
- **RG-92** — Le colis regroupé part du point quand tout est arrivé et préparé ; une seule expédition.
- **RG-93** — Meilleur point selon les priorités du mode (date, coût total transferts compris), puis le moins de
  transferts. Aucun point possible : allocation normale conservée (« consolidation impossible »).
- **RG-94** — Non appliquée au click & collect servi en partie par le stock du magasin (les articles y sont déjà
  regroupés).

## A6. Affichage du schéma logistique

- En-tête : livraison estimée, commander avant, frais de port, coût transporteur, expéditions.
- **Routes éligibles** (sélectionnées d'abord, badge « Route sélectionnée » et numéro d'expédition) : chaîne
  origine → étapes → destination, transporteur et transit par étape, articles portés par chaque expédition. Route
  consolidée : segments « Transfert vers le point de consolidation » puis « Livraison au client ».
- Bouton **« Pourquoi non retenue ? »** sur une route éligible non retenue : critère de priorité décisif.
- **Routes non éligibles** : badge « Non éligible », bouton **« Origine de l'exclusion »** (détail par article).
- Encadrés : retrait sur stock magasin, stock futur utilisé (« Arrivée de 10 × article à … (ASN PO_001) »),
  capacité atteinte, stock non vérifié, durées d'opération inconnues.

## A7. Configuration (onglet caché)

| Section | Contenu |
|---|---|
| Identifiants API | utilisateur / mot de passe par site et environnement, test de connexion |
| Priorités par mode | préréglage par mode de livraison, enregistré en base, appliqué immédiatement |
| Options d'affichage (masquées par défaut) | rapport de chargement et durées du dernier test, méthode de calcul / transporteurs / zones / priorités, résumé de consolidation, chronologie détaillée, détail du choix |

<div style="break-before: page"></div>

# Partie B — Spécification technique

## B1. Architecture

| Élément | Technologie | Rôle |
|---|---|---|
| Front | Vue 3, TypeScript, Vite, design system OneStock | interface, **moteur de calcul** (exécuté dans le navigateur) |
| Back | Node, Express 5 | session, identifiants, relais des appels OneStock, caches |
| Code partagé | `shared/` | `promise.ts` (moteur), `logistics.ts` (zones, schémas, priorités), `timetables.ts` (calendriers, opérations), `normalize.ts` |
| Hébergement | Vercel : front statique + fonction `api/index.ts` | CSP `frame-ancestors` limitée à OneStock |
| Base | Postgres (Neon) ; SQLite en local | identifiants chiffrés (AES-256-GCM), réglages |

Détail du contexte d'appel, des identifiants et de l'hébergement : `docs/NOTICE_TECHNIQUE.md`.

## B2. Contexte et session

1. Paramètres d'URL (`site_id`, `user_id`, `extension_id`, `lang`, `parent_url`…).
2. `postMessage` `extension_ready` → réponse `onestock_data` (`api_url`, `extension_signature`).
3. `POST /api/session` : identifiants retrouvés par site + environnement déduit de `api_url` → JWT de session (1 h).
4. Le back génère le token OneStock (`POST /login`), le met en cache et le régénère sur 401.

Tous les appels OneStock sont des **GET avec corps JSON** (`site_id`, `token`, paramètres), émis par le back.

## B3. API OneStock utilisées

### B3.1 Ouverture — chargement du référentiel (`GET /api/referential`, cache par site / environnement)

| # | API | Paramètres | Usage | Repli |
|---|---|---|---|---|
| 0 | `POST /login` | site_id, user_id, password | token | — |
| 1 | `GET /delivery_configs` | — | modes, zones, transporteurs, opérations, `global_execution_times`, `applied_restrictions`, `stock_request`, `authorized_shipment_number` | — |
| 2a | `GET /delivery_routes` | — | groupes de routes (`public_id`, transporteur, timetables) et lignes de grille (`parcel_constraints`, `order_constraints`, `metric_values`) | — |
| 2b | `GET /zones` | — | zones | — |
| 2c | `GET /sales_channels` | — | canaux, devise | optionnel |
| 2d | `GET /endpoints` | fields `_id, name, classification, timezone, address, opening_hours, execution_times` ; pages de 100 | lieux de stock | — |
| 3 | `GET /execution_times/{id}` | ids de `global_execution_times` et des lieux | durées et calendriers des opérations | liste `GET /execution_times` si 403 |
| 4 | `GET /timetables/{id}` | fields `id, name, type, hours, current_timetable, routes` | pickup / transit / delivery / execution_time_timetable | liste filtrée par type si 403 |
| 5 | `GET /delivery_restrictions/{id}` | ids de `applied_restrictions` | restrictions | — |
| 6 | `GET /configurations` | keys `["stock"]`, scopes `{site: true}` | types de stock | comportement par défaut |

2a–2d en parallèle ; 3 et 4 par lots de 10 appels.

### B3.2 Articles

| API | Paramètres | Usage |
|---|---|---|
| `GET /v3/items` | `pattern` ou `filters.ids`, `lang`, `pagination`, `features` (name, image, price…), `fields` (`weight, length, width, height, product_id, is_default, category_ids`) | recherche, fiche, poids / dimensions |
| `GET /endpoints` | `name` ou `endpoint_ids` | destination « lieu de stock » |

### B3.3 Test de la promesse

| Ordre | API | Paramètres | Usage |
|---|---|---|---|
| 1 (parallèle) | `GET /v3/items` | articles sans poids chargé | recharge des données physiques |
| 1 (parallèle) | `GET /stock_export` | `request_name` = `stock_request` du mode ; `aggregates: {"*": {item_filter: {ids}}}` | stock disponible et futur ; une requête par `stock_request` distinct |
| secours | `GET /stocks` | `item_ids`, `endpoint_ids` (par 400) | si `/stock_export` échoue |
| 2 | — | — | premier calcul local |
| 3..n | `GET /capacities` | `links` (`endpoint` ; `endpoint` + `carrier`), `at_date`, `locale`, `location` | capacités des jours envisagés ; nouveau calcul après chaque série |

Exemples :

```json
GET /stock_export   { "request_name": "detailed_ois", "aggregates": { "*": { "item_filter": { "ids": ["00004"] } } } }
-> { "item_id": "00004", "endpoint_id": "warehouse_lyon_saint_priest", "quantity": 10, "type": "asn",
     "eta_start": 1797202800, "eta_end": 1797375600, "purchase_order_number": "PO_001" }

GET /capacities     { "links": [ { "type": "endpoint", "entity_id": "store_paris_5" }, { "type": "carrier", "entity_id": "GLS" } ],
                      "at_date": "1795046400", "locale": "fr_FR", "location": "Europe/Paris" }
-> { "capacity": { "date": 1795046400, "capacities": 3, "defaults": "+Inf", "consumed": 0 } }
```

### B3.4 Routes du back de l'extension

| Route | Rôle |
|---|---|
| `POST /api/session` | ouverture de session (JWT) |
| `GET /api/referential[?refresh=1]` | référentiel + rapport de chargement + réglages |
| `POST /api/items/search` | `/v3/items` |
| `POST /api/endpoints/search` | `/endpoints` |
| `POST /api/stocks` | types de stock + `/stock_export` (+ `/stocks` en secours), normalisés |
| `POST /api/capacities` | lot de requêtes `/capacities` (20 en parallèle, cache 1 min par lieu / transporteur / jour) |
| `GET /api/health` | santé (stockage, configuration, version) |
| `/api/admin/credentials…`, `/api/admin/settings…` | identifiants et réglages |

## B4. Normalisation des données

| Donnée | Règle |
|---|---|
| Routes | groupes `/delivery_routes` → routes logiques (`id` = `public_id`) portant leurs lignes de grille (`variants`) |
| Timetables | plages en secondes depuis lundi 00:00 dans le fuseau de la timetable ; `current_timetable` prioritaire ; rôle d'après le type (pickup / transit / delivery), sinon le nom du champ (`opening_timetable_id` = transit) |
| Articles | caractéristiques de la langue complétées par les autres langues ; champs article (`weight`…) prioritaires sur les caractéristiques |
| Lieux de stock | `execution_times` en liste ou en objet `{opération: id}` → `[{id, operation}]` |
| Stock | lignes extraites de toute forme de réponse ; dates en secondes, millisecondes ou ISO ; types appliqués (RG-40) |
| Listes | `{endpoints: [...]}`, `[...]` ou objet indexé acceptés |

## B5. Moteur de calcul (`shared/promise.ts`)

Entrée `PromiseInput` : canal, lignes, destination, modes, date, configurations, routes, contexte de zones, restrictions,
articles, stock (par `stock_request`), prix, timetables, temps d'exécution, réglages, consolidation, fonction de capacité.

Pour chaque mode (`computeOption`) :

1. configuration (RG-01) ; article inconnu → indisponible ;
2. schémas (`buildSchemas`, RG-10/11) ;
3. analyse par schéma : exclusions (RG-20…23), ligne de grille (RG-30), stock par lieu (`availability`, RG-40…42) ;
4. chronologie par lieu candidat (`timeFrom` : opérations + `timeLegs` + capacités `capacityTimed`), meilleur lieu
   (RG-70) — les lieux sont d'abord classés sans capacité, puis évalués avec capacité tant qu'ils peuvent encore
   faire mieux ;
5. tri (priorités, stock futur après), dédoublonnage (RG-71/72) ;
6. click & collect sur stock magasin (RG-81) ;
7. allocation (RG-73), chronologie recalculée par expédition (lieu et articles propres) ;
8. consolidation (RG-90…93) ;
9. résultat : statut, dates, cutoff, coûts, carbone, routes avec articles, stock futur et reports de capacité.

Capacités : le moteur interroge une fonction `capacity({kind, endpoint, carrier, at, timezone, needed})` ; une valeur
inconnue est traitée comme illimitée et notée ; le front lit les jours manquants (`/api/capacities`), lit d'avance les
7 jours suivant un jour plein, et relance le calcul jusqu'à ce qu'aucun jour ne manque.

## B6. Performances

| Sujet | Mesure |
|---|---|
| Référentiel | cache serveur (TTL `REFERENTIAL_CACHE_SECONDS`) et navigateur, hors réactivité Vue |
| Stock | un `/stock_export` par `stock_request`, en parallèle avec la recharge des articles |
| Capacités | seulement pour les lieux pouvant être les meilleurs ; 20 appels simultanés ; cache 1 min |
| Calcul | index du stock par lieu / article ; mémorisation des lieux par zone, timetables par route, plages ouvertes par semaine, décalages horaires ; ~4 ms pour 300 magasins |
| Mesure | durées du dernier test (stock, capacités, nombre d'appels, calcul) avec l'option « rapport de chargement » |

## B7. Erreurs et limites

- Droits (ACL) insuffisants : replis (B3.1), étape signalée dans le rapport ; capacité inconnue = illimitée ; stock
  illisible = non vérifié.
- Erreurs renvoyées en JSON `{error, message, request_id}` + `request-id` OneStock ; rapport copiable à l'écran.
- Variables d'environnement manquantes : 503 `server_misconfigured`.
- Approximations : 1 colis par expédition, 1 ligne par article ; proximité des magasins par code postal (pas de
  géolocalisation) ; horizon des calendriers 8 semaines ; le choix final entre lieux équivalents revient à
  l'orchestrateur.

## B8. Tests

93 tests automatisés (`npm test`) : zones et schémas, timetables (cutoff, transit, créneaux, fusion, fuseaux),
opérations, grilles de coûts et poids, restrictions (poids, SKU), priorités, dédoublonnage, stock futur, capacités
(préparation, transporteur, jours successifs, transferts, C&C), consolidation, click & collect partiel, API serveur
(session, identifiants, normalisations).
