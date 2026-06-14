# 🏛️ Aristote

> **Débat dialectique sur vos textes, avec l'IA** — Aristote complète Socrate : l'utilisateur colle un texte produit avec Socrate (thèse, chapitre, position), et Aristote le confronte dialectiquement aux positions du champ via la recherche web académique.
>
> *Web app déployée sur Vercel — React + FastAPI + BYOK multi-fournisseur.*

---

## 🎯 Rôle d'Aristote

**Aristote** n'est pas Socrate. Là où Socrate accompagne la genèse d'une pensée par maïeutique, Aristote **éprouve** cette pensée une fois qu'elle existe. Il la confronte au champ, fait surgir les contradictions, puis aide à trancher.

Le flux de travail attendu :

1. **Socrate** — l'utilisateur produit un texte conceptuel (thèse, position, chapitre).
2. **Aristote** — l'utilisateur colle ce texte et Aristote l'affronte dialectiquement, en allant chercher via la recherche web les positions académiques qui s'y opposent ou y résonnent.

Aristote n'indexe aucun corpus, n'accepte aucun upload de document. Le matériau est **le texte collé + ce que la recherche web rapporte**.

---

## ⚙️ Architecture

- **Frontend** : React + Vite + TailwindCSS, déployé sur Vercel
- **Backend** : FastAPI (Python), serverless sur Vercel (`api/index.py`)
- **Auth** : Firebase Authentication (obligatoire — aucun accès anonyme)
- **Persistance** : Firestore (conversations + préférences par uid)
- **IA** : BYOK multi-fournisseur via litellm (OpenAI, Anthropic, Google, Perplexity…)
- **Recherche web** : outil natif du fournisseur/modèle quand supporté

---

## 🔑 BYOK — Bring Your Own Key

Aristote n'embarque aucune clé API. L'utilisateur fournit sa propre clé pour le fournisseur de son choix :

| Fournisseur | Recherche web native |
|-------------|----------------------|
| OpenAI | ✅ (`*-search-preview`) |
| Perplexity | ✅ (toujours actif) |
| Anthropic | ✅ (outil `web_search`) |
| Google (Gemini) | ✅ (Search Grounding) |
| Autres | — (dégradé proprement) |

La clé transite uniquement dans le header `X-Provider-Key` et n'est **jamais persistée** côté serveur.

---

## 📐 L'Intégrale Dramatique $S(t)$

Le mécanisme de bascule de posture de Socrate est conservé et réinterprété en termes dialectiques :

$$S(t) = \left( \sum_{\tau=0}^{t} V(\tau) \cdot P(t|\tau) \right) \cdot C(t)$$

- **$S(t) < 15.0$ (Desis)** : Aristote intensifie la tension — objections, contradictions, mise en crise.
- **$S(t) \ge 15.0$ (Lusis)** : Aristote aide à dénouer — synthèse, distinction, clarification.

La réinterprétation dialectique complète (desis/lusis, pollachōs legetai) est traitée séparément.

---

## 🚀 Développement local

```bash
npm install
npm run dev        # Frontend sur http://localhost:5173
```

Le backend Python (`api/index.py`) est une fonction serverless Vercel — en dev local, Vite proxie `/api` vers Vercel CLI ou un serveur FastAPI local.

Variables d'environnement requises (`.env.local`) :
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
FIREBASE_SERVICE_ACCOUNT=...   # JSON base64 pour firebase-admin (backend)
```

---

## 📜 Licence & Propriété

Aristote est un **logiciel libre** publié sous licence **GNU Affero General Public License v3.0 (AGPL-3.0-or-later)**. Le texte intégral est disponible dans le fichier [LICENSE](./LICENSE).

**Copyright © 2026 — Association àlaclé**
Association française régie par la loi du 1er juillet 1901.
RNA : **W131016315**
Contact : **contact@alacle.org**

Publié sous licence AGPL v3. Droits patrimoniaux détenus par l'association àlaclé. Modèle de l'Intégrale Dramatique S(t) conçu par Étienne Lavallard, documenté publiquement depuis le 13 juin 2026.
https://alacle.org/integrale_dramatique

### Ce que l'AGPL v3 implique

* ✅ Vous êtes libre d'**utiliser, étudier, modifier et redistribuer** Aristote, y compris à des fins commerciales.
* ⚖️ Toute redistribution ou version modifiée doit rester sous licence **AGPL v3** et **conserver les mentions de copyright** ci-dessus.
* 🌐 **Clause réseau (le cœur de l'AGPL) :** si vous déployez Aristote ou une version modifiée sur un réseau, vous devez **rendre le code source disponible** aux utilisateurs.
* 🛡️ Le logiciel est fourni **sans aucune garantie**, dans la mesure permise par la loi.

> Pour toute demande relative à une utilisation sous d'autres conditions (licence commerciale, partenariat, etc.), contactez l'association à l'adresse ci-dessus.
