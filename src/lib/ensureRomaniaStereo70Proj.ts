/**
 * Definiții PROJ.4 aliniate cu epsg.io / GDAL pentru Stereo70 în România.
 * Versiunea veche (GRS80 + towgs84=0 pentru EPSG:3844) producea decalaje față de
 * ortofoto/vectori WGS84 (ex. LiDAR „tras” față de OpenTopoMap).
 */
import proj4 from 'proj4';

/** EPSG:3844 — Pulkovo 1942(58) / Stereo70 (ANCPI). */
const PROJ4_EPSG_3844 =
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=2.329,-147.042,-92.08,0.309,-0.325,-0.497,5.69 +units=m +no_defs';

/** EPSG:31700 — Dealul Piscului 1970 / Stereo 70 (depreciat). */
const PROJ4_EPSG_31700 =
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=28,-121,-77,0,0,0,0 +units=m +no_defs';

proj4.defs('EPSG:3844', PROJ4_EPSG_3844);
proj4.defs('EPSG:31700', PROJ4_EPSG_31700);
