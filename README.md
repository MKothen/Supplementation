# Supplementen en voeding schema (GitHub Pages + Firebase)

## Features
- Login (Google)
- Per-user opslag (Firestore)
- Week overzicht (Ma–Zo)
- Dagelijkse checklists: supplementen + maaltijden + water
- Aanpassen: supplementen toevoegen/verwijderen per tijdslot
- Neo-brutalism UI

## Setup
1. Maak een Firebase project.
2. Enable Authentication → Google.
3. Maak Firestore Database aan.
4. Voeg je GitHub Pages domain toe in Auth → Settings → Authorized domains:
   - YOUR_GITHUB_USERNAME.github.io
5. Plak je Firebase config in `firebase.js`.
6. Zet Firestore rules (zie `firestore.rules`).

## Deploy via GitHub Pages
- Push deze bestanden naar je repo.
- GitHub → Settings → Pages
  - Source: Deploy from a branch
  - Branch: main / root (of `/docs` als je het daar zet)
- Open: https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/

## Data model (Firestore)
- users/{uid}/meta/plan
  - morning: string[]
  - midday: string[]
  - evening: string[]
- users/{uid}/days/{YYYY-MM-DD}
  - meals: { [label]: boolean }
  - taken: { morning: { [name]: boolean }, midday: ..., evening: ... }
