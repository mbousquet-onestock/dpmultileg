---
title: "Extension UI OneStock — notice technique"
subtitle: "Contexte d'appel, identifiants par environnement, appels API — modèle pour une nouvelle extension"
---

# 1. Vue d'ensemble

L'extension **Delivery promise** (`dpmultileg`) est une page web chargée dans une **iframe** du back office OneStock
(point d'injection `bo.page`). Elle sert de modèle pour toute autre extension :

| Couche | Rôle | Fichiers |
|---|---|---|
| Front (Vue 3 + TypeScript + Vite) | lit le contexte OneStock, ouvre une session, appelle **uniquement** le back de l'extension | `web/src/extension.ts`, `web/src/api.ts`, `web/src/App.vue` |
| Back (Node / Express) | stocke les identifiants API par site / environnement, génère le token OneStock, relaie les appels API | `server/src/*.ts` |
| Hébergement (Vercel) | front statique sur le CDN, `/api/*` dans une fonction serverless | `vercel.json`, `api/index.ts` |
| Base de données (Postgres Neon, SQLite en local) | identifiants chiffrés, réglages de l'extension | `server/src/db.ts` |

Règle de sécurité centrale : **le navigateur ne voit jamais ni le mot de passe ni le token OneStock**. Il ne possède
qu'un JWT de session court émis par le back de l'extension.

Séquence d'ouverture :

| # | De → vers | Échange |
|---|---|---|
| 1 | Back office → iframe | URL de l'extension + `?site_id&user_id&extension_id&parent_url…` |
| 2 | Iframe → back office | `postMessage({type: 'extension_ready'})` |
| 3 | Back office → iframe | `postMessage({type: 'onestock_data', data: {api_url, extension_signature…}})` |
| 4 | Iframe → back extension | `POST /api/session` (site, utilisateur, api_url, signature) |
| 5 | Back extension | lit les identifiants (site, environnement) en base, renvoie un JWT de session |
| 6 | Iframe → back extension | `GET/POST /api/…` avec `Authorization: Bearer <jwt>` |
| 7 | Back extension → OneStock | `POST /login` (une fois, token en cache), puis `GET /…` avec `{site_id, token, …}` |

# 2. Récupération du contexte d'appel

Référence OneStock : *UI Extensibility — How to develop UI Extensions* (Confluence DOCUMENTAT). Code : `web/src/extension.ts`.

## 2.1 Paramètres d'URL

OneStock ouvre l'iframe avec l'URL déclarée dans l'extension, complétée par :

| Paramètre | Exemple | Usage |
|---|---|---|
| `extension_id` | `6afc734f65e829c2464a6334` | identifiant de l'extension (signature) |
| `user_id` | `jdupont@client.com` | utilisateur connecté au back office |
| `site_id` | `p0038` | site OneStock — **clé de recherche des identifiants** |
| `lang`, `locale`, `timezone` | `fr`, `default`, vide | langue / format d'affichage |
| `parent_url` | `https://admin.eu1.qualif.onestock-retail.com` | **origine autorisée** pour les postMessage |
| `injection_point_path`, `host_app` | `/`, `backoffice` | point d'injection |

```ts
const KEYS = ['extension_id', 'user_id', 'site_id', 'lang', 'timezone', 'locale', 'parent_url', 'injection_point_path', 'host_app'];
export function readParams(search = window.location.search) {
  const q = new URLSearchParams(search);
  return Object.fromEntries(KEYS.flatMap((k) => (q.get(k) ? [[k, q.get(k)!]] : [])));
}
```

## 2.2 Échange `extension_ready` / `onestock_data`

L'extension envoie `extension_ready` au parent, qui répond `onestock_data`. On n'accepte que les messages venant de
l'origine de `parent_url`.

```ts
export function handshake(params, timeoutMs = 10_000): Promise<OnestockData> {
  const origin = params.parent_url ? new URL(params.parent_url).origin : undefined;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', onMessage); reject(new Error('handshake_timeout')); }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (origin && event.origin !== origin) return;                       // origine du back office uniquement
      if (event.data?.type !== 'onestock_data') return;
      clearTimeout(timer); removeEventListener('message', onMessage);
      resolve(event.data.data ?? {});
    }
    addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'extension_ready' }, origin ?? '*');
  });
}
```

`onestock_data` contient notamment :

| Champ | Usage |
|---|---|
| `api_url` | URL de l'API du site et de l'environnement (ex. `https://p0038.api.qualif.onestock-retail.com`) — **sert à déterminer l'environnement** |
| `extension_signature` | `t=<epoch>,h0=<hmac>,h1=…` (vérification optionnelle, § 3.5) |
| `host_app`, `injection_point_path`, `user_id`, `site_id`, `endpoint_id`… | selon le point d'injection |

Hors iframe (développement), l'échange est sauté (`window.parent === window`) et l'environnement est choisi à la main.

## 2.3 Redimensionnement

Le back office ajuste la hauteur de l'iframe sur demande :

```ts
new ResizeObserver(() => window.parent.postMessage({ type: 'extension_resize', height: document.documentElement.scrollHeight }, origin)).observe(document.body);
```

## 2.4 Ouverture de la session

Le front envoie le contexte au back (`POST /api/session`) :

```json
{ "site_id": "p0038", "user_id": "jdupont@client.com", "extension_id": "6afc…", "api_url": "https://p0038.api.qualif.onestock-retail.com",
  "extension_signature": "t=…,h0=…", "lang": "fr" }
```

Le back retrouve les identifiants (§ 3.3), puis renvoie un **JWT HS256** (1 h par défaut, audience propre à
l'extension) contenant `site_id`, `environment`, `api_url` **résolue côté serveur**, `sub` (utilisateur), `lang`.
Toutes les routes suivantes exigent `Authorization: Bearer <jwt>` ; sur un 401 le front rouvre la session une fois
et rejoue la requête.

Réponses d'erreur utiles au diagnostic : `400 missing_site_id`, `412 missing_credentials` (avec
`environment_guess` et `known_environments`, pour proposer la saisie des identifiants), `401 invalid_signature`.

# 3. Gestion des identifiants par site et environnement

## 3.1 Principe

Un **utilisateur API OneStock** (user / mot de passe) est enregistré pour chaque couple **(site_id, environnement)**,
ex. `p0038/qualif`, `p0038/prod`. Le back s'en sert pour appeler `POST /login` et obtenir le token. L'environnement
n'est **jamais** fourni par OneStock tel quel : il est déduit de `api_url`.

## 3.2 Stockage

Table (Postgres `dpm_credentials`, SQLite `credentials`) — clé primaire `(site_id, environment)` :

| Colonne | Contenu |
|---|---|
| `site_id`, `environment` | ex. `p0038`, `qualif` |
| `api_url` | URL API (optionnelle, sinon celle du contexte) |
| `user_id` | utilisateur API |
| `password_enc` | mot de passe **chiffré AES-256-GCM** : base64(iv 12 o + tag 16 o + chiffré) |
| `extension_secrets_enc` | secrets de signature chiffrés (optionnel) |
| `label`, `created_at`, `updated_at` | |

```ts
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);          // key() = CREDENTIALS_KEY (32 octets hex/base64)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
```

Les tables sont créées automatiquement au premier appel (`CREATE TABLE IF NOT EXISTS`). Le préfixe `dpm_` évite les
collisions si plusieurs extensions partagent la même base : **changer le préfixe pour une nouvelle extension**.

## 3.3 Résolution de l'environnement (`resolveCredential`)

1. ligne du site dont `api_url` a la **même origine** que l'`api_url` du contexte ;
2. sinon, environnement **déduit du nom d'hôte** : premier label parmi `qualif, training, preprod, staging, sandbox,
   demo, dev, prod` (ex. `p0038.api.qualif.onestock-retail.com` → `qualif`) ;
3. sinon, environnement demandé explicitement (mode autonome / développement).

Sécurité : les identifiants ne sont envoyés qu'à l'`api_url` enregistrée, ou à celle du contexte **si son hôte
correspond à `ALLOWED_API_HOST`** (par défaut `*.onestock-retail.com|dev`, https uniquement).

## 3.4 Saisie (onglet caché « Configuration »)

Routes `/api/admin/*` :

| Route | Usage |
|---|---|
| `GET /admin/credentials?site_id=` | liste (jamais de mot de passe renvoyé) |
| `PUT /admin/credentials/:site/:env` | création / mise à jour `{user_id, password, api_url?, label?}` |
| `DELETE /admin/credentials/:site/:env` | suppression (vide aussi les caches du site) |
| `POST /admin/credentials/test` | `POST /login` d'essai avant enregistrement |
| `GET/PUT /admin/settings/:site/:env` | réglages de l'extension (JSON libre) |

Protection : si `ADMIN_TOKEN` est défini, il faut `Authorization: Bearer <ADMIN_TOKEN>` (ou une session signée du même
site). Sans `ADMIN_TOKEN`, l'écran est ouvert — à réserver à un back office dont l'accès à l'extension est déjà
limité par rôle.

## 3.5 Signature de l'extension (optionnelle)

`VERIFY_SIGNATURE=true` active la vérification : `h = HMAC-SHA256(secret, "<t>.<extension_id>##<user_id>")` en hex,
comparée aux `h0, h1…` reçus, avec `|now − t| ≤ 6 h`. Les secrets sont stockés chiffrés avec les identifiants.
Désactivée dans cette extension (choix du projet) : la session s'ouvre sur le site / environnement transmis.

# 4. Utilisation des API OneStock

## 4.1 Token

```ts
// POST /login {site_id, user_id, password} -> {token}
const tokens = new Map<string, Promise<string>>();               // clé : site|env|api_url
function getToken(t, force = false) { /* cache ; force après un 401 */ }
```

Le token est mis en cache en mémoire par site / environnement. Sur un **401**, le back se reconnecte **une fois** et
rejoue l'appel. Sur Vercel, le cache est perdu à chaque démarrage à froid de la fonction (nouveau login).

## 4.2 Format des appels : GET avec corps JSON

Les routes de lecture OneStock prennent leurs paramètres **dans un corps JSON, y compris en GET**, avec
`site_id` et `token`. `fetch` ne sait pas envoyer de corps en GET : on utilise `node:https` directement.
(`POST` + `X-HTTP-Method-Override` n'est pas accepté par toutes les routes, ex. `GET /timetables/{id}`.)

```ts
function httpCall(url, method, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), {
      method, timeout: 30_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, requestId: res.headers['request-id'], text: Buffer.concat(c).toString() })); });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(body); req.end();
  });
}

export async function callOnestock(t, method, path, body = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(t, attempt > 0);
    // chemin versionné (/v3/items) : remplace la version éventuelle en fin d'api_url
    const base = /^\/v\d+\//.test(path) ? t.api_url.replace(/\/v\d+\/?$/, '') : t.api_url;
    try { return await rawCall(base, method, path, { ...body, site_id: t.site_id, token }); }
    catch (e) { if (e.status === 401 && attempt === 0) continue; throw e; }
  }
}
```

Exemple (Postman équivalent) :

```json
GET {{url}}/timetables/{id}
{ "site_id": "{{site_id}}", "token": "{{token}}", "fields": ["id","name","type","hours","current_timetable","routes"] }
```

## 4.3 Le back comme proxy

Le front n'appelle **jamais** OneStock directement : chaque besoin est une route du back (`/api/items/search`,
`/api/stocks`, …) qui lit le JWT, appelle `callOnestock` avec la cible de la session et renvoie un JSON simplifié.
Avantages : pas de CORS, pas de token exposé, mise en cache et journalisation centralisées.

```ts
r.post('/items/search', wrap(async (req, res) => {
  const t = target(req.session!);                       // {site_id, environment, api_url} du JWT
  const result = await callOnestock(t, 'GET', '/v3/items', { pattern: req.body.pattern, pagination: { start: 0, limit: 10 } });
  res.json({ items: asList(result, 'items') });
}));
```

## 4.4 Bonnes pratiques retenues

| Sujet | Pratique |
|---|---|
| Listes | `asList(res, 'endpoints')` accepte `{endpoints: [...]}`, `[...]` ou un objet indexé |
| Pagination | `pagination: {start, limit: 100}` jusqu'à une page incomplète |
| Champs | demander explicitement `fields` (ex. `/v3/items` : `weight`, `length`… sont des champs, pas des features) |
| Formats variables | normaliser à la lecture (ex. `endpoints.execution_times` liste **ou** objet `{opération: id}`) |
| Droits (ACL) | prévoir un repli par route (403) : détail → liste, export → route simple ; signaler sans bloquer |
| Parallélisme | appels indépendants en `Promise.all`, lots de 10 à 20 appels simultanés |
| Caches | référentiel en mémoire par site / env (TTL `REFERENTIAL_CACHE_SECONDS`), données volatiles 1 min au plus |
| Erreurs | renvoyer au front `{error, message, request_id}` + le `request-id` OneStock pour le support |

## 4.5 API utilisées par cette extension

| Moment | API |
|---|---|
| Session | `POST /login` |
| Référentiel | `GET /delivery_configs`, `/delivery_routes`, `/zones`, `/sales_channels`, `/endpoints`, `/execution_times/{id}`, `/timetables/{id}`, `/delivery_restrictions/{id}`, `/configurations` (keys `stock`) |
| Articles | `GET /v3/items` |
| Promesse | `GET /stock_export` (request_name = `stock_request` de la méthode), `/stocks` (secours), `/capacities` |

Le détail fonctionnel (ordre, paramètres, calcul) est dans `docs/spec-delivery-promise.pdf`.

# 5. Hébergement Vercel

## 5.1 Structure

```json
{
  "buildCommand": "npm run build:web", "outputDirectory": "web/dist",
  "functions": { "api/index.ts": { "maxDuration": 30 } },
  "rewrites": [ { "source": "/api/:path*", "destination": "/api" }, { "source": "/((?!api/).*)", "destination": "/index.html" } ],
  "headers": [ { "source": "/(.*)", "headers": [
    { "key": "Content-Security-Policy", "value": "frame-ancestors 'self' https://*.onestock-retail.com https://*.onestock-retail.dev" } ] } ]
}
```

- `frame-ancestors` autorise l'affichage **dans le back office OneStock uniquement**.
- `api/index.ts` charge l'application Express en import dynamique : une erreur de démarrage est renvoyée en JSON
  lisible au lieu de la page Vercel opaque.
- Pas de disque persistant : base **Postgres** obligatoire (Neon via le Marketplace Vercel, `DATABASE_URL`).

## 5.2 Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | oui (Vercel) | base Postgres |
| `CREDENTIALS_KEY` | oui | clé de chiffrement des mots de passe (32 octets hex ou base64) — **ne jamais changer** sans ré-enregistrer les identifiants |
| `JWT_SECRET` | oui | signature des JWT de session |
| `ADMIN_TOKEN` | non | protège l'écran Configuration |
| `VERIFY_SIGNATURE`, `ALLOW_UNSIGNED` | non | vérification de la signature OneStock |
| `ALLOWED_API_HOST`, `FRAME_ANCESTORS` | non | hôtes API autorisés, origines d'intégration |
| `REFERENTIAL_CACHE_SECONDS`, `JWT_TTL_SECONDS` | non | caches, durée de session |
| `MOCK_ONESTOCK` | non | données de démonstration sans appel OneStock |

Une variable obligatoire absente ne fait pas planter la fonction : l'API répond **503 `server_misconfigured`** avec la
liste des problèmes, visible aussi sur `GET /api/health`.

Générer les secrets :

```bash
openssl rand -hex 32
```

# 6. Diagnostic

- `GET /api/health` : stockage (`postgres`/`sqlite`), sites / environnements configurés, variables manquantes, commit.
- Journaux JSON (Vercel → Logs) : `session_request`, `onestock_login`, `onestock_call` (route, statut, durée,
  `request-id` OneStock), `referential_step_failed`…
- En cas d'erreur, l'écran affiche un rapport copiable (étape, version, contexte, réponse serveur, santé du serveur).

# 7. Créer une nouvelle extension à partir de ce modèle

1. **Dupliquer** le dépôt ; garder `web/src/extension.ts`, `web/src/api.ts` (requête + renouvellement de session),
   `server/src/{config,crypto,credentials,db,session,signature,onestock,logger,app}.ts`, `api/index.ts`, `vercel.json`,
   l'écran Configuration (identifiants) et le design system (`web/src/ds`).
2. **Renommer** : audience du JWT (`setAudience('dpmultileg')` dans `session.ts`), préfixe des tables (`dpm_`),
   nom de l'application.
3. **Supprimer le métier** : `shared/` (moteur de promesse), routes `/referential`, `/stocks`, `/capacities`,
   composants de résultats.
4. **Ajouter les routes métier** dans `server/src/routes.ts` sur le modèle du § 4.3 (une route du back par besoin,
   `requireSession` en tête, `callOnestock` pour OneStock).
5. **Déployer sur Vercel** : nouveau projet, Neon Postgres, `CREDENTIALS_KEY` et `JWT_SECRET` neufs.
6. **Déclarer l'extension dans OneStock** (back office, UI Extensibility) : URL Vercel, point d'injection, rôles.
7. **Ouvrir l'extension** depuis le back office : au premier passage la session échoue en `412 missing_credentials` ;
   ouvrir la Configuration (roue dentée), où le site et l'environnement détecté sont pré-remplis, saisir l'utilisateur
   API, tester la connexion, enregistrer : la session redémarre automatiquement.
8. Vérifier `GET /api/health`, puis les journaux `onestock_call`.

Checklist sécurité : utilisateur API dédié avec droits minimaux (ACL limitées aux routes appelées), `ADMIN_TOKEN` ou
accès à l'extension restreint par rôle, `frame-ancestors` limité à OneStock, aucun token ni mot de passe côté
navigateur, `ALLOWED_API_HOST` limité aux hôtes OneStock.
