#!/usr/bin/env python3
"""Real terrain for the TV scene, three levels of detail around a peak:
  peak: 6 km square, swissALTI3D 2 m elevation + SWISSIMAGE aerial photo (swisstopo, open data) – only inside Switzerland
  near: z13 elevation + z14 imagery (SWISSIMAGE where available, else Sentinel-2), ~13.6 km, covers peak and camera
  far:  z11 elevation + z12 Sentinel-2 imagery, ~54 km square for the distant ranges
Sources: swisstopo (swissALTI3D, SWISSIMAGE), AWS Terrain Tiles (terrarium), Sentinel-2 cloudless 2016 by EOX (CC BY 4.0).
  python3 tools/make-terrain.py [lat lon name cam_bearing_deg cam_dist_m]     default: Matterhorn from Zermatt side
Writes www/terrain/{near,far}.{bin,jpg} + meta.json."""
import io, json, math, os, sys, urllib.request
from pathlib import Path
from PIL import Image

a = sys.argv[1:]
LAT, LON = (float(a[0]), float(a[1])) if len(a) > 1 else (45.9763, 7.6586)
NAME = a[2] if len(a) > 2 else "Matterhorn"
CAM_BEARING = float(a[3]) if len(a) > 3 else 62.0       # where the camera stands, seen from the peak
CAM_DIST = float(a[4]) if len(a) > 4 else 8600.0
OUT = Path(os.environ.get("TERRAIN_OUT") or Path(__file__).resolve().parent.parent / "www/terrain")
SWISS = os.environ.get("SWISS", "1") == "1"          # swisstopo detail only inside Switzerland
IMG = os.environ.get("IMG")                             # national open orthophoto {z}/{x}/{y} template outside CH (EOX fallback)
VIEW = json.loads(os.environ.get("VIEW", "{}"))         # camera/snow overrides for scene.js: camY, drop, fov, snow
CIRC = 40075016.7


def tile_xy(lat, lon, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


CACHE = Path(__file__).resolve().parent / ".cache"
EOX = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
SWISSIMAGE = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"


def fetch(url):
    """Download once into tools/.cache (re-runs are offline)."""
    f = CACHE / url.split("://", 1)[1].replace("/", "_")
    if not f.exists():
        CACHE.mkdir(exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "vavra-os-terrain/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            f.write_bytes(r.read())
    return f.read_bytes()


def get(url):
    return Image.open(io.BytesIO(fetch(url))).convert("RGB")


def usable(img):
    """SWISSIMAGE outside Switzerland is blank: reject tiles that are mostly pure white/black."""
    small = img.resize((32, 32))
    px = [small.getpixel((x, y)) for y in range(32) for x in range(32)]
    return sum(1 for p in px if min(p) > 248 or max(p) < 6) < 100


def mosaic(url, z, x0, y0, n, nx=None, fallback=None):
    img = None
    for j in range(n):
        for i in range(nx or n):
            try:
                t = get(url.format(z=z, x=x0 + i, y=y0 + j))
                if fallback and not usable(t):
                    raise ValueError("blank")
            except (OSError, ValueError):
                if not fallback:
                    raise
                t = get(fallback.format(z=z, x=x0 + i, y=y0 + j)).resize((256, 256))
            img = img or Image.new("RGB", (t.width * (nx or n), t.height * n))
            img.paste(t, (i * t.width, j * t.height))
    return img


def fit16(hs):
    """Heights are stored as uint16 decimetres: drop nodata holes, lift the deepest valleys so the range fits 6553 m."""
    ok = [h for h in hs if h > -500]
    top = max(ok); lo = max(min(ok), top - 6553)
    return [min(max(h, lo), top) for h in hs], lo


def level(name, z_dem, center_lat, center_lon, grid, n=4, swiss=False):
    fx, fy = tile_xy(center_lat, center_lon, z_dem)
    x0, y0 = round(fx) - n // 2, round(fy) - n // 2
    dem = mosaic("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", z_dem, x0, y0, n)
    k = 2                                                         # imagery one zoom finer, 2x2 per DEM tile
    src = SWISSIMAGE if swiss else IMG
    img = mosaic(src or EOX, z_dem + 1, x0 * k, y0 * k, n * k, fallback=EOX if src else None)
    px, W = dem.load(), dem.width
    raw = [[px[x, y][0] * 256 + px[x, y][1] + px[x, y][2] / 256 - 32768 for x in range(W)] for y in range(W)]
    hs = []
    for gy in range(grid):
        for gx in range(grid):
            sx, sy = gx * (W - 1) / (grid - 1), gy * (W - 1) / (grid - 1)
            ix, iy = min(int(sx), W - 2), min(int(sy), W - 2)
            tx, ty = sx - ix, sy - iy
            hs.append(raw[iy][ix] * (1 - tx) * (1 - ty) + raw[iy][ix + 1] * tx * (1 - ty)
                      + raw[iy + 1][ix] * (1 - tx) * ty + raw[iy + 1][ix + 1] * tx * ty)
    if name == "near":
        level.near = (raw, W, x0, y0, n, z_dem)               # fallback heights for the peak level
    hs, lo = fit16(hs)
    (OUT / f"{name}.bin").write_bytes(b"".join(int(round((h - lo) * 10)).to_bytes(2, "little") for h in hs))
    img.save(OUT / f"{name}.jpg", quality=86)
    tile_m = CIRC * math.cos(math.radians(LAT)) / 2 ** z_dem
    px_, py_ = tile_xy(LAT, LON, z_dem)                           # peak in this zoom's tile units
    # square centre relative to the peak, metres: +x east, +z south
    cx, cz = (x0 + n / 2 - px_) * tile_m, (y0 + n / 2 - py_) * tile_m
    return {"grid": grid, "size": round(tile_m * n, 1), "min": round(lo, 1), "max": round(max(hs), 1), "center": [round(cx, 1), round(cz, 1)]}


def lv95(lat, lon):
    """WGS84 -> Swiss LV95 (swisstopo approximate formulas, ~1 m)."""
    p, l = (lat * 3600 - 169028.66) / 10000, (lon * 3600 - 26782.5) / 10000
    e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
    n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return e, n


def unmerc(tx, ty, z):
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n)))), tx / n * 360 - 180


def peak_level(half=3000, grid=640, z_img=15):
    """6 km around the summit from swissALTI3D (2 m); holes (outside CH) filled from the near level."""
    z = 13
    tile_m = CIRC * math.cos(math.radians(LAT)) / 2 ** z
    px_, py_ = tile_xy(LAT, LON, z)
    lat0, lon0 = unmerc(px_ - half / tile_m, py_ + half / tile_m, z)
    lat1, lon1 = unmerc(px_ + half / tile_m, py_ - half / tile_m, z)
    url = (f"https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items"
           f"?bbox={lon0 - .01},{lat0 - .01},{lon1 + .01},{lat1 + .01}&limit=100")
    tiles = {}
    while url:
        page = json.loads(fetch(url))
        for f in page["features"]:
            a = next((v["href"] for v in f["assets"].values() if v["href"].endswith("_2_2056_5728.tif")), None)
            if a:
                e_km, n_km = map(int, f["id"].rsplit("_", 1)[1].split("-"))
                if (e_km, n_km) not in tiles or a > tiles[(e_km, n_km)]:     # newest survey year wins
                    tiles[(e_km, n_km)] = a
        url = next((l["href"] for l in page.get("links", []) if l["rel"] == "next"), None)
    print(f"swissALTI3D: {len(tiles)} tiles")
    tiles = {k: Image.open(io.BytesIO(fetch(v))).load() for k, v in tiles.items()}
    raw, W, nx0, ny0, nn, nz = level.near

    def near_h(tx, ty):                                       # bilinear in the z13 near mosaic
        sx, sy = (tx - nx0) * 256, (ty - ny0) * 256
        ix, iy = min(max(int(sx), 0), W - 2), min(max(int(sy), 0), W - 2)
        fx, fy = sx - ix, sy - iy
        return (raw[iy][ix] * (1 - fx) * (1 - fy) + raw[iy][ix + 1] * fx * (1 - fy)
                + raw[iy + 1][ix] * (1 - fx) * fy + raw[iy + 1][ix + 1] * fx * fy)

    def swiss_h(e, n):
        t = tiles.get((int(e // 1000), int(n // 1000)))
        if not t:
            return None
        c, r = (e % 1000) / 2, (1000 - n % 1000) / 2
        ic, ir = min(int(c), 498), min(int(r), 498)
        fc, fr = c - ic, r - ir
        v = [t[ic, ir], t[ic + 1, ir], t[ic, ir + 1], t[ic + 1, ir + 1]]
        if min(v) < -1000:
            return None
        return v[0] * (1 - fc) * (1 - fr) + v[1] * fc * (1 - fr) + v[2] * (1 - fc) * fr + v[3] * fc * fr

    hs, holes = [], 0
    for gy in range(grid):
        for gx in range(grid):
            x, zz = -half + gx * 2 * half / (grid - 1), -half + gy * 2 * half / (grid - 1)
            tx, ty = px_ + x / tile_m, py_ + zz / tile_m
            h = swiss_h(*lv95(*unmerc(tx, ty, z)))
            if h is None:
                h, holes = near_h(tx, ty), holes + 1
            hs.append(h)
    print(f"peak: {holes} of {grid * grid} vertices filled from the 30 m model")
    hs, lo = fit16(hs)
    (OUT / "peak.bin").write_bytes(b"".join(int(round((h - lo) * 10)).to_bytes(2, "little") for h in hs))

    # aerial photo cropped exactly to the square
    k = 2 ** (z_img - z)
    fx0, fy0, fx1, fy1 = (px_ - half / tile_m) * k, (py_ - half / tile_m) * k, (px_ + half / tile_m) * k, (py_ + half / tile_m) * k
    tx0, ty0 = int(fx0), int(fy0)
    nxt, nyt = int(fx1) - tx0 + 1, int(fy1) - ty0 + 1
    img = mosaic(SWISSIMAGE, z_img, tx0, ty0, nyt, nx=nxt, fallback=EOX)
    box = tuple(round(v * 256) for v in (fx0 - tx0, fy0 - ty0, fx1 - tx0, fy1 - ty0))
    img.crop(box).resize((2048, 2048), Image.LANCZOS).save(OUT / "peak.jpg", quality=88)
    return {"grid": grid, "size": 2 * half, "min": round(lo, 1), "max": round(max(hs), 1), "center": [0, 0]}


def peak_open(half=3000, grid=640, z=15, z_img=16):
    """Outside CH: 6 km around the summit from AWS terrarium z15 (best source there, e.g. 10 m in AT) + IMG orthophoto."""
    tile_m = CIRC * math.cos(math.radians(LAT)) / 2 ** z
    px_, py_ = tile_xy(LAT, LON, z)
    tx0, ty0 = int(px_ - half / tile_m), int(py_ - half / tile_m)
    nt = int(px_ + half / tile_m) - tx0 + 1
    dem = mosaic("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", z, tx0, ty0, nt)
    px, W = dem.load(), dem.width
    def hgt(sx, sy):
        ix, iy = min(max(int(sx), 0), W - 2), min(max(int(sy), 0), W - 2)
        fx, fy = sx - ix, sy - iy
        v = [px[ix, iy], px[ix + 1, iy], px[ix, iy + 1], px[ix + 1, iy + 1]]
        v = [p[0] * 256 + p[1] + p[2] / 256 - 32768 for p in v]
        return v[0] * (1 - fx) * (1 - fy) + v[1] * fx * (1 - fy) + v[2] * (1 - fx) * fy + v[3] * fx * fy
    hs = [hgt((px_ + (-half + gx * 2 * half / (grid - 1)) / tile_m - tx0) * 256, (py_ + (-half + gy * 2 * half / (grid - 1)) / tile_m - ty0) * 256)
          for gy in range(grid) for gx in range(grid)]
    hs, lo = fit16(hs)
    (OUT / "peak.bin").write_bytes(b"".join(int(round((h - lo) * 10)).to_bytes(2, "little") for h in hs))
    k = 2 ** (z_img - z)
    fx0, fy0, fx1, fy1 = (px_ - half / tile_m) * k, (py_ - half / tile_m) * k, (px_ + half / tile_m) * k, (py_ + half / tile_m) * k
    ix0, iy0 = int(fx0), int(fy0)
    img = mosaic(IMG or EOX, z_img, ix0, iy0, int(fy1) - iy0 + 1, nx=int(fx1) - ix0 + 1, fallback=EOX if IMG else None)
    box = tuple(round(v * 256) for v in (fx0 - ix0, fy0 - iy0, fx1 - ix0, fy1 - iy0))
    img.crop(box).resize((2048, 2048), Image.LANCZOS).save(OUT / "peak.jpg", quality=88)
    return {"grid": grid, "size": 2 * half, "min": round(lo, 1), "max": round(max(hs), 1), "center": [0, 0]}


OUT.mkdir(parents=True, exist_ok=True)
# near square centred between peak and camera so both the peak and the foreground are detailed
b = math.radians(CAM_BEARING)
mid_n, mid_e = math.cos(b) * CAM_DIST / 2, math.sin(b) * CAM_DIST / 2      # metres north / east of the peak
mlat = LAT + mid_n / 111320
mlon = LON + mid_e / (111320 * math.cos(math.radians(LAT)))
meta = {"name": NAME, "lat": LAT, "lon": LON, "cam": [CAM_BEARING, CAM_DIST],
        "near": level("near", 13, mlat, mlon, 640, swiss=SWISS), "far": level("far", 11, LAT, LON, 256),
        "credit": "Terén a snímky: © swisstopo (swissALTI3D, SWISSIMAGE) · AWS Terrain Tiles · Sentinel-2 cloudless 2016 © EOX (CC BY 4.0)"}
if VIEW: meta["view"] = VIEW
meta["peak"] = peak_level() if SWISS else peak_open()
if not SWISS: meta["credit"] = os.environ.get("CREDIT", "") + "AWS Terrain Tiles · Sentinel-2 cloudless 2016 © EOX (CC BY 4.0)"
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
for f in ("height.bin", "color.jpg"):
    (OUT / f).unlink(missing_ok=True)
print(json.dumps(meta, indent=1))
