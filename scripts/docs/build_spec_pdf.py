"""Spécification fonctionnelle et technique de l'extension « Delivery promise » (PDF).

Usage : python3 scripts/docs/build_spec_pdf.py [sortie.pdf]
"""

import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/spec-delivery-promise.pdf"

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("DV", FONT_DIR + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DV-B", FONT_DIR + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVM", FONT_DIR + "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("DV", normal="DV", bold="DV-B", italic="DV", boldItalic="DV-B")

PRIMARY = colors.HexColor("#0f6e6e")
TEAL = colors.HexColor("#14b8a6")
GREY = colors.HexColor("#5b6472")
LIGHT = colors.HexColor("#eef6f6")
BORDER = colors.HexColor("#c9d6d6")

base = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("title", parent=base["Title"], fontName="DV-B", fontSize=22, leading=28, textColor=PRIMARY, alignment=TA_LEFT),
    "subtitle": ParagraphStyle("subtitle", fontName="DV", fontSize=11, leading=15, textColor=GREY),
    "h1": ParagraphStyle("h1", fontName="DV-B", fontSize=15, leading=20, textColor=PRIMARY, spaceBefore=14, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="DV-B", fontSize=11.5, leading=15, textColor=colors.black, spaceBefore=10, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="DV", fontSize=9.5, leading=13.5, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="DV", fontSize=8.2, leading=11),
    "cell": ParagraphStyle("cell", fontName="DV", fontSize=8, leading=10.5),
    "cellb": ParagraphStyle("cellb", fontName="DV-B", fontSize=8, leading=10.5, textColor=colors.white),
    "code": ParagraphStyle("code", fontName="DVM", fontSize=7.6, leading=10, backColor=LIGHT, borderPadding=5, spaceBefore=3, spaceAfter=7),
    "bullet": ParagraphStyle("bullet", fontName="DV", fontSize=9.5, leading=13.5, leftIndent=12, bulletIndent=2, spaceAfter=2),
}


def P(text, style="p"):
    return Paragraph(text, S[style])


def bullets(items):
    return [Paragraph(i, S["bullet"], bulletText="•") for i in items]


def code(text):
    return Paragraph(text.replace(" ", "&nbsp;").replace("\n", "<br/>"), S["code"])


def table(header, rows, widths):
    data = [[Paragraph(h, S["cellb"]) for h in header]]
    data += [[Paragraph(str(c), S["cell"]) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return t


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("DV", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(18 * mm, 10 * mm, "Extension OneStock « Delivery promise » — spécification")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(TEAL)
    canvas.setLineWidth(1.2)
    canvas.line(18 * mm, A4[1] - 12 * mm, A4[0] - 18 * mm, A4[1] - 12 * mm)
    canvas.restoreState()


story = []

# ------------------------------------------------------------------------------------------------ cover
story += [
    Spacer(1, 18 * mm),
    P("Delivery promise", "title"),
    P("Extension UI OneStock (back office) — promesse de livraison multi-legs recalculée localement", "subtitle"),
    Spacer(1, 4 * mm),
    P(f"Spécification fonctionnelle et technique · version du {date.today().strftime('%d/%m/%Y')}", "subtitle"),
    Spacer(1, 10 * mm),
    P("Sommaire", "h2"),
]
story += bullets(
    [
        "1. Objet et périmètre",
        "2. Architecture et contexte d'appel",
        "3. Parcours utilisateur",
        "4. API OneStock appelées, dans l'ordre",
        "5. Calcul de la promesse (moteur local)",
        "6. Configuration et options d'affichage",
        "7. Performances et caches",
        "8. Gestion des erreurs et limites connues",
    ]
)
story.append(PageBreak())

# ------------------------------------------------------------------------------------------------ 1
story += [
    P("1. Objet et périmètre", "h1"),
    P(
        "L'extension permet, depuis le back office OneStock, de sélectionner des articles et une destination de livraison "
        "puis d'afficher les options de livraison possibles par méthode (Express, Standard, Click &amp; Collect…). "
        "Pour l'option choisie, elle montre le schéma logistique retenu : chaîne de routes de livraison (multi-legs), "
        "point d'expédition, articles traités par chaque route, dates, coûts, et le cas échéant transferts de consolidation."
    ),
    P(
        "<b>La promesse est reconstruite localement</b> à partir de la configuration OneStock (delivery_configs, routes, zones, "
        "timetables, temps d'exécution, restrictions), du stock (courant et futur) et des capacités. "
        "L'API <font name='DVM'>/delivery_promises</font> de OneStock n'est pas utilisée."
    ),
    P("Ce que la promesse prend en compte", "h2"),
]
story += bullets(
    [
        "Date et heure de la commande (maintenant, ou une date choisie).",
        "Méthode de livraison : configuration dont les zones de livraison contiennent la destination, transporteurs "
        "autorisés (chaque leg, transferts compris, doit utiliser un transporteur de la méthode), restrictions appliquées "
        "(<font name='DVM'>applied_restrictions</font>), nombre d'expéditions autorisées.",
        "Routes de livraison : grilles de coûts (contraintes colis / commande : poids, quantité, prix), frais de port "
        "(<font name='DVM'>shipping_fees</font>), coût transporteur (<font name='DVM'>cost_by_parcel</font>), empreinte carbone.",
        "Timetables : cutoff transporteur (pickup), jours de roulage (transit), créneaux de livraison (delivery), "
        "calendriers d'exécution des opérations (execution_time_timetable) ou horaires d'ouverture du lieu.",
        "Opérations : <font name='DVM'>always_at_start</font>, <font name='DVM'>before_shipping</font> (préparation), "
        "<font name='DVM'>after_shipping</font> (réception), <font name='DVM'>from_destination</font> (C&amp;C sur stock magasin).",
        "Stock disponible et stock futur (ASN…) selon la requête de stock de la méthode.",
        "Capacités de préparation (lignes) des lieux de stock et de chargement (colis) des transporteurs.",
        "Priorités de tri par méthode (ex. Standard : moins cher puis plus rapide), déduplication des schémas identiques, "
        "option de consolidation (livrer en un minimum de colis).",
    ]
)

# ------------------------------------------------------------------------------------------------ 2
story += [
    P("2. Architecture et contexte d'appel", "h1"),
    table(
        ["Élément", "Description"],
        [
            ["Front", "Vue 3 + TypeScript (Vite), design system OneStock. Le moteur de calcul s'exécute dans le navigateur."],
            ["Back", "Node / Express, déployé sur Vercel (fonction serverless <font name='DVM'>api/index.ts</font>). "
             "Il porte l'authentification OneStock et relaie les appels API (proxy)."],
            ["Code partagé", "<font name='DVM'>shared/</font> : moteur (promise.ts), logistique (logistics.ts), timetables (timetables.ts)."],
            ["Stockage", "Postgres (Neon, <font name='DVM'>DATABASE_URL</font>) ou SQLite en local : identifiants API par site / "
             "environnement (mot de passe chiffré AES-256-GCM) et réglages de l'extension (priorités)."],
            ["Contexte", "Extension de type <font name='DVM'>bo.page</font> en iframe : paramètres d'URL (site_id, environnement, "
             "langue, utilisateur…) puis échange <font name='DVM'>extension_ready</font> / <font name='DVM'>onestock_data</font> par postMessage. "
             "Signature désactivée (VERIFY_SIGNATURE=false)."],
            ["Session", "Le back émet un JWT de session (site, environnement, URL API) utilisé par le front pour tous les appels."],
        ],
        [30, 144],
    ),
    P("Authentification OneStock", "h2"),
    P(
        "Le token OneStock est généré par le back avec l'utilisateur / mot de passe enregistrés pour le site et l'environnement "
        "(onglet caché Configuration). Il est mis en cache et régénéré une fois en cas de 401. Tous les appels OneStock sont des "
        "<b>GET avec corps JSON</b> contenant <font name='DVM'>site_id</font> et <font name='DVM'>token</font>."
    ),
    code('POST /login\n{ "site_id": "...", "user_id": "...", "password": "..." }  ->  { "token": "..." }'),
]

# ------------------------------------------------------------------------------------------------ 3
story += [
    P("3. Parcours utilisateur", "h1"),
    table(
        ["Étape", "Action", "Appels déclenchés"],
        [
            ["1", "Ouverture de l'extension", "Session, puis chargement du référentiel (section 4.A)"],
            ["2", "Recherche / ajout d'articles (5 par page, « 5 de plus », quantité)", "GET /v3/items (4.B)"],
            ["3", "Choix du canal de vente, de la destination (adresse, zone ou lieu de stock), options : prix, méthodes, "
                  "date, consolidation", "GET /endpoints si destination = lieu de stock (4.C)"],
            ["4", "Bouton Tester", "Stock, capacités, puis calcul local (4.D)"],
            ["5", "Sélection d'une option", "Aucun : affichage du schéma (routes, articles par route, dates, coûts, transferts)"],
        ],
        [14, 86, 74],
    ),
]

# ------------------------------------------------------------------------------------------------ 4
story += [
    P("4. API OneStock appelées, dans l'ordre", "h1"),
    P(
        "Les appels passent par le back de l'extension (routes <font name='DVM'>/api/...</font>), qui ajoute "
        "<font name='DVM'>site_id</font> et <font name='DVM'>token</font>. Les chemins versionnés (<font name='DVM'>/v3/items</font>) "
        "remplacent la version éventuellement présente à la fin de l'URL API."
    ),
    P("A. Ouverture : chargement du référentiel (GET /api/referential)", "h2"),
    P(
        "Exécuté une fois puis mis en cache par site / environnement (bouton « recharger » pour forcer). "
        "Chaque étape alimente un rapport de chargement (nombre d'éléments, durée, erreurs)."
    ),
    table(
        ["#", "API OneStock", "Paramètres", "Utilisation"],
        [
            ["0", "POST /login", "site_id, user_id, password", "Token (si absent du cache)."],
            ["1", "GET /delivery_configs", "—", "Méthodes de livraison : zones, transporteurs, opérations, "
             "global_execution_times, applied_restrictions, stock_request, authorized_shipment_number."],
            ["2a", "GET /delivery_routes", "—", "Groupes de routes (public_id, carrier, timetables) et lignes de grille "
             "de coûts (parcel_constraints, order_constraints, metric_values)."],
            ["2b", "GET /zones", "—", "Zones (pays, codes postaux, régions, lieux de stock inclus)."],
            ["2c", "GET /sales_channels", "—", "Canaux de vente (devise)."],
            ["2d", "GET /endpoints", "fields : _id, name, classification, timezone, address, opening_hours, execution_times ; "
             "pagination 100 par 100", "Lieux de stock (fuseau, horaires d'ouverture, temps d'exécution)."],
            ["3", "GET /execution_times/{id}", "ids de global_execution_times et des lieux (par lots de 10)",
             "Durées et calendriers des opérations. Repli : GET /execution_times (liste) si 403."],
            ["4", "GET /timetables/{id}", "fields : id, name, type, hours, current_timetable, routes (par lots de 10)",
             "Pickup (cutoff), transit (jours de roulage), delivery (créneaux), execution_time_timetable. "
             "Repli : GET /timetables filtré par type si 403."],
            ["5", "GET /delivery_restrictions/{id}", "ids de applied_restrictions", "Restrictions (filtre article, "
             "transporteurs exclus), ex. poids &gt; 30 kg interdit sur colissimo DOM."],
            ["6", "GET /configurations", "keys : [\"stock\"], scopes : {site : true}", "Types de stock : "
             "<font name='DVM'>stock.on_hand</font> (disponible) et <font name='DVM'>stock.types</font> (ex. asn = stock futur)."],
        ],
        [9, 40, 55, 70],
    ),
    P("Les étapes 2a à 2d sont exécutées en parallèle. Les étapes 3 et 4 dépendent des étapes 1 et 2.", "small"),
    P("B. Sélection des articles", "h2"),
    table(
        ["API OneStock", "Paramètres", "Utilisation"],
        [
            ["GET /v3/items", "pattern / filters.ids, lang, pagination (5 ou 10), features (name, image, price…), "
             "fields : weight, length, width, height, product_id, is_default, category_ids",
             "Recherche et fiche article ; le poids et les dimensions (champs article) servent aux contraintes "
             "des grilles de coûts et aux restrictions."],
        ],
        [32, 76, 66],
    ),
    P("C. Destination « lieu de stock »", "h2"),
    table(
        ["API OneStock", "Paramètres", "Utilisation"],
        [["GET /endpoints", "name (recherche) ou endpoint_ids", "Liste des lieux de stock (click &amp; collect, transfert)."]],
        [32, 76, 66],
    ),
]
story.append(PageBreak())
story += [
    P("D. Bouton « Tester » : calcul de la promesse", "h2"),
    P("Ordre d'exécution :"),
    table(
        ["Ordre", "API OneStock", "Paramètres", "Utilisation"],
        [
            ["1 (parallèle)", "GET /v3/items", "filters.ids des articles sans poids chargé", "Recharge poids / dimensions."],
            ["1 (parallèle)", "GET /stock_export", "request_name = <font name='DVM'>stock_request</font> de la méthode "
             "(<font name='DVM'>detailed</font> par défaut) ; aggregates : {\"*\" : {item_filter : {ids : [...]}}}",
             "Une requête par valeur distincte de stock_request parmi les méthodes testées. Retourne le stock courant "
             "et le stock futur (type asn, quantity, eta_start, eta_end, purchase_order_number)."],
            ["1 (secours)", "GET /stocks", "item_ids, endpoint_ids (par 400)", "Uniquement si /stock_export échoue."],
            ["2", "—", "—", "Premier calcul local (sans capacité connue)."],
            ["3..n (séries)", "GET /capacities", "links, at_date, locale, location (fuseau du lieu)",
             "Capacités des jours réellement envisagés par le calcul ; nouveau calcul après chaque série, "
             "jusqu'à ce qu'aucun jour inconnu ne soit demandé."],
        ],
        [20, 30, 66, 58],
    ),
    P("Exemples d'appels capacités", "h2"),
    P("Capacité de préparation d'un lieu de stock (en lignes de commande) :"),
    code('GET /capacities\n{ "links": [ { "type": "endpoint", "entity_id": "warehouse_lyon_saint_priest" } ],\n'
         '  "at_date": "1794960000", "locale": "fr_FR", "location": "Europe/Paris" }'),
    P("Capacité de chargement d'un transporteur sur un lieu (en colis ; carrier = name des carriers de la delivery_config) :"),
    code('GET /capacities\n{ "links": [ { "type": "endpoint", "entity_id": "store_paris_5" },\n'
         '             { "type": "carrier",  "entity_id": "GLS" } ],\n'
         '  "at_date": "1795046400", "locale": "fr_FR", "location": "Europe/Paris" }\n'
         '->  { "capacity": { "date": 1795046400, "capacities": 3, "defaults": "+Inf", "consumed": 0 } }'),
    P(
        "Restant du jour = (<font name='DVM'>capacities</font>, sinon <font name='DVM'>defaults</font>) − "
        "<font name='DVM'>consumed</font>. <font name='DVM'>+Inf</font> = illimité. Une capacité en erreur est considérée illimitée."
    ),
    P("Exemple de stock futur", "h2"),
    code('{ "item_id": "00004", "endpoint_id": "warehouse_lyon_saint_priest", "quantity": 10,\n'
         '  "type": "asn", "eta_start": 1797202800, "eta_end": 1797375600, "purchase_order_number": "PO_001" }'),
    P("10 unités disponibles au plus tôt à eta_start et au plus tard à eta_end.", "small"),
    P("Appels non utilisés", "h2"),
    P("<font name='DVM'>/delivery_promises</font>, <font name='DVM'>/sort_orders</font>, <font name='DVM'>/scheduledevents</font> "
      "(retirés : la promesse est locale et les priorités sont réglées dans l'extension)."),
]
story.append(PageBreak())

# ------------------------------------------------------------------------------------------------ 5
story += [P("5. Calcul de la promesse (moteur local)", "h1"), P("Pour chaque méthode de livraison testée :")]
steps = [
    ("Configuration", "delivery_config de la méthode et du canal de vente dont les zones de livraison contiennent la destination "
     "(sinon : « configuration manquante »)."),
    ("Schémas candidats", "Chaînes de routes (jusqu'à 3 legs) d'une zone de stock vers la destination ; chaque leg doit utiliser "
     "un transporteur de la méthode."),
    ("Exclusions", "Restriction appliquée (article × transporteur), contrainte de grille de coûts non satisfaite (poids, quantité, "
     "prix commande), absence de stock, timetable sans créneau."),
    ("Stock", "Requête de stock de la méthode. Stock disponible (type on_hand) en priorité ; à défaut, stock futur cumulé par date "
     "d'arrivée : la préparation démarre à eta_start (au plus tôt) / eta_end (au plus tard). Les schémas sur stock disponible "
     "passent avant ceux sur stock futur."),
    ("Chronologie", "always_at_start (sur son calendrier d'exécution) → préparation before_shipping au lieu d'expédition → "
     "cutoff pickup → transit (jours de roulage) → créneau de livraison → after_shipping (réception, si la méthode la déclare). "
     "Fourchette : piste « au plus tôt » (début de créneau) et « au plus tard » (fin de créneau)."),
    ("Capacités", "Jour de préparation plein (lignes restantes &lt; lignes de l'expédition) : préparation reportée au jour suivant, "
     "puis au suivant… jusqu'à un jour disponible (90 jours max). Idem pour l'enlèvement transporteur (1 colis par expédition). "
     "S'applique aussi aux transferts, au colis regroupé et au C&amp;C sur stock magasin."),
    ("Lieu d'expédition", "Pour chaque schéma, le lieu de stock donnant la livraison la plus tôt (l'orchestrateur choisira parmi les "
     "lieux équivalents d'une même zone)."),
    ("Tri et dédoublonnage", "Tri selon les priorités de la méthode (réglages de l'extension, ex. Standard = moins cher puis plus "
     "rapide), en utilisant l'ETA et le coût réels ; les schémas identiques (mêmes routes) ne sont gardés qu'une fois."),
    ("Allocation", "Une seule expédition si possible ; sinon découpage (meilleur schéma d'abord) dans la limite de "
     "authorized_shipment_number. Statut : disponible, partielle (articles non servis) ou indisponible."),
    ("Consolidation (option)", "Si plusieurs colis seraient nécessaires : recherche d'un point intermédiaire de la zone d'origine "
     "d'un schéma final, transfert des articles manquants (transporteurs de la méthode), puis une seule livraison."),
    ("Résultat", "Fourchette de livraison estimée, cutoff (commander avant), frais de port (somme des shipping_fees), coût "
     "transporteur, empreinte carbone, nombre d'expéditions, routes avec articles et dates, stock futur et reports de capacité utilisés."),
]
story.append(table(["Étape", "Règle"], [[f"<b>{i + 1}. {a}</b>", b] for i, (a, b) in enumerate(steps)], [38, 136]))

# ------------------------------------------------------------------------------------------------ 6
story += [
    P("6. Configuration et options d'affichage", "h1"),
    P("Onglet caché « Configuration » (roue dentée) :"),
]
story += bullets(
    [
        "<b>Identifiants API</b> par site et environnement (utilisateur / mot de passe, test de connexion).",
        "<b>Priorités par méthode</b> : plus rapide ; moins cher puis plus rapide ; plus rapide puis moins cher ; plus vert puis "
        "plus rapide. Enregistrées en base, appliquées immédiatement.",
        "<b>Options d'affichage</b> (masquées par défaut) : rapport de chargement et durées du dernier test, méthode de calcul / "
        "transporteurs / zones / priorités, résumé de la consolidation, chronologie, raisons d'exclusion.",
    ]
)

# ------------------------------------------------------------------------------------------------ 7
story += [
    P("7. Performances et caches", "h1"),
    table(
        ["Donnée", "Cache / optimisation"],
        [
            ["Token OneStock", "En mémoire par site / environnement ; nouveau login sur 401."],
            ["Référentiel (configs, routes, zones, lieux, timetables, temps d'exécution, restrictions, types de stock)",
             "En mémoire côté serveur (TTL configurable) et côté navigateur ; rechargement à la demande."],
            ["Stock", "Une requête /stock_export par stock_request, en parallèle avec la recharge des articles ; /stocks seulement en secours."],
            ["Capacités", "Interrogées seulement pour les lieux pouvant encore être les meilleurs (classement sans capacité d'abord) ; "
             "20 appels simultanés ; cache 1 minute par lieu / transporteur / jour ; un jour plein déclenche la lecture des 7 jours suivants."],
            ["Mesure", "Durées du dernier test (stock, capacités, nombre d'appels, calcul) affichées avec l'option « rapport de chargement »."],
        ],
        [55, 119],
    ),
]

# ------------------------------------------------------------------------------------------------ 8
story += [
    P("8. Gestion des erreurs et limites connues", "h1"),
]
story += bullets(
    [
        "Droits (ACL) insuffisants sur un appel : replis documentés (listes au lieu des détails, /stocks au lieu de /stock_export), "
        "étape signalée dans le rapport de chargement ; capacité inconnue = illimitée ; stock illisible = disponibilité non vérifiée (alerte).",
        "Serveur mal configuré (variables d'environnement manquantes) : réponse 503 explicite au lieu d'une erreur générique.",
        "Durée d'une opération non lisible : signalée comme « durée inconnue » (comptée 0).",
        "Approximation : 1 colis par expédition, 1 ligne de commande par article ; le choix final entre lieux équivalents reste à l'orchestrateur.",
        "Méthode sans stock_request : requête <font name='DVM'>detailed</font> par défaut.",
    ]
)

doc = SimpleDocTemplate(
    OUT,
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=18 * mm,
    title="Delivery promise — spécification",
    author="OneStock UI extension",
)
doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print("written", OUT)
