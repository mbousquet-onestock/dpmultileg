import { ref } from 'vue';

const fr = {
  title: 'Promesse de livraison multi-leg',
  subtitle: 'Simulez une commande et visualisez le schéma logistique de chaque option de livraison',
  items: 'Articles',
  addItem: 'Ajouter un article',
  searchItems: 'Rechercher un article (nom, référence)',
  noItem: 'Aucun article trouvé',
  quantity: 'Quantité',
  add: 'Ajouter',
  remove: 'Retirer',
  close: 'Fermer',
  options: 'Options',
  salesChannel: 'Canal de vente',
  salesChannelHint: 'Choisissez le canal de vente à utiliser',
  salesChannels: 'Canaux de vente',
  destination: 'Destination',
  destinationHint: 'Indiquez la destination',
  address: 'Adresse',
  zone: 'Zone',
  stockLocation: 'Lieu de stock',
  country: 'Pays',
  selectCountry: 'Choisir un pays',
  zipCode: 'Code postal (optionnel)',
  region: 'Région (optionnel)',
  timezone: 'Fuseau horaire (requis si défini dans la zone de livraison)',
  selectZone: 'Choisir une zone',
  selectStockLocation: 'Choisir un lieu de stock',
  orderPrice: 'Prix de la commande',
  orderPriceHint: 'Modifier le prix de la commande',
  deliveryMethod: 'Mode de livraison',
  deliveryMethodHint: 'Limiter le test à un ou plusieurs modes de livraison',
  allMethods: 'Tous les modes du canal',
  dateTime: 'Date et heure',
  dateTimeHint: 'Simuler un test à une date et heure future',
  test: 'Tester la promesse de livraison',
  results: 'Options de livraison',
  resultsHint: 'Sélectionnez une option pour afficher son schéma logistique',
  noResult: 'Lancez un test pour afficher les options de livraison possibles',
  status_valid: 'Disponible',
  status_valid_estimation: 'Disponible (estimé)',
  status_partial: 'Partielle',
  status_partial_estimation: 'Partielle (estimée)',
  status_none: 'Indisponible',
  eta: 'Livraison estimée',
  cutoff: 'Commander avant',
  cost: 'Coût estimé',
  carbon: 'Empreinte carbone',
  shipments: 'Expéditions',
  shipment: 'Expédition',
  legs: 'étapes',
  leg: 'étape',
  schema: 'Schéma logistique',
  schemaUsed: 'Schéma retenu par la promesse',
  schemaTheoretical: 'Schémas possibles (configuration)',
  schemaTheoreticalHint: 'Combinaisons de routes de livraison compatibles avec le mode, ses transporteurs et la destination',
  schemaNoRoutes: "La réponse ne détaille pas les routes utilisées : voici les schémas possibles d'après la configuration.",
  noSchema: 'Aucune combinaison de routes ne permet de servir cette destination.',
  origin: 'Origine',
  customer: 'Client',
  transit: 'Transit',
  carrier: 'Transporteur',
  upstreamLeg: 'Approvisionnement (transporteur hors mode)',
  excludedItems: 'Articles exclus',
  config: 'Configuration',
  zones: 'Zones',
  routesCount: 'routes',
  rawExchange: 'Requête / réponse API',
  loading: 'Chargement…',
  connecting: 'Connexion à OneStock…',
  missingCredentials: "Aucun identifiant API n'est configuré pour ce site et cet environnement.",
  invalidSignature: "La signature de l'extension est invalide ou expirée. Rechargez la page.",
  genericError: 'Une erreur est survenue',
  standaloneTitle: 'Mode autonome (développement)',
  standaloneHint: "L'application n'est pas chargée dans OneStock : choisissez un site et un environnement configurés.",
  siteId: 'Site ID',
  environment: 'Environnement',
  connect: 'Se connecter',
  mockMode: 'Données de démonstration',
  needItems: 'Ajoutez au moins un article',
  needDestination: 'Renseignez une destination',
  reason_no_stock: 'Stock insuffisant ou article restreint',
  reason_missing_config: 'Combinaison destination / canal / mode non configurée',
  reason_beyond_time_limit: 'Délai hors limite',
  reason_no_eligible_route: 'Aucune route éligible',
  reason_estimation_degraded_mode: 'Calcul en mode dégradé',
  reason_failed_parcel_constraints: 'Contraintes colis non respectées',
  reason_future_arrival_exceeds_limit: 'Arrivage futur hors limite',
  reason_invalid_item: 'Article inconnu',
  reason_exceeds_authorized_shipment_number: "Nombre d'expéditions autorisé dépassé",
  reason_missing_destination_timetable: 'Calendrier de destination manquant',
  hour: 'h',
  day: 'j',
  items_count: 'article(s)',
};

type Dict = typeof fr;

const en: Dict = {
  title: 'Multi-leg delivery promise',
  subtitle: 'Simulate an order and see the logistic schema behind each delivery option',
  items: 'Items',
  addItem: 'Add an item',
  searchItems: 'Search an item (name, reference)',
  noItem: 'No item found',
  quantity: 'Quantity',
  add: 'Add',
  remove: 'Remove',
  close: 'Close',
  options: 'Options',
  salesChannel: 'Sales Channel',
  salesChannelHint: 'Specify the sales channel to use',
  salesChannels: 'Sales channels',
  destination: 'Destination',
  destinationHint: 'Specify the destination',
  address: 'Address',
  zone: 'Zone',
  stockLocation: 'Stock location',
  country: 'Country',
  selectCountry: 'Select a country',
  zipCode: 'Zip code (optional)',
  region: 'Region (optional)',
  timezone: 'Timezone (required if set in destination zone)',
  selectZone: 'Select a zone',
  selectStockLocation: 'Select a stock location',
  orderPrice: 'Order price',
  orderPriceHint: 'Modify the order price',
  deliveryMethod: 'Delivery method',
  deliveryMethodHint: 'Limit the test to one or multiple delivery methods',
  allMethods: 'All methods of the channel',
  dateTime: 'Date and time',
  dateTimeHint: 'Simulate a test at a given date and time in the future',
  test: 'Test the delivery promise',
  results: 'Delivery options',
  resultsHint: 'Select an option to display its logistic schema',
  noResult: 'Run a test to display the available delivery options',
  status_valid: 'Available',
  status_valid_estimation: 'Available (estimated)',
  status_partial: 'Partial',
  status_partial_estimation: 'Partial (estimated)',
  status_none: 'Unavailable',
  eta: 'Estimated delivery',
  cutoff: 'Order before',
  cost: 'Estimated cost',
  carbon: 'Carbon footprint',
  shipments: 'Shipments',
  shipment: 'Shipment',
  legs: 'legs',
  leg: 'leg',
  schema: 'Logistic schema',
  schemaUsed: 'Schema used by the promise',
  schemaTheoretical: 'Possible schemas (configuration)',
  schemaTheoreticalHint: 'Delivery route combinations compatible with the method, its carriers and the destination',
  schemaNoRoutes: 'The response does not detail the routes used: here are the possible schemas according to the configuration.',
  noSchema: 'No route combination can serve this destination.',
  origin: 'Origin',
  customer: 'Customer',
  transit: 'Transit',
  carrier: 'Carrier',
  upstreamLeg: 'Replenishment (carrier outside the method)',
  excludedItems: 'Excluded items',
  config: 'Configuration',
  zones: 'Zones',
  routesCount: 'routes',
  rawExchange: 'API request / response',
  loading: 'Loading…',
  connecting: 'Connecting to OneStock…',
  missingCredentials: 'No API credentials are configured for this site and environment.',
  invalidSignature: 'The extension signature is invalid or expired. Reload the page.',
  genericError: 'An error occurred',
  standaloneTitle: 'Standalone mode (development)',
  standaloneHint: 'The application is not loaded inside OneStock: choose a configured site and environment.',
  siteId: 'Site ID',
  environment: 'Environment',
  connect: 'Connect',
  mockMode: 'Demo data',
  needItems: 'Add at least one item',
  needDestination: 'Fill in a destination',
  reason_no_stock: 'Not enough stock or restricted item',
  reason_missing_config: 'Destination / channel / method not configured',
  reason_beyond_time_limit: 'Beyond time limit',
  reason_no_eligible_route: 'No eligible route',
  reason_estimation_degraded_mode: 'Degraded computation',
  reason_failed_parcel_constraints: 'Parcel constraints failed',
  reason_future_arrival_exceeds_limit: 'Future arrival beyond limit',
  reason_invalid_item: 'Unknown item',
  reason_exceeds_authorized_shipment_number: 'Authorized shipment number exceeded',
  reason_missing_destination_timetable: 'Missing destination timetable',
  hour: 'h',
  day: 'd',
  items_count: 'item(s)',
};

const dictionaries: Record<string, Dict> = { fr, en };

export const lang = ref<string>('fr');
export const locale = ref<string>('fr-FR');
export const timezone = ref<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);

export type TKey = keyof Dict;

export function t(key: TKey | string): string {
  const d = dictionaries[lang.value] ?? en;
  return (d as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
}

export function setLocale(l?: string, loc?: string, tz?: string) {
  if (l) lang.value = l.slice(0, 2).toLowerCase();
  if (loc) locale.value = loc;
  else if (l) locale.value = l;
  if (tz) timezone.value = tz;
}

export function formatDate(ts?: number): string {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone.value }).format(
      new Date(ts * 1000),
    );
  } catch {
    return new Date(ts * 1000).toLocaleString();
  }
}

export function formatMoney(n: number | undefined, currency = 'EUR'): string {
  if (n === undefined) return '';
  try {
    return new Intl.NumberFormat(locale.value, { style: 'currency', currency }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([lang.value], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
