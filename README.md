# HANDI - Speo Field

Aplicație web PWA pentru clubul de speologie. Marchează puncte de interes (peșteri, doline, izvoare, zone de săpat), zone de prospecțiune, trasee GPX, și overlay-uri raster (termal de la dronă, LIDAR hillshade, ortofoto).

**Stack:** React 19 + Vite + TypeScript + Tailwind v4 + MapLibre GL + Supabase (PostGIS) + Dexie (IndexedDB) + PMTiles + PWA offline.

## Status: complet (Fazele 1-4)

### Faza 1 - Fundație

- Auth magic link (Supabase) + Row Level Security
- Hartă cu 4 baseMap-uri online: OpenTopoMap (default), Esri Satelit, OSM, CyclOSM
- Overlay hillshade transparent toggle-abil + slider intensitate
- 7 tipuri de puncte (peșteră, aven, dolină, izvor, resurgență, zonă de săpat, altele) cu icoane colorate
- CRUD puncte cu poze (Supabase Storage), descriere, altitudine
- Vizibilitate `club` sau `private` (impusă prin RLS în PostgreSQL)
- Listă laterală cu filtre după tip + căutare după nume
- Persistență viewport (zoom/poziție) între sesiuni

### Faza 2 - Zone și trasee GPX

- Drawing tool poligonal (terra-draw) pentru zone de prospecțiune
- Zone cu prioritate (mică/medie/înaltă) + status (de prospectat / în lucru / confirmată / eliminată)
- Render colorat după status, opacitate după prioritate
- Import GPX (parser `@tmcw/togeojson`, suport waypoints + tracks)
- Export GPX per traseu sau bulk export
- Recorder live de track cu `geolocation.watchPosition`, persistent în localStorage
  - Statistici live: puncte, distanță, durată
  - Pauză / continuare / oprire / anulare
  - Linie pulsatorie pe hartă în timpul înregistrării
  - Calcul auto distanță și diferență de nivel la salvare

### Faza 3 - Offline-first

- Service worker (Workbox) cu strategii:
  - **CacheFirst** pentru tile-urile hărților (1 lună, 5000 tiles)
  - **NetworkFirst** pentru API Supabase (timeout 5s, fallback la cache)
- IndexedDB (Dexie) pentru cache-ul de puncte/zone/trasee
  - Citire offline = ce era ultimul fetch (read-through)
- Coadă de mutații (`pending_mutations`) pentru offline:
  - Creează / șterge puncte/zone/trasee se pun în coadă dacă nu e rețea
  - Background sync la fiecare 30s + la eveniment `online`
  - Indicator vizual în header: `Online` / `Offline` + `X în coadă` cu buton sync manual
- **PMTiles offline**: încărcare fișier `.pmtiles` local, salvat în IndexedDB ca Blob, înregistrat ca al 5-lea baseMap

### Faza 4b - Import CAD (DXF multi-layer)

- Tab **CAD**: import **DXF** georeferențiat **Stereo 70 (EPSG:3844)** → conversie client în WGS84, entități **LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / TEXT / MTEXT / INSERT (blocuri explodate, inclusiv nested) / POINT / ELLIPSE / SPLINE / 3DFACE / SOLID**, grupate pe **numele layer-ului CAD** (layer `0` în bloc moștenește layer-ul INSERT).
- Auto-clasificare după nume layer (ex. `PESTERI`, `DOLINE`, `CONTUR`, `NUME`) + simplificare curbe nivel + asociere etichete la linii de peșteri (proximitate ~50 m).
- Wizard înainte de salvare: tip layer, culoare, grosime, opacitate, vizibilitate.
- Supabase: `cad_imports` + `cad_layers` (GeoJSON per layer), overlay MapLibre per layer; secțiune separată pentru **planuri individuale** (flux vechi `cave_plans`).

### Faza 4 - Raster overlays generici

- Pipeline unificat pentru `thermal | lidar_hillshade | orthophoto | other`
- Upload PNG/JPG georeferențiat în Supabase Storage cu bbox metadata
- Buton "Folosește viewport-ul curent" prinde bbox-ul automat din hartă
- Render ca `ImageSource` în MapLibre, toggle individual + slider opacitate
- Listă în tab-ul "Rasters" cu zoom-to + delete

---

## Setup

### 1. Cloneaza si instaleaza

```bash
npm install
```

### 2. Creaza un proiect Supabase

1. Mergi la [supabase.com](https://supabase.com), creeaza un proiect nou (free tier suficient).
2. In **SQL Editor** ruleaza pe rand migratiile din [supabase/migrations/](supabase/migrations/) in ordine:
   - [0001_init.sql](supabase/migrations/0001_init.sql) - PostGIS, tabele, RLS, triggers
   - [0002_storage.sql](supabase/migrations/0002_storage.sql) - bucketuri pentru poze + raster overlays
   - [0003_geojson_columns.sql](supabase/migrations/0003_geojson_columns.sql) - coloane jsonb auto-generate pentru zone/trasee/rasters
   - [0004_cave_plans.sql](supabase/migrations/0004_cave_plans.sql) - planuri simple DXF (MultiLineString)
   - [0005_cad_imports.sql](supabase/migrations/0005_cad_imports.sql) - import CAD complet (`cad_imports` + `cad_layers` + bucket `cad-imports`)
3. La **Authentication -> Providers -> Email** activează Email. Magic link merge fără confirmare email (dacă vrei mai sigur, lasa "Confirm email" pornit).
4. La **Authentication -> URL Configuration** adaugă `http://localhost:5173` la **Site URL** și **Redirect URLs** (apoi domeniul de producție când deployezi).

### 3. Configureaza .env

```bash
cp .env.example .env
```

Completează cu valorile din proiect (Project Settings -> API):

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 4. Ruleaza local

```bash
npm run dev
```

Deschide `http://localhost:5173`. Te redirectează la login. Introdu email, primești link magic, click → ești în app.

### 5. Build pentru deploy

```bash
npm run build
```

`dist/` se poate deploya pe Vercel, Netlify, Cloudflare Pages.

---

## Import CAD din DWG / DXF

Browserul **nu citește DWG** nativ. Workflow recomandat:

1. Instalează **[ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)** (gratuit, Windows/macOS/Linux).
2. Convertește **DWG → DXF** cu ODA File Converter: preferă **ASCII DXF** (ex. **DXF 2018 ASCII** sau **2013 ASCII**), spațiu **MODEL**, păstrează **TEXT/MTEXT** la export.
3. În HANDI, tab **CAD** → **Import DXF multi-layer** → confirmă layerele detectate → **Salvează import**.

**Best practice în AutoCAD / BricsCAD:** organizează entitățile pe layere cu nume standard: `PESTERI` (linii), `DOLINE` (poligoane închise sau contur), `CONTUR` (curbe nivel), `NUME` sau `TEXT` (etichete). Asta îmbunătățește clasificarea automată.

### Debug când importul DXF nu produce layere

- Dacă mesajul spune că nu s-au găsit entități, apare un **panou de diagnostic** (număr entități pe tip, blocuri, câte entități au fost explodate din blocuri). Folosește **Copiază raport** ca să poți trimite detaliile la suport / issue.
- **HATCH** și alte entități care nu sunt în `dxf-parser` apar la „tipuri ignorate” sau nu apar deloc în contor — geometria din hatch nu e importată încă.
- **SPLINE** este aproximat prin fit points / control points ca polilinie.

---

## Hărți offline (PMTiles)

Pentru zone fără semnal:

1. Mergi la [protomaps.com/extracts](https://protomaps.com/extracts/) sau folosește [tilemaker](https://github.com/systemed/tilemaker) ca să generezi un extract `.pmtiles` raster pentru regiunea ta (ex: Apuseni, Banat, Mehedinți).
2. În aplicație, deschide switcher-ul de hartă (butonul din colțul stâng-sus) → secțiunea "Harta offline (PMTiles)" → click pe "+ adauga" și selectează fișierul `.pmtiles`.
3. Fișierul se salvează în IndexedDB local (poate fi 50-500 MB, depinde de zonă/zoom).
4. Apare ca un baseMap selectabil. Funcționează 100% offline.

## Recomandari Supabase pentru club

- Adaugă membri prin **Authentication -> Users -> Invite user**.
- Pentru a restricționa înregistrarea, dezactivează **Allow new users to sign up** în Auth Settings.
- Pentru rolul `admin`: în SQL Editor `update profiles set role='admin' where id='...'`.

## Structura

```
src/
  app/
    auth/                       # AuthProvider + LoginPage + ProtectedRoute
    FieldPage.tsx               # ecranul principal (harta + sidebar tabs)
    SyncIndicator.tsx           # online/offline + coada
  map/
    MapView.tsx                 # MapLibre + draw + flyTo + GPS + raster sync
    layers/
      BaseLayers.ts             # registry baseMap-uri (online + PMTiles)
      HillshadeOverlay.ts
      PointsLayer.ts
      ZonesLayer.ts
      TracksLayer.ts
      RasterOverlayLayer.ts     # ImageSource per overlay activ
    controls/
      BaseMapSwitcher.tsx       # base maps online + offline + hillshade
  features/
    points/                     # api + form + list + detail + photos
    zones/                      # api + form + list
    tracks/                     # api + gpx + recorder hook + panels
    rasters/                    # api + upload form + panel
    cavePlans/                  # plan simplu DXF (MultiLineString)
    cad/                        # import DXF complet + wizard + clasificare
  lib/
    supabase.ts
    types.ts
    pmtiles.ts                  # protocol register + local archive store
    db/
      dexie.ts                  # schema IndexedDB
      cache.ts                  # read-through cache
      syncQueue.ts              # coada mutatii + background sync
      safeApi.ts                # wrapper care enqueue pe network error
      online.ts                 # hook navigator.onLine
supabase/
  migrations/
    0001_init.sql
    0002_storage.sql
    0003_geojson_columns.sql
    0004_cave_plans.sql
    0005_cad_imports.sql
```

## Hărți: atribuire

- OpenTopoMap: CC-BY-SA, atribuire în coltul hărții.
- OpenStreetMap (toate variantele inclusiv CyclOSM): ODbL.
- Esri World Imagery: gratuit pentru utilizare necomercială - vezi [Terms](https://www.esri.com/en-us/legal/terms/full-master-agreement).
- AWS Terrain Tiles (hillshade): CC-BY.

## Roadmap viitor (post-MVP)

- Upload și conversie automată GeoTIFF → COG → tile-uri raster (worker server-side cu GDAL).
- Pentru thermal: filtru pixeli reci 4-8°C → sugestii auto puncte de exfiltrație (necesită citire pixeli din GeoTIFF, nu doar PNG).
- Drawing tool pentru editare polygon zone existente.
- Search global (puncte + zone) cu fuzzy match.
- Roluri și permisiuni granulare (admin poate șterge orice, member doar al lui).
- Realtime sync între membri (Supabase Realtime channel pe puncte/zone).
- Export bulk: KML/KMZ + CSV.
- Suport multi-proiect / multi-club.
