const KEY = 'ps_bars_v1'
const API_KEY_KEY = 'ps_bars_api_key'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const BESTTIME_FILTER_URL = 'https://besttime.app/api/v1/venues/filter'
const SEARCH_RADIUS_M = 1500
const MAP_ZOOM = 15

const DEFAULT_STATE = {
  lastFetchedAt: null,
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function loadApiKey() {
  return localStorage.getItem(API_KEY_KEY)?.trim() || ''
}

function saveApiKey(value) {
  const trimmed = String(value || '').trim()
  if (trimmed) localStorage.setItem(API_KEY_KEY, trimmed)
  else localStorage.removeItem(API_KEY_KEY)
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters) {
  if (meters < 160) return `${Math.round(meters * 3.28084)} ft`
  return `${(meters * 0.000621371).toFixed(meters < 805 ? 2 : 1)} mi`
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    )
  })
}

let leafletPromise = null

function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([
      new Promise((resolve, reject) => {
        if (document.querySelector('link[data-leaflet-css]')) {
          resolve()
          return
        }
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
        link.dataset.leafletCss = '1'
        link.onload = () => resolve()
        link.onerror = () => reject(new Error('Could not load map styles'))
        document.head.appendChild(link)
      }),
      import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm'),
    ]).then(([, mod]) => mod.default || mod)
  }
  return leafletPromise
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function busynessLevel(pct) {
  if (pct == null) return 'unknown'
  if (pct <= 30) return 'quiet'
  if (pct <= 60) return 'moderate'
  return 'busy'
}

function busynessLabel(pct) {
  const level = busynessLevel(pct)
  if (level === 'quiet') return 'Quiet'
  if (level === 'moderate') return 'Moderate'
  if (level === 'busy') return 'Busy'
  return 'Unknown'
}

function busynessColor(pct) {
  const level = busynessLevel(pct)
  if (level === 'quiet') return '#22c55e'
  if (level === 'moderate') return '#eab308'
  if (level === 'busy') return '#ef4444'
  return '#a8a8a8'
}

function currentBusyness(venue) {
  if (venue.busyPct != null) return venue.busyPct
  if (Array.isArray(venue.dayRaw) && venue.dayRaw.length === 1) return venue.dayRaw[0]
  if (Array.isArray(venue.dayRawWhole) && venue.timeLocalIndex != null) {
    return venue.dayRawWhole[venue.timeLocalIndex] ?? null
  }
  return null
}

async function fetchBarsFromOverpass(lat, lon) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"bar|pub|biergarten"]["name"](around:${SEARCH_RADIUS_M},${lat},${lon});
      way["amenity"~"bar|pub|biergarten"]["name"](around:${SEARCH_RADIUS_M},${lat},${lon});
    );
    out center 40;
  `
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) throw new Error('Could not load nearby bars')
  const data = await res.json()
  const elements = data?.elements || []
  const seen = new Set()
  const bars = []
  for (const el of elements) {
    const name = el.tags?.name
    if (!name) continue
    const plat = el.lat ?? el.center?.lat
    const plon = el.lon ?? el.center?.lon
    if (plat == null || plon == null) continue
    const key = `${name}|${plat.toFixed(5)}|${plon.toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)
    const parts = []
    if (el.tags?.['addr:housenumber']) parts.push(el.tags['addr:housenumber'])
    if (el.tags?.['addr:street']) parts.push(el.tags['addr:street'])
    bars.push({
      id: `osm-${el.id}`,
      name,
      address: parts.join(' ') || el.tags?.['addr:full'] || '',
      lat: plat,
      lon: plon,
      busyPct: null,
      source: 'osm',
    })
  }
  return bars
}

async function fetchBarsFromBestTime(lat, lon, apiKey) {
  const params = new URLSearchParams({
    api_key_private: apiKey,
    types: 'BAR,CLUBS',
    lat: String(lat),
    lng: String(lon),
    radius: String(SEARCH_RADIUS_M),
    now: 'true',
    foot_traffic: 'both',
    busy_min: '0',
    busy_max: '100',
    own_venues_only: 'false',
    limit: '30',
    order_by: 'now',
    order: 'desc',
  })
  const res = await fetch(`${BESTTIME_FILTER_URL}?${params}`)
  if (!res.ok) throw new Error(`BestTime API error (${res.status})`)
  const data = await res.json()
  if (data?.status !== 'OK') {
    throw new Error(data?.message || data?.error || 'BestTime API returned an error')
  }
  const timeLocalIndex = data?.window?.time_local_index ?? null
  return (data?.venues || [])
    .filter(v => v?.venue_lat != null && v?.venue_lng != null)
    .map(v => {
      const dayRaw = Array.isArray(v.day_raw) ? v.day_raw : null
      const dayRawWhole = Array.isArray(v.day_raw_whole) ? v.day_raw_whole : null
      let busyPct = null
      if (dayRaw?.length === 1) busyPct = dayRaw[0]
      else if (dayRawWhole && timeLocalIndex != null) busyPct = dayRawWhole[timeLocalIndex] ?? null
      return {
        id: v.venue_id || `bt-${v.venue_lat}-${v.venue_lng}`,
        name: v.venue_name || 'Unnamed bar',
        address: v.venue_address || '',
        lat: v.venue_lat,
        lon: v.venue_lng,
        busyPct,
        dayRaw,
        dayRawWhole,
        timeLocalIndex,
        rating: v.rating || null,
        reviews: v.reviews || null,
        venueType: v.venue_type || 'BAR',
        source: 'besttime',
        isLive: dayRaw?.length === 1,
      }
    })
}

function googleMapsDirectionsUrl(destLat, destLon, origin) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destLat},${destLon}`,
    travelmode: 'walking',
  })
  if (origin) params.set('origin', `${origin.lat},${origin.lon}`)
  return `https://www.google.com/maps/dir/?${params}`
}

function renderBusynessPill(pct, { large = false } = {}) {
  const level = busynessLevel(pct)
  const label = pct != null ? `${Math.round(pct)}% · ${busynessLabel(pct)}` : 'No data'
  return `<span class="bars-busy-pill bars-busy-pill--${level}${large ? ' bars-busy-pill--lg' : ''}">${escapeHtml(label)}</span>`
}

function renderCapacityBar(pct) {
  const width = pct != null ? Math.max(4, Math.round(pct)) : 0
  const level = busynessLevel(pct)
  return `
    <div class="bars-cap-bar" aria-hidden="true">
      <div class="bars-cap-fill bars-cap-fill--${level}" style="width:${width}%"></div>
    </div>
  `
}

export function renderBars(container, { navigate }) {
  let bars = []
  let loading = true
  let error = ''
  let userPos = null
  let geoStatus = 'idle'
  let geoError = ''
  let dataSource = ''
  let selectedBarId = null
  let mapInstance = null
  let mapMarkers = []
  let mapUserMarker = null
  let showSettings = false
  let apiKeyDraft = loadApiKey()

  function destroyMap() {
    mapMarkers = []
    mapUserMarker = null
    if (mapInstance) {
      mapInstance.remove()
      mapInstance = null
    }
  }

  function selectedBar() {
    return bars.find(b => b.id === selectedBarId) ?? null
  }

  function renderBarRow(bar, dist) {
    const pct = currentBusyness(bar)
    return `
      <button type="button" class="item bars-row${selectedBarId === bar.id ? ' bars-row--selected' : ''}" data-bar-id="${escapeHtml(bar.id)}">
        <div class="bars-row-main">
          <div class="item-title">${escapeHtml(bar.name)}</div>
          <div class="item-subtitle">${escapeHtml(bar.address || formatDistance(dist))}</div>
          ${renderCapacityBar(pct)}
        </div>
        <div class="bars-row-aside">
          ${renderBusynessPill(pct)}
          <span class="bars-row-dist text-body-sm">${escapeHtml(formatDistance(dist))}</span>
        </div>
      </button>
    `
  }

  function renderMapPanel() {
    let overlay = ''
    if (loading && !bars.length) {
      overlay = '<p class="bars-map-status">Loading nearby bars…</p>'
    } else if (geoStatus === 'pending') {
      overlay = '<p class="bars-map-status">Finding your location…</p>'
    } else if (geoStatus === 'error') {
      overlay = `
        <p class="bars-map-status">${escapeHtml(geoError || 'Location unavailable.')}</p>
        <button type="button" class="btn btn-cta bars-retry-geo">Try again</button>
      `
    } else if (!userPos) {
      overlay = `
        <p class="bars-map-status">Show bars near you on the map.</p>
        <button type="button" class="btn btn-cta bars-load-map">Load map</button>
      `
    } else if (!bars.length && error) {
      overlay = `<p class="bars-map-status">${escapeHtml(error)}</p>`
    }

    return `
      <div class="bars-map-block">
        <div class="bars-map-wrap">
          <div id="bars-map" class="bars-map" role="img" aria-label="Map of nearby bars"></div>
          ${overlay ? `<div class="bars-map-overlay">${overlay}</div>` : ''}
        </div>
      </div>
    `
  }

  function renderListPanel() {
    if (!userPos) return ''
    if (loading && !bars.length) {
      return '<p class="bars-empty text-body-sm">Loading bars…</p>'
    }
    if (error && !bars.length) {
      return `<p class="bars-empty text-body-sm">${escapeHtml(error)}</p>`
    }
    if (!bars.length) {
      return '<p class="bars-empty text-body-sm">No bars found within 1.5 km.</p>'
    }

    const sorted = bars
      .map(bar => ({ bar, dist: distanceMeters(userPos.lat, userPos.lon, bar.lat, bar.lon) }))
      .sort((a, b) => {
        const aPct = currentBusyness(a.bar)
        const bPct = currentBusyness(b.bar)
        if (aPct != null && bPct != null) return bPct - aPct
        if (aPct != null) return -1
        if (bPct != null) return 1
        return a.dist - b.dist
      })

    return `
      <div class="section-header">
        <span class="section-label">Nearby</span>
        <span class="text-body-sm bars-meta">${sorted.length} bars · ${dataSource === 'besttime' ? 'live estimates' : 'locations only'}</span>
      </div>
      <div class="item-list bars-list">
        ${sorted.map(({ bar, dist }) => renderBarRow(bar, dist)).join('')}
      </div>
    `
  }

  function renderDrawer() {
    const bar = selectedBar()
    if (!bar || !userPos) return ''
    const dist = distanceMeters(userPos.lat, userPos.lon, bar.lat, bar.lon)
    const pct = currentBusyness(bar)
    const meta = []
    if (bar.rating) meta.push(`${bar.rating.toFixed(1)}★`)
    if (bar.reviews) meta.push(`${bar.reviews} reviews`)
    if (bar.venueType) meta.push(bar.venueType.replace(/_/g, ' ').toLowerCase())

    return `
      <div class="modal-backdrop bars-drawer-backdrop" id="bars-drawer-backdrop">
        <div class="modal bars-drawer-modal" role="dialog" aria-labelledby="bars-drawer-title">
          <div class="bars-drawer-title text-h4" id="bars-drawer-title">${escapeHtml(bar.name)}</div>
          ${bar.address ? `<p class="bars-drawer-address text-body-sm">${escapeHtml(bar.address)}</p>` : ''}
          <div class="bars-drawer-busy">
            ${renderBusynessPill(pct, { large: true })}
            ${renderCapacityBar(pct)}
            <p class="bars-drawer-hint text-body-sm">
              ${bar.source === 'besttime'
                ? (bar.isLive ? 'Live foot-traffic estimate (0–100% of weekly peak).' : 'Typical busyness for right now based on historical patterns.')
                : 'Add a BestTime API key in settings for busyness estimates.'}
            </p>
          </div>
          ${meta.length ? `<p class="bars-drawer-meta text-body-sm">${escapeHtml(meta.join(' · '))}</p>` : ''}
          <p class="bars-drawer-dist text-body-sm">${escapeHtml(formatDistance(dist))} away</p>
          <a
            class="btn btn-cta btn-cta--wide"
            href="${googleMapsDirectionsUrl(bar.lat, bar.lon, userPos)}"
            target="_blank"
            rel="noopener noreferrer"
          >Directions</a>
          <button type="button" class="btn btn-secondary bars-drawer-close">Close</button>
        </div>
      </div>
    `
  }

  function renderSettingsModal() {
    if (!showSettings) return ''
    return `
      <div class="modal-backdrop" id="bars-settings-backdrop">
        <div class="modal" role="dialog" aria-labelledby="bars-settings-title">
          <div class="text-h4" id="bars-settings-title">Bar data source</div>
          <p class="text-body-sm bars-settings-desc">
            Real-time bar busyness isn't available from a single free public API. BestTime.app provides estimated foot-traffic intensity (0–100%) for thousands of venues — not literal headcount or fire-code capacity.
          </p>
          <label class="bars-settings-label text-overline" for="bars-api-key">BestTime private API key</label>
          <input
            class="input bars-api-input"
            id="bars-api-key"
            type="password"
            placeholder="pri_…"
            value="${escapeHtml(apiKeyDraft)}"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="text-body-sm bars-settings-hint">
            <a href="https://besttime.app/" target="_blank" rel="noopener noreferrer">Get a free test key</a>
            · stored on this device only
          </p>
          <div class="bars-settings-actions">
            <button type="button" class="btn btn-cta" id="bars-save-key">Save &amp; refresh</button>
            <button type="button" class="btn btn-secondary" id="bars-cancel-settings">Cancel</button>
          </div>
        </div>
      </div>
    `
  }

  function renderNotice() {
    if (!userPos || loading) return ''
    if (dataSource === 'besttime') return ''
    return `
      <div class="bars-notice">
        <p class="text-body-sm">
          Showing bar locations from OpenStreetMap.
          <button type="button" class="bars-notice-link" id="bars-open-settings">Add a BestTime key</button>
          for busyness estimates.
        </p>
      </div>
    `
  }

  function rerender() {
    destroyMap()
    container.innerHTML = `
      <div class="view bars-view" id="view-bars">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-bars-home" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Bars</div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-bars-settings" aria-label="Data source settings">⚙</button>
          </div>
        </header>

        <div class="scroll bars-scroll">
          ${renderNotice()}
          ${renderMapPanel()}
          ${renderListPanel()}
        </div>
        ${renderDrawer()}
        ${renderSettingsModal()}
      </div>
    `

    bindEvents()
    if (userPos && bars.length) initMap()
  }

  async function initMap() {
    const el = container.querySelector('#bars-map')
    if (!el || !userPos) return

    const L = await loadLeaflet()
    destroyMap()

    mapInstance = L.map(el, {
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mapInstance)

    const userIcon = L.divIcon({
      className: 'bars-map-user-icon',
      html: '<span class="bars-map-user-dot"></span>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    mapUserMarker = L.marker([userPos.lat, userPos.lon], { icon: userIcon, zIndexOffset: 1000 })
      .addTo(mapInstance)
    mapMarkers.push(mapUserMarker)

    const bounds = L.latLngBounds([[userPos.lat, userPos.lon]])

    bars.forEach(bar => {
      const pct = currentBusyness(bar)
      const color = busynessColor(pct)
      const marker = L.circleMarker([bar.lat, bar.lon], {
        radius: 9,
        color: '#111111',
        fillColor: color,
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(mapInstance)
      marker.on('click', () => {
        selectedBarId = bar.id
        rerender()
      })
      mapMarkers.push(marker)
      bounds.extend([bar.lat, bar.lon])
    })

    if (bars.length) {
      mapInstance.fitBounds(bounds.pad(0.2), { maxZoom: MAP_ZOOM })
    } else {
      mapInstance.setView([userPos.lat, userPos.lon], MAP_ZOOM)
    }
  }

  function openDrawer(barId) {
    selectedBarId = barId
    rerender()
  }

  function closeDrawer() {
    selectedBarId = null
    rerender()
  }

  async function loadBars() {
    if (!userPos) return
    loading = true
    error = ''
    rerender()

    const apiKey = loadApiKey()
    try {
      if (apiKey) {
        bars = await fetchBarsFromBestTime(userPos.lat, userPos.lon, apiKey)
        dataSource = 'besttime'
        if (!bars.length) {
          bars = await fetchBarsFromOverpass(userPos.lat, userPos.lon)
          dataSource = 'osm'
          error = 'BestTime returned no bars nearby — showing OpenStreetMap locations.'
        }
      } else {
        bars = await fetchBarsFromOverpass(userPos.lat, userPos.lon)
        dataSource = 'osm'
      }
      saveState({ ...loadState(), lastFetchedAt: Date.now() })
    } catch (e) {
      error = e?.message || 'Could not load bar data'
      if (!bars.length) {
        try {
          bars = await fetchBarsFromOverpass(userPos.lat, userPos.lon)
          dataSource = 'osm'
          if (bars.length) error = `${error}. Showing OpenStreetMap locations only.`
        } catch {
          bars = []
        }
      }
    } finally {
      loading = false
      rerender()
    }
  }

  async function ensureLocation() {
    geoStatus = 'pending'
    geoError = ''
    rerender()
    try {
      userPos = await getUserLocation()
      geoStatus = 'ready'
      await loadBars()
    } catch (e) {
      geoStatus = 'error'
      geoError = e?.message || 'Could not get your location.'
      loading = false
      rerender()
    }
  }

  function bindEvents() {
    container.querySelector('#btn-bars-home')?.addEventListener('click', () => navigate('home'))
    container.querySelector('#btn-bars-settings')?.addEventListener('click', () => {
      apiKeyDraft = loadApiKey()
      showSettings = true
      rerender()
    })
    container.querySelector('#bars-open-settings')?.addEventListener('click', () => {
      apiKeyDraft = loadApiKey()
      showSettings = true
      rerender()
    })
    container.querySelector('.bars-load-map')?.addEventListener('click', () => ensureLocation())
    container.querySelector('.bars-retry-geo')?.addEventListener('click', () => ensureLocation())

    container.querySelectorAll('[data-bar-id]').forEach(btn => {
      btn.addEventListener('click', () => openDrawer(btn.dataset.barId))
    })

    container.querySelector('#bars-drawer-backdrop')?.addEventListener('click', e => {
      if (e.target.id === 'bars-drawer-backdrop') closeDrawer()
    })
    container.querySelector('.bars-drawer-close')?.addEventListener('click', closeDrawer)

    container.querySelector('#bars-settings-backdrop')?.addEventListener('click', e => {
      if (e.target.id === 'bars-settings-backdrop') {
        showSettings = false
        rerender()
      }
    })
    container.querySelector('#bars-cancel-settings')?.addEventListener('click', () => {
      showSettings = false
      rerender()
    })
    container.querySelector('#bars-save-key')?.addEventListener('click', async () => {
      const input = container.querySelector('#bars-api-key')
      apiKeyDraft = input?.value?.trim() || ''
      saveApiKey(apiKeyDraft)
      showSettings = false
      if (userPos) await loadBars()
      else rerender()
    })
  }

  rerender()
  ensureLocation()
}
