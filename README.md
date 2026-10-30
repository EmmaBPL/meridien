# Méridien

Horloge globe. Tourne la Terre : l'heure, la ville, le pays, le décalage, la date et le jour ou la nuit suivent le point sous le méridien.

Ambiance par défaut : **Contact**. L'autre ambiance est **Orbite**.

## Icône

Globe réaliste vu de l'espace, centré sur les Amériques. Les dessins adaptatifs sont décrits dans `android/app/src/main/res/mipmap-anydpi-v26/`. Les PNG d'icône se régénèrent avec la texture du jour.

## Lancer

```bash
npm install
npm run dev
```

Les textures satellite (`public/textures/earth-day.jpg`, `earth-night.jpg`, `earth-topo.png`, `earth-water.png`) ne sont pas dans ce dépôt : elles dépassent ce que l'envoi texte peut porter. Place-les dans `public/textures/` avant de builder.

## Android

Projet dans `android/` (WebView, minSdk 24, cible 34).
Ne jamais committer `android/meridien-release.keystore` ni `android/local.properties`.

```bash
npx vite build --config scripts/vite.apk.config.mjs
cd android && gradle assembleRelease
```
