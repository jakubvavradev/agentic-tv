# Vývojový deník (cs) – původní poznámky k launcheru

Zbytek z projektu VAVRA OS (7. 11. 2026), uložený pro budoucí „agentic TV“.

- `www/index.html` – TV plocha: 3D Matterhorn (three.js), skleněné hodiny jako na zamykací obrazovce iPhonu,
  dock s logy aplikací, widgety, koule [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) pro stav agenta.
- `www/scene.js` – terén ve 3 úrovních detailu (swisstopo swissALTI3D 2 m + SWISSIMAGE, AWS Terrain Tiles,
  Sentinel-2), skutečná poloha slunce, roční období, objemové mraky, déšť, sníh a bouřky podle počasí.
- `www/glass.js` – skleněné hodiny (matné sklo přes CSS + SVG lom), `www/orb.js` – koule agenta.
- `tools/make-terrain.py LAT LON Jméno [směr_kamery° vzdálenost_m]` – vygeneruje terén pro jinou horu.

Spuštění: `cd www && python3 -m http.server 8099`, otevři http://127.0.0.1:8099
Náhled: `?h=16.3` (hodina) `&date=2026-01-15` (roční období) `&code=73&clouds=95&t=-4` (počasí podle WMO).

Widgety, koule a dock čekají na stav ze serveru přes `EventSource('/events')` (JSON: phase, setup, weather,
history, tokens, sys, procs…) a posílají `POST /launch`, `/confirm`, `/cancel`, `/show`. Bez serveru se vykreslí
jen krajina, hodiny a dock. Server z VAVRA OS je smazaný, nový backend musí tohle rozhraní napodobit.

## Android TV launcher (android/) – 9. 11. 2026, ZKUŠEBNĚ nasazeno na Strong 4K Hybrid STB (10.3.0.42)
- `android/assets/index.html` – hodiny mezi dvěma vrstvami tapety (depth effect), sklo bez backdrop-filter (předrozmazaná tapeta),
  dock = oblíbené z původního launcheru + mřížka všech aplikací. Tapeta podle výšky Slunce (Praha): sunrise/day/golden/night.
- `android/assets/wall/` – předrenderováno ze 3D scény: `node tools/render-walls.js [datum]` (headful Chrome, `www` na :8099).
- `android/build.sh` – APK bez Gradlu; `android/deploy.sh` – build + install + Home + ověření (reinstalace resetuje Home!).
- Stock tvlauncher má HOME priority=2 → vždy vyhraje; proto je na zkoušku vypnutý (pm disable-user).
- Návrat: `~/Dokumenty/tv-debloat/stock-launcher.sh` (jen launcher) nebo `restore.sh` (vše ze zálohy).

### 9. 11. 2026 večer – verze 4 (nasazeno na TV)
- Rozložení jako tvOS 26: řada 5 oblíbených na skleněné polici přes celou šířku, další aplikace po pěti pod ní, ↓ posouvá mřížku, ↑ = Nastavení.
- Liquid Glass přes WebGL (`assets/lglass.js`): optika z ybouane/liquidglass (MIT), okraj podle rdev/liquid-glass-react; renderuje se jednou
  (minuta / změna rozložení / denní doba), takže nic neběží každý snímek. Hodiny = skleněné číslice (Roboto Flex, OFL, jen číslice).
- Počasí z místní meteostanice každých 10 min (od 1.0.0 Open-Meteo podle polohy) → déšť / sníh / mlha přímo v krajině, teplota u data.
- Náhled na PC: `?h=12.5` (hodina), `?wx=rain|snow|fog|cloud&amt=0..1`.
- Výkon na STB: posun v řadě 60 fps; vstup/odchod z mřížky max ~67–100 ms jeden snímek (fade rozmazané tapety).

### Verze 5 (9. 11. 2026, 23:05)
- Tapety pro každý měsíc (15. den) × 4 denní doby: `node tools/render-months.js RAW [slot]` → `tools/grade-walls.py RAW android/assets/wall`.
  Noc se renderuje s `&exp=3.2` (parametr přidaný do www/scene.js), jinak se při zesvětlení tmavé plochy rozpadnou do pruhů. Žádné kreslené hvězdy.
- Start: aktivita je directBootAware → nativní tapeta už před odemčením úložiště (místo černé FallbackHome), WebView až po USER_UNLOCKED.
  Bannery aplikací v cache jako JPEG (`/banner/<pkg>`), mřížka se přestaví jen při změně aplikací. Pořadí všech aplikací v localStorage `order`.
- Měření studeného startu (před změnou): zygote 10 s, enable_screen 28.5 s, USER_UNLOCKED 31.7 s, launcher první snímek 37.8 s.
