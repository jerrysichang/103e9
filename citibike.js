const KEY = 'ps_citibike_v1'
const COMPASS_PREF_KEY = 'ps_citibike_compass_on'
const LAST_POS_KEY = 'ps_citibike_last_pos'
/** Reuse last fix on reopen so the map loads without a fresh GPS prompt. */
const LAST_POS_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GBFS_BASE = 'https://gbfs.citibikenyc.com/gbfs/en'
const NEAR_ME_MOVE_M = 120
/** Min walk before recentering the map (reduces tile reload while moving). */
const MAP_RECENTER_MOVE_M = 4
/** Debounce background pin refresh after crossing the near-me distance threshold. */
const NEARBY_MOVE_REFRESH_MS = 2500
/** Number of nearest racks shown on the Nearby map. */
const MAP_NEAREST_COUNT = 5
/** NYC-area magnetic declination (degrees west of true north). iOS webkitCompassHeading is magnetic. */
const MAGNETIC_DECLINATION_WEST_DEG = 12.5

const TAB_SCHEMA = 2

const DEFAULT_STATE = {
  saved: [],
  findMode: 'parking',
  activeTab: 'nearby',
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed?.stationIds) && !parsed?.saved) {
      return {
        saved: parsed.stationIds.map(stationId => ({ stationId, label: '' })),
        findMode: 'parking',
        activeTab: 'nearby',
      }
    }

    let activeTab = 'nearby'
    if (parsed?.tabSchema >= TAB_SCHEMA) {
      if (parsed.activeTab === 'nearest') activeTab = 'nearby'
      else if (['nearby', 'saved'].includes(parsed.activeTab)) activeTab = parsed.activeTab
    } else if (parsed?.activeTab === 'saved') {
      activeTab = 'saved'
    }

    return {
      saved: Array.isArray(parsed?.saved)
        ? parsed.saved
          .filter(s => s && s.stationId)
          .map(s => ({ stationId: String(s.stationId), label: String(s.label || '') }))
        : [],
      findMode: ['bike', 'ebike', 'parking'].includes(parsed?.findMode) ? parsed.findMode : 'bike',
      activeTab,
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify({ ...state, tabSchema: TAB_SCHEMA }))
}

async function fetchStations() {
  const [infoRes, statusRes] = await Promise.all([
    fetch(`${GBFS_BASE}/station_information.json`),
    fetch(`${GBFS_BASE}/station_status.json`),
  ])
  if (!infoRes.ok || !statusRes.ok) throw new Error('Could not load station data')

  const info = await infoRes.json()
  const status = await statusRes.json()
  const infoById = new Map(
    (info?.data?.stations || []).map(s => [s.station_id, s])
  )
  const statusById = new Map(
    (status?.data?.stations || []).map(s => [s.station_id, s])
  )

  const stations = []
  for (const [id, meta] of infoById) {
    const live = statusById.get(id)
    if (!live) continue
    const bikes = live.num_bikes_available ?? 0
    const ebikes = live.num_ebikes_available ?? 0
    const docks = live.num_docks_available ?? 0
    stations.push({
      id,
      name: meta.name,
      lat: meta.lat,
      lon: meta.lon,
      bikes,
      ebikes,
      classic: Math.max(0, bikes - ebikes),
      docks,
      isOffline: !live.is_renting || !live.is_returning,
    })
  }
  return stations
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

function bearingDeg(fromLat, fromLon, toLat, toLon) {
  const toRad = d => (d * Math.PI) / 180
  const toDeg = r => (r * 180) / Math.PI
  const y = Math.sin(toRad(toLon - fromLon)) * Math.cos(toRad(toLat))
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat))
    - Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(toRad(toLon - fromLon))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** GPS bearing is true north; subtract west declination for magnetic north. */
function trueBearingToMagnetic(deg) {
  return (deg - MAGNETIC_DECLINATION_WEST_DEG + 360) % 360
}

function formatDistance(meters) {
  if (meters < 160) return `${Math.round(meters * 3.28084)} ft`
  return `${(meters * 0.000621371).toFixed(meters < 805 ? 2 : 1)} mi`
}

/** ~5 km/h walking pace. */
function formatWalkMinutes(meters) {
  return Math.max(1, Math.round(meters / 83))
}

function formatDistanceWithWalk(meters) {
  return `${formatDistance(meters)} <span class="citibike-walk-time">• ${formatWalkMinutes(meters)} min walk</span>`
}

function stationMatchesMode(station, mode) {
  if (station.isOffline) return false
  if (mode === 'bike') return station.bikes > 0
  if (mode === 'ebike') return station.ebikes > 0
  if (mode === 'parking') return station.docks > 0
  return false
}

function findNearest(stations, lat, lon, mode) {
  const list = findNearestN(stations, lat, lon, mode, 1)
  return list[0] ?? null
}

function findNearestN(stations, lat, lon, mode, n = 3) {
  const matches = []
  for (const station of stations) {
    if (!stationMatchesMode(station, mode)) continue
    matches.push({ station, dist: distanceMeters(lat, lon, station.lat, station.lon) })
  }
  matches.sort((a, b) => a.dist - b.dist)
  return matches.slice(0, n)
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

function renderModeSwitch(state, label = 'Find nearest') {
  return `
    <div class="citibike-mode-switch" role="tablist" aria-label="${label}">
      <span class="citibike-mode-indicator" aria-hidden="true"></span>
      <button type="button" class="citibike-mode-btn${state.findMode === 'bike' ? ' citibike-mode-active' : ''}" data-find-mode="bike" role="tab">Any bike</button>
      <button type="button" class="citibike-mode-btn${state.findMode === 'ebike' ? ' citibike-mode-active' : ''}" data-find-mode="ebike" role="tab">E-bike</button>
      <button type="button" class="citibike-mode-btn${state.findMode === 'parking' ? ' citibike-mode-active' : ''}" data-find-mode="parking" role="tab">Parking</button>
    </div>
  `
}

const ICON_SVG = {
  bike: `<svg class="citibike-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.75"/><circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8.5 18h7M6 16l2.2-5h7.6l2.2 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ebike: `<svg class="citibike-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h6.5l-1.2 8L21 10h-6.5L16 2z" fill="currentColor"/></svg>`,
  dock: `<svg class="citibike-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h5.5a3.5 3.5 0 010 7H11v7H9V5zm2 2v3h3.5a1.5 1.5 0 000-3H11z" fill="currentColor"/></svg>`,
}

function pill(kind, count) {
  const empty = count <= 0
  return `<span class="citibike-pill citibike-pill-${kind}${empty ? ' citibike-pill-empty' : ''}">${ICON_SVG[kind]}<span class="citibike-pill-count">${count}</span></span>`
}

function availabilityAside(station) {
  return `
    <div class="citibike-aside-col">
      <div class="citibike-pills-wrap">${availabilityPillsRow(station)}</div>
      ${availabilityCapacityBarSummary(station)}
    </div>
  `
}

const MAP_PIN_LABEL_OFFSET_Y = 22
const MAP_RACK_MARKER_FILL = '#ffffff'

function mapPillsForMode(station, mode) {
  if (station.isOffline) return '<span class="citibike-offline">Offline</span>'
  if (mode === 'parking') {
    return `<div class="citibike-pill-row citibike-map-pill-row">${pill('dock', station.docks)}</div>`
  }
  if (mode === 'ebike') {
    return `<div class="citibike-pill-row citibike-map-pill-row">${pill('ebike', station.ebikes)}</div>`
  }
  const pills = []
  if (station.classic > 0) pills.push(pill('bike', station.classic))
  if (station.ebikes > 0) pills.push(pill('ebike', station.ebikes))
  return `<div class="citibike-pill-row citibike-map-pill-row">${pills.join('')}</div>`
}

function userMapArrowIconHtml(rotation = 0) {
  return `
    <div class="citibike-map-user-arrow" style="transform: rotate(${rotation}deg)">
      <svg class="citibike-map-user-arrow-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 L19 19 L12 15 L5 19 Z" fill="#111111" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </div>
  `
}

function getCompassPref() {
  try {
    const local = localStorage.getItem(COMPASS_PREF_KEY)
    if (local === '1' || local === '0') return local
    // Migrate older session-only preference so reopen keeps working.
    const session = sessionStorage.getItem(COMPASS_PREF_KEY)
    if (session === '1' || session === '0') {
      localStorage.setItem(COMPASS_PREF_KEY, session)
      return session
    }
  } catch { /* ignore quota / private mode */ }
  return null
}

function setCompassPref(value) {
  try {
    localStorage.setItem(COMPASS_PREF_KEY, value)
    sessionStorage.setItem(COMPASS_PREF_KEY, value)
  } catch { /* ignore quota / private mode */ }
}

function needsMotionPermissionPrompt() {
  // null = never asked; '1' / '0' remembered across app reopen (localStorage).
  return typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function'
    && getCompassPref() == null
}

const MAP_DEFAULT_ZOOM = 16
const MAP_MIN_ZOOM = 13
const MAP_MAX_ZOOM = 17
const MAP_ZOOM_STEP = 0.5
const MAP_ZOOM_ANIM_DURATION = 0.32

function snapMapZoom(zoom) {
  return Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Math.round(zoom * 2) / 2))
}
/** Extra tile canvas beyond viewport so rotation never exposes empty edges. */
const MAP_ROTATION_COVERAGE = 1.95
const FIND_MODES = ['bike', 'ebike', 'parking']
const MODE_SWIPE_MIN_PX = 56
const MODE_SWIPE_MAX_VERTICAL_PX = 48

const CITIBIKE_PULL_ICON_SVG = `
  <svg class="citibike-pull-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
    />
  </svg>
`

/** Fit zoom from user position + the visible rack set (recalculated per filter). */
function resolveMapZoom(L, mapInstance, userPos, nearest3) {
  if (!nearest3?.length || !mapInstance || !userPos) return snapMapZoom(MAP_DEFAULT_ZOOM)

  const bounds = L.latLngBounds([userPos.lat, userPos.lon], [userPos.lat, userPos.lon])
  nearest3.forEach(({ station }) => bounds.extend([station.lat, station.lon]))

  // Neutral zoom so Leaflet's bounds fit is stable (not influenced by prior mode's zoom).
  mapInstance.setView([userPos.lat, userPos.lon], MAP_DEFAULT_ZOOM, { animate: false })
  mapInstance.invalidateSize()

  const pinCount = nearest3.length
  const distances = nearest3.map(n => n.dist)
  const maxDist = Math.max(...distances)
  const spread = maxDist - Math.min(...distances)

  // Pad grows with how far the furthest rack is so closer sets zoom in, wider sets zoom out.
  const distPad = Math.min(130, Math.round(40 + maxDist * 0.2))
  const padX = 68 + distPad + (pinCount < 3 ? 14 : 0)
  const padY = 92 + Math.round(distPad * 1.15) + (pinCount < 3 ? 18 : 0)
  let zoom = mapInstance.getBoundsZoom(bounds, false, L.point(padX, padY))

  // Map stays user-centered, not bounds-centered — ease out when racks sit on one side.
  const center = bounds.getCenter()
  const latScale = 111320
  const lonScale = 111320 * Math.cos(userPos.lat * Math.PI / 180)
  const offsetM = Math.hypot(
    (userPos.lat - center.lat) * latScale,
    (userPos.lon - center.lng) * lonScale
  )
  const asymmetry = maxDist > 0 ? offsetM / maxDist : 0
  if (asymmetry > 0.1) zoom -= 0.5
  if (spread < 100 && pinCount > 1) zoom -= 0.5
  if (maxDist > 320) zoom -= 0.5
  if (maxDist > 520) zoom -= 0.5

  return snapMapZoom(zoom)
}

function availabilityNearbyStack(station) {
  return `
    <div class="citibike-nearest-availability">
      <div class="citibike-pills-wrap citibike-nearest-pills-large">${availabilityPillsRow(station)}</div>
      ${availabilityCapacityBarDetailed(station)}
    </div>
  `
}

const PULL_TRIGGER_OFFSET = 72
const PULL_SNAP_OFFSET = 52
const PULL_MAX_OFFSET = 128
const PULL_RUBBER_CONSTANT = 0.52
const PULL_ICON_START_Y = -44

/** iOS-style rubber band: more pull yields diminishing movement. */
function dampPullOffset(raw) {
  const d = Math.max(0, raw)
  return (PULL_RUBBER_CONSTANT * d * PULL_MAX_OFFSET) / (d + PULL_RUBBER_CONSTANT * PULL_MAX_OFFSET)
}

function attachCitibikePullRefresh(rootEl, onRefresh, { fixed = false } = {}) {
  if (!rootEl) return () => {}

  const body = rootEl.querySelector('.citibike-pull-body')
  const head = rootEl.querySelector('.citibike-pull-head')
  const icon = rootEl.querySelector('.citibike-pull-icon')
  if (!body) return () => {}

  let startY = 0
  let tracking = false
  let pullOffset = 0
  let refreshing = false

  const canPull = () => fixed || rootEl.scrollTop <= 0

  const setPullVisuals = (offset, animate) => {
    const transition = animate ? '' : 'none'
    body.style.transition = transition
    body.style.transform = offset > 0 ? `translate3d(0, ${offset}px, 0)` : ''

    if (head) {
      head.style.transition = transition
      head.style.height = offset > 0 ? `${offset}px` : '0'
    }

    if (!icon || refreshing) return

    const progress = Math.min(1, offset / PULL_TRIGGER_OFFSET)
    const ready = offset >= PULL_TRIGGER_OFFSET
    const iconY = Math.min(0, PULL_ICON_START_Y + offset * 0.9)
    const fadeOpacity = offset <= 0 ? 0 : 0.1 + progress * 0.45

    icon.style.opacity = String(ready ? 1 : fadeOpacity)
    icon.style.transform = `translate3d(0, ${iconY}px, 0) rotate(${progress * 220}deg)`
    rootEl.classList.toggle('citibike-pull-ready', ready)
  }

  const clearIconInline = () => {
    if (!icon) return
    icon.style.opacity = ''
    icon.style.transform = ''
  }

  const settleTo = async (px, { runRefresh = false } = {}) => {
    rootEl.classList.remove('citibike-pull-dragging')
    rootEl.classList.remove('citibike-pull-ready')
    setPullVisuals(px, true)
    if (!runRefresh) return
    refreshing = true
    rootEl.classList.add('citibike-pull-refreshing')
    clearIconInline()
    try {
      await onRefresh()
    } finally {
      refreshing = false
      rootEl.classList.remove('citibike-pull-refreshing')
      setPullVisuals(0, true)
    }
  }

  const resetPull = (animate = true) => {
    tracking = false
    pullOffset = 0
    if (refreshing) return
    rootEl.classList.remove('citibike-pull-dragging')
    rootEl.classList.remove('citibike-pull-ready')
    setPullVisuals(0, animate)
  }

  const onTouchStart = e => {
    if (refreshing || !canPull()) return
    startY = e.touches[0].clientY
    tracking = true
    pullOffset = 0
  }

  const onTouchMove = e => {
    if (!tracking || refreshing) return
    if (!canPull()) {
      resetPull(false)
      return
    }
    const raw = e.touches[0].clientY - startY
    if (raw <= 0) {
      pullOffset = 0
      setPullVisuals(0, false)
      return
    }
    e.preventDefault()
    pullOffset = dampPullOffset(raw)
    rootEl.classList.add('citibike-pull-dragging')
    setPullVisuals(pullOffset, false)
  }

  const onTouchEnd = async () => {
    if (!tracking || refreshing) {
      resetPull()
      return
    }
    tracking = false
    const shouldRefresh = pullOffset >= PULL_TRIGGER_OFFSET
    pullOffset = 0
    if (!shouldRefresh) {
      await settleTo(0)
      return
    }
    await settleTo(PULL_SNAP_OFFSET, { runRefresh: true })
  }

  rootEl.addEventListener('touchstart', onTouchStart, { passive: true })
  rootEl.addEventListener('touchmove', onTouchMove, { passive: false })
  rootEl.addEventListener('touchend', onTouchEnd)
  rootEl.addEventListener('touchcancel', onTouchEnd)

  return () => {
    rootEl.removeEventListener('touchstart', onTouchStart)
    rootEl.removeEventListener('touchmove', onTouchMove)
    rootEl.removeEventListener('touchend', onTouchEnd)
    rootEl.removeEventListener('touchcancel', onTouchEnd)
    body.style.transform = ''
    body.style.transition = ''
    if (head) {
      head.style.height = ''
      head.style.transition = ''
    }
    clearIconInline()
    rootEl.classList.remove('citibike-pull-ready')
    rootEl.classList.remove('citibike-pull-dragging')
    rootEl.classList.remove('citibike-pull-refreshing')
  }
}

function modeSwitchSegmentWidth(switchEl) {
  const buttons = switchEl?.querySelectorAll('.citibike-mode-btn')
  if (!buttons || buttons.length < 2) return switchEl?.offsetWidth ? switchEl.offsetWidth / 3 : 120
  return buttons[1].offsetLeft - buttons[0].offsetLeft
}

function applyModeIndicatorAtIndex(switchEl, virtualIdx, { animate = false } = {}) {
  const buttons = [...switchEl.querySelectorAll('.citibike-mode-btn')]
  const indicator = switchEl.querySelector('.citibike-mode-indicator')
  if (!indicator || !buttons.length) return

  const clamped = Math.max(0, Math.min(buttons.length - 1, virtualIdx))
  const lo = Math.floor(clamped)
  const hi = Math.min(buttons.length - 1, Math.ceil(clamped))
  const t = hi === lo ? 0 : clamped - lo
  const loBtn = buttons[lo]
  const hiBtn = buttons[hi]
  const activeRound = Math.round(clamped)

  indicator.style.transition = animate ? '' : 'none'
  indicator.style.width = `${loBtn.offsetWidth + (hiBtn.offsetWidth - loBtn.offsetWidth) * t}px`
  indicator.style.transform = `translateX(${loBtn.offsetLeft + (hiBtn.offsetLeft - loBtn.offsetLeft) * t}px)`
  buttons.forEach((btn, i) => {
    btn.classList.toggle('citibike-mode-active', i === activeRound)
  })
}

function attachNearbyModeDrag(rootEl, { getModeIndex, getModeSwitch, onCommitIndex, canDrag = () => true }) {
  if (!rootEl) return () => {}

  let startX = 0
  let startY = 0
  let startIdx = 0
  let tracking = false
  let dragging = false

  const onTouchStart = e => {
    if (e.touches.length !== 1 || !canDrag()) return
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    startIdx = getModeIndex()
    tracking = true
    dragging = false
  }

  const onTouchMove = e => {
    if (!tracking) return
    const dx = e.touches[0].clientX - startX
    const dy = e.touches[0].clientY - startY
    if (!dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return
      dragging = true
      const switchEl = getModeSwitch()
      switchEl?.classList.add('citibike-mode-dragging')
    }
    e.preventDefault()
    const switchEl = getModeSwitch()
    if (!switchEl) return
    const seg = modeSwitchSegmentWidth(switchEl)
    // Swipe right moves the selector left (lower index).
    applyModeIndicatorAtIndex(switchEl, startIdx - dx / seg)
  }

  const onTouchEnd = e => {
    if (!tracking) return
    tracking = false
    const touch = e.changedTouches[0]
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    const switchEl = getModeSwitch()

    if (dragging && switchEl) {
      const seg = modeSwitchSegmentWidth(switchEl)
      const virtualIdx = Math.max(0, Math.min(FIND_MODES.length - 1, startIdx - dx / seg))
      const targetIdx = Math.round(virtualIdx)
      switchEl.classList.remove('citibike-mode-dragging')
      applyModeIndicatorAtIndex(switchEl, targetIdx, { animate: true })
      if (targetIdx !== startIdx) onCommitIndex(targetIdx)
      else onCommitIndex(startIdx)
    } else if (
      Math.abs(dx) >= MODE_SWIPE_MIN_PX
      && (Math.abs(dy) <= Math.abs(dx) || Math.abs(dy) <= MODE_SWIPE_MAX_VERTICAL_PX)
    ) {
      const targetIdx = Math.max(0, Math.min(FIND_MODES.length - 1, startIdx + (dx > 0 ? -1 : 1)))
      if (targetIdx !== startIdx) onCommitIndex(targetIdx)
    }

    dragging = false
  }

  rootEl.addEventListener('touchstart', onTouchStart, { passive: true })
  rootEl.addEventListener('touchmove', onTouchMove, { passive: false })
  rootEl.addEventListener('touchend', onTouchEnd)
  rootEl.addEventListener('touchcancel', onTouchEnd)

  return () => {
    rootEl.removeEventListener('touchstart', onTouchStart)
    rootEl.removeEventListener('touchmove', onTouchMove)
    rootEl.removeEventListener('touchend', onTouchEnd)
    rootEl.removeEventListener('touchcancel', onTouchEnd)
    getModeSwitch()?.classList.remove('citibike-mode-dragging')
  }
}

function availabilityPillsRow(station) {
  if (station.isOffline) return '<span class="citibike-offline">Offline</span>'
  return `
    <div class="citibike-pill-row">
      ${pill('bike', station.classic)}
      ${pill('ebike', station.ebikes)}
      ${pill('dock', station.docks)}
    </div>
  `
}

function capSegs(kind, count) {
  return Array.from({ length: count }, () => `<span class="citibike-cap-seg citibike-cap-seg-${kind}"></span>`).join('')
}

function availabilityCapacityBarSummary(station) {
  if (station.isOffline) {
    return '<div class="citibike-cap-segments citibike-cap-segments--summary citibike-cap-segments--offline" aria-hidden="true"></div>'
  }
  const { classic, ebikes, docks } = station
  const total = classic + ebikes + docks
  if (total === 0) {
    return '<div class="citibike-cap-segments citibike-cap-segments--summary citibike-cap-segments--empty" aria-hidden="true"></div>'
  }
  const segments = [
    ['bike', classic],
    ['ebike', ebikes],
    ['dock', docks],
  ]
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `<span class="citibike-cap-seg citibike-cap-seg-${kind}" style="flex:${n}"></span>`)
    .join('')
  return `<div class="citibike-cap-segments citibike-cap-segments--summary" aria-hidden="true">${segments}</div>`
}

function availabilityCapacityBarDetailed(station) {
  if (station.isOffline) {
    return '<div class="citibike-cap-segments citibike-cap-segments--offline" aria-hidden="true"></div>'
  }
  const total = station.classic + station.ebikes + station.docks
  if (total === 0) {
    return '<div class="citibike-cap-segments citibike-cap-segments--empty" aria-hidden="true"></div>'
  }
  return `<div class="citibike-cap-segments" aria-hidden="true">${capSegs('bike', station.classic)}${capSegs('ebike', station.ebikes)}${capSegs('dock', station.docks)}</div>`
}

function nearMeSecondsAgo(loadedAt) {
  if (!loadedAt) return 0
  return Math.max(0, Math.floor((Date.now() - loadedAt) / 1000))
}

function formatNearMeAgo(seconds) {
  if (seconds < 8) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function googleMapsDirectionsUrl(destLat, destLon, mode, origin) {
  const travelmode = mode === 'parking' ? 'bicycling' : 'walking'
  const params = new URLSearchParams({
    api: '1',
    destination: `${destLat},${destLon}`,
    travelmode,
  })
  if (origin) params.set('origin', `${origin.lat},${origin.lon}`)
  return `https://www.google.com/maps/dir/?${params}`
}

function loadCachedUserPosition() {
  try {
    const raw = localStorage.getItem(LAST_POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const lat = Number(parsed?.lat)
    const lon = Number(parsed?.lon)
    const at = Number(parsed?.at)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(at)) return null
    if (Date.now() - at > LAST_POS_MAX_AGE_MS) return null
    return {
      lat,
      lon,
      at,
      anchorLat: Number.isFinite(Number(parsed?.anchorLat)) ? Number(parsed.anchorLat) : lat,
      anchorLon: Number.isFinite(Number(parsed?.anchorLon)) ? Number(parsed.anchorLon) : lon,
    }
  } catch {
    return null
  }
}

function saveCachedUserPosition(pos, anchor = pos) {
  if (!pos) return
  localStorage.setItem(LAST_POS_KEY, JSON.stringify({
    lat: pos.lat,
    lon: pos.lon,
    anchorLat: anchor?.lat ?? pos.lat,
    anchorLon: anchor?.lon ?? pos.lon,
    at: Date.now(),
  }))
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

/**
 * Device heading: degrees clockwise from north, 0 = top of device points north.
 * iOS webkitCompassHeading is magnetic; absolute alpha uses (360 - alpha) on Android.
 */
function headingFromOrientationEvent(e) {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    if (typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy > 30) {
      return null
    }
    return e.webkitCompassHeading
  }
  if (isIosDevice()) return null
  if (e.absolute === true && typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
    return (360 - e.alpha) % 360
  }
  if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
    return (360 - e.alpha) % 360
  }
  return null
}

function smoothAngle(prev, next, factor = 0.2, deadband = 2) {
  if (prev == null) return next
  let delta = ((next - prev + 540) % 360) - 180
  if (Math.abs(delta) < deadband) return prev
  return (prev + delta * factor + 360) % 360
}

function orientationEventName() {
  if (isIosDevice()) return 'deviceorientation'
  if ('ondeviceorientationabsolute' in window) return 'deviceorientationabsolute'
  return 'deviceorientation'
}

/** Rotate arrow on screen: 0° = up (phone top), clockwise. */
function arrowRotationDeg(targetBearing, deviceHeading, live) {
  if (!live || deviceHeading == null || targetBearing == null) return 0
  return (targetBearing - deviceHeading + 360) % 360
}

async function requestCompassPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return false
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const result = await DeviceOrientationEvent.requestPermission()
    return result === 'granted'
  }
  return true
}

let compassCleanup = null

export function renderCitibike(container, { navigate }) {
  compassCleanup?.()

  let stations = []
  let loading = true
  let error = ''
  let userPos = null
  let geoStatus = 'idle'
  let geoError = ''
  let editingStationId = null
  let nearestMagneticBearing = null
  let deviceHeading = null
  let displayArrowRotation = null
  let cachedBearing = null
  let cachedBearingForStationId = null
  let cachedBearingAt = null
  let compassActive = false
  let compassSupported = typeof DeviceOrientationEvent !== 'undefined'
  let lastFetchedAt = null
  let orientationHandler = null
  let orientationEvent = null
  let arrowFrame = null
  let nearestByMode = { bike: null, ebike: null, parking: null }
  let nearMeLoadedAt = null
  let nearMeAnchor = null
  let nearMeLoading = false
  let positionWatchId = null
  let positionWatchStarted = false
  let positionFixWaiters = []
  let nearMeAgoTimer = null
  let pullCleanup = null
  let modeSwipeCleanup = null
  let mapInstance = null
  let mapNearestPins = []
  let mapMarkers = []
  let mapUserMarker = null
  let mapDrawerStation = null
  let mapPinLabels = []
  let mapOrientationTapHandler = null
  let mapViewSyncHandler = null
  let mapArrowRotation = null
  let mapHeadingFrame = null
  let mapViewZoom = MAP_DEFAULT_ZOOM
  /** Auto-fit runs once per map session; mode changes and +/- keep mapViewZoom. */
  let mapAutoZoomApplied = false
  let mapModeRefreshQueue = Promise.resolve()
  let nearbyMoveRefreshTimer = null
  let nearbyMoveRefreshInFlight = false
  let lastMapCenterLat = null
  let lastMapCenterLon = null
  let lastMapViewZoomApplied = null

  function enqueueMapModeRefresh(mode) {
    mapModeRefreshQueue = mapModeRefreshQueue
      .then(async () => {
        if (loadState().findMode !== mode) return
        await updateNearbyMapForMode(mode)
      })
      .catch(err => console.warn(err))
  }

  function stationById(id) {
    return stations.find(s => s.id === id)
  }

  function clearBearingCache() {
    cachedBearing = null
    cachedBearingForStationId = null
    cachedBearingAt = null
  }

  /** Magnetic bearing; only recomputed when you move enough for GPS jitter not to flicker the arrow. */
  function bearingToStation(station) {
    if (!userPos || !station) return null
    const sameStation = cachedBearingForStationId === station.id
    const anchor = cachedBearingAt
    if (sameStation && anchor && cachedBearing != null) {
      const moved = distanceMeters(userPos.lat, userPos.lon, anchor.lat, anchor.lon)
      if (moved < 10) return cachedBearing
    }
    const trueDeg = bearingDeg(userPos.lat, userPos.lon, station.lat, station.lon)
    cachedBearing = trueBearingToMagnetic(trueDeg)
    cachedBearingForStationId = station.id
    cachedBearingAt = { lat: userPos.lat, lon: userPos.lon }
    return cachedBearing
  }

  function activeNearestStation() {
    const mode = loadState().findMode
    return nearestByMode[mode]?.station ?? null
  }

  function syncNearestMagneticBearing() {
    const station = activeNearestStation()
    nearestMagneticBearing = station ? bearingToStation(station) : null
  }

  function stopMapHeadingLoop() {
    if (mapHeadingFrame) {
      cancelAnimationFrame(mapHeadingFrame)
      mapHeadingFrame = null
    }
  }

  function startMapHeadingLoop() {
    stopMapHeadingLoop()
    const tick = () => {
      if (loadState().activeTab === 'nearby' && mapUserMarker) {
        updateUserMapArrowRotation()
        positionMapPinLabels()
        mapHeadingFrame = requestAnimationFrame(tick)
      } else {
        mapHeadingFrame = null
      }
    }
    mapHeadingFrame = requestAnimationFrame(tick)
  }

  async function ensureMapOrientation(fromUserGesture = false) {
    if (!compassSupported) return false
    if (!orientationHandler) startCompassListener()
    startMapHeadingLoop()
    if (deviceHeading != null) return true

    const pref = getCompassPref()
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (pref === '0') return false
      // Already granted earlier: listener is running; heading events usually
      // resume without another system dialog. Skip the overlay on reopen.
      if (!fromUserGesture) return pref === '1'
      // User gesture: re-call requestPermission. If already allowed at the OS
      // level this returns 'granted' with no dialog and unlocks heading.
      const granted = await requestCompassPermission()
      setCompassPref(granted ? '1' : '0')
      // Same tap also unlocks the deferred location watch so iOS shows the
      // motion and location prompts together instead of in separate steps.
      startPositionWatch()
      if (granted) {
        updateMapHeadingView()
        return true
      }
      return false
    }

    setCompassPref('1')
    startPositionWatch()
    return true
  }

  function mapBearingDeg() {
    if (deviceHeading == null) return 0
    return mapArrowRotation ?? deviceHeading ?? 0
  }

  function leafletContainerToWrapPoint(containerPt) {
    const mapEl = mapInstance?.getContainer()
    const wrap = mapEl?.parentElement
    if (!mapEl || !wrap) return containerPt
    const mapRect = mapEl.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    return {
      x: containerPt.x + (mapRect.left - wrapRect.left),
      y: containerPt.y + (mapRect.top - wrapRect.top),
    }
  }

  function geoToScreenPoint(lat, lon) {
    if (!mapInstance || !userPos) return null
    let containerPt
    if (deviceHeading == null) {
      containerPt = mapInstance.latLngToContainerPoint([lat, lon])
    } else {
      const layerPt = mapInstance.latLngToLayerPoint([lat, lon])
      const pivot = mapInstance.latLngToLayerPoint([userPos.lat, userPos.lon])
      const bearing = mapBearingDeg()
      const rad = (-bearing * Math.PI) / 180
      const dx = layerPt.x - pivot.x
      const dy = layerPt.y - pivot.y
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const rdx = dx * cos - dy * sin
      const rdy = dx * sin + dy * cos
      const center = mapInstance.getSize().divideBy(2)
      containerPt = { x: center.x + rdx, y: center.y + rdy }
    }
    return leafletContainerToWrapPoint(containerPt)
  }

  function applyMapOverscan(el) {
    const scale = MAP_ROTATION_COVERAGE
    el.style.width = `${scale * 100}%`
    el.style.height = `${scale * 100}%`
    el.style.position = 'absolute'
    el.style.left = '50%'
    el.style.top = '50%'
    el.style.margin = '0'
    el.style.border = 'none'
    el.style.borderRadius = '0'
    el.style.transform = 'translate(-50%, -50%)'
  }

  function clearMapOverscan(el) {
    if (!el) return
    el.style.width = ''
    el.style.height = ''
    el.style.position = ''
    el.style.left = ''
    el.style.top = ''
    el.style.margin = ''
    el.style.border = ''
    el.style.borderRadius = ''
    el.style.transform = ''
  }

  function positionMapPinLabels() {
    if (!mapInstance) return
    for (const { station, el } of mapPinLabels) {
      const pt = geoToScreenPoint(station.lat, station.lon)
      if (!pt) continue
      el.style.left = `${pt.x}px`
      el.style.top = `${pt.y}px`
    }
  }

  function syncMapView() {
    if (deviceHeading != null) applyMapPaneRotation()
    positionMapPinLabels()
  }

  function unbindMapViewSyncEvents() {
    if (mapInstance && mapViewSyncHandler) {
      mapInstance.off('move zoom viewreset moveend zoomend', mapViewSyncHandler)
    }
    mapViewSyncHandler = null
  }

  function clearMapPaneRotation() {
    const pane = mapInstance?.getPane('mapPane')
    if (pane) {
      pane.style.transform = ''
      pane.style.transformOrigin = ''
    }
  }

  function applyMapPaneRotation() {
    if (!mapInstance || !userPos || deviceHeading == null) return

    const pane = mapInstance.getPane('mapPane')
    if (!pane) return

    const bearing = mapBearingDeg()
    const panePos = mapInstance._getMapPanePos()
    const pivot = mapInstance.latLngToLayerPoint([userPos.lat, userPos.lon])

    pane.style.transformOrigin = `${pivot.x}px ${pivot.y}px`
    pane.style.transform = `translate3d(${panePos.x}px, ${panePos.y}px, 0) rotate(${-bearing}deg)`
  }

  function bindMapViewSyncEvents() {
    if (!mapInstance || mapViewSyncHandler) return
    mapViewSyncHandler = () => syncMapView()
    mapInstance.on('move zoom viewreset moveend zoomend', mapViewSyncHandler)
  }

  function buildMapPinLabels(nearest3, mode) {
    const labelsRoot = container.querySelector('#citibike-map-labels')
    if (!labelsRoot) return

    labelsRoot.replaceChildren()
    mapPinLabels = nearest3.map(({ station, dist }) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'citibike-map-pin-label-wrap'
      btn.setAttribute('aria-label', station.name)
      btn.innerHTML = mapPillsForMode(station, mode)
      btn.addEventListener('click', () => {
        ensureMapOrientation(true)
        openMapDrawer(station, dist)
      })
      labelsRoot.appendChild(btn)
      return { station, dist, el: btn }
    })
    positionMapPinLabels()
  }

  function destroyNearbyMap() {
    stopMapHeadingLoop()
    unbindMapViewSyncEvents()
    clearMapPaneRotation()
    mapPinLabels = []
    container.querySelector('#citibike-map-labels')?.replaceChildren()
    const mapEl = container.querySelector('#citibike-map')
    if (mapEl) {
      clearMapOverscan(mapEl)
      if (mapOrientationTapHandler) {
        mapEl.removeEventListener('click', mapOrientationTapHandler)
        mapOrientationTapHandler = null
      }
    }
    mapMarkers = []
    mapUserMarker = null
    if (mapInstance) {
      mapInstance.remove()
      mapInstance = null
    }
    mapAutoZoomApplied = false
    lastMapCenterLat = null
    lastMapCenterLon = null
    lastMapViewZoomApplied = null
  }

  function scheduleNearbyMoveRefresh() {
    if (nearbyMoveRefreshInFlight || nearbyMoveRefreshTimer) return
    nearbyMoveRefreshTimer = setTimeout(() => {
      nearbyMoveRefreshTimer = null
      refreshNearbyOnMove().catch(console.warn)
    }, NEARBY_MOVE_REFRESH_MS)
  }

  function cancelNearbyMoveRefresh() {
    if (nearbyMoveRefreshTimer) {
      clearTimeout(nearbyMoveRefreshTimer)
      nearbyMoveRefreshTimer = null
    }
  }

  async function refreshNearbyOnMove() {
    if (nearbyMoveRefreshInFlight || nearMeLoading || !userPos) return
    nearbyMoveRefreshInFlight = true
    try {
      stations = await fetchStations()
      lastFetchedAt = Date.now()
      nearMeAnchor = { lat: userPos.lat, lon: userPos.lon }
      clearBearingCache()
      recomputeNearestByMode()
      if (loadState().activeTab === 'nearby' && mapInstance) {
        await updateNearbyMapForMode(loadState().findMode)
      }
    } catch (err) {
      console.warn(err)
    } finally {
      nearbyMoveRefreshInFlight = false
    }
  }

  function updateMapHeadingView({ animate = false, force = false } = {}) {
    if (!mapInstance || !userPos) return

    const viewOpts = animate
      ? { animate: true, duration: MAP_ZOOM_ANIM_DURATION, easeLinearity: 0.22 }
      : { animate: false }

    const moved = lastMapCenterLat == null
      ? Infinity
      : distanceMeters(userPos.lat, userPos.lon, lastMapCenterLat, lastMapCenterLon)
    const zoomChanged = lastMapViewZoomApplied !== mapViewZoom
    const needsSetView = force || animate || zoomChanged || moved >= MAP_RECENTER_MOVE_M

    if (needsSetView) {
      mapInstance.setView([userPos.lat, userPos.lon], mapViewZoom, viewOpts)
      lastMapCenterLat = userPos.lat
      lastMapCenterLon = userPos.lon
      lastMapViewZoomApplied = mapViewZoom
    }

    const headingUp = deviceHeading != null
    const bearing = headingUp ? mapBearingDeg() : 0

    bindMapViewSyncEvents()
    if (headingUp) {
      applyMapPaneRotation()
    } else {
      clearMapPaneRotation()
    }
    positionMapPinLabels()

    const northDial = container.querySelector('.citibike-map-north-dial')
    if (northDial) {
      northDial.style.transform = headingUp ? `rotate(${-bearing}deg)` : ''
    }

    const inner = mapUserMarker?.getElement()?.querySelector('.citibike-map-user-arrow')
    if (inner) {
      inner.style.transform = headingUp ? 'rotate(0deg)' : `rotate(${mapArrowRotation ?? 0}deg)`
    }
  }

  function updateUserMapArrowRotation() {
    if (!mapUserMarker) return
    if (deviceHeading != null) {
      mapArrowRotation = smoothAngle(mapArrowRotation, deviceHeading, 0.4, 0.5)
    } else if (mapArrowRotation == null) {
      mapArrowRotation = 0
    }
    updateMapHeadingView()
  }

  function renderRackDetailStack(station, dist, mode, { includeCompass = true, includeWalkTime = false } = {}) {
    const distanceHtml = includeWalkTime ? formatDistanceWithWalk(dist) : formatDistance(dist)
    return `
      <div class="citibike-nearest-stack">
        ${availabilityNearbyStack(station)}
        <div class="citibike-nearest-stack-actions">
          <div class="citibike-nearest-compass-row">
            ${includeCompass ? `
              <button
                type="button"
                class="citibike-compass-btn citibike-compass-btn-lg${compassActive ? ' citibike-compass-live' : ''}"
                id="citibike-compass-btn"
                aria-label="${compassActive ? 'Live direction toward rack' : 'Tap to enable live direction'}"
              >
                <svg id="citibike-compass-arrow" class="citibike-compass-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.5 L19.5 21.5 L12 17.5 L4.5 21.5 Z" fill="currentColor"/>
                </svg>
              </button>
            ` : ''}
            <span class="citibike-nearest-distance citibike-nearest-distance-lg${includeWalkTime ? ' citibike-nearest-distance-drawer' : ''}">${distanceHtml}</span>
          </div>
          <button
            type="button"
            class="btn btn-cta btn-cta--wide citibike-directions-btn"
            data-directions-lat="${station.lat}"
            data-directions-lon="${station.lon}"
            data-directions-mode="${mode}"
          >Directions</button>
        </div>
      </div>
    `
  }

  function renderMapDrawerContent({ station, dist }, mode) {
    const isSaved = loadState().saved.some(s => s.stationId === station.id)
    return `
      <div class="citibike-map-drawer-title">${escapeHtml(station.name)}</div>
      ${renderRackDetailStack(station, dist, mode, { includeCompass: false, includeWalkTime: true })}
      <button
        type="button"
        class="btn btn-secondary citibike-map-drawer-save"
        data-save-station="${station.id}"
        ${isSaved ? 'disabled' : ''}
      >${isSaved ? 'Already saved' : 'Add to saved'}</button>
    `
  }

  function openMapDrawer(station, dist) {
    mapDrawerStation = { station, dist }
    rerender({ preserveSearch: true })
  }

  function closeMapDrawer() {
    mapDrawerStation = null
    rerender({ preserveSearch: true })
  }

  function syncModeIndicator({ animate = false } = {}) {
    container.querySelectorAll('.citibike-mode-switch').forEach(switchEl => {
      const idx = FIND_MODES.indexOf(
        switchEl.querySelector('.citibike-mode-btn.citibike-mode-active')?.dataset.findMode
          ?? loadState().findMode
      )
      if (idx >= 0) applyModeIndicatorAtIndex(switchEl, idx, { animate })
    })
  }

  function adjustMapZoom(direction) {
    if (!mapInstance || !userPos) return
    mapViewZoom = snapMapZoom(mapViewZoom + direction * MAP_ZOOM_STEP)
    updateMapHeadingView({ animate: true })
  }

  function syncModeSwitchUi(mode) {
    container.querySelectorAll('[data-find-mode]').forEach(btn => {
      btn.classList.toggle('citibike-mode-active', btn.dataset.findMode === mode)
    })
    requestAnimationFrame(() => syncModeIndicator({ animate: true }))
  }

  function nearbyModeLabel(mode) {
    if (mode === 'ebike') return 'e-bikes'
    if (mode === 'parking') return 'open docks'
    return 'bikes'
  }

  function updateNearbyMapOverlay(mode) {
    const wrap = container.querySelector('.citibike-map-wrap')
    if (!wrap || !userPos) return

    const items = findNearestN(stations, userPos.lat, userPos.lon, mode, MAP_NEAREST_COUNT)
    const overlay = wrap.querySelector('.citibike-map-overlay')
    if (!items.length && stations.length > 0) {
      const html = `<p class="citibike-map-status">No racks with ${nearbyModeLabel(mode)} nearby right now.</p>`
      if (overlay) overlay.innerHTML = html
      else wrap.insertAdjacentHTML('beforeend', `<div class="citibike-map-overlay">${html}</div>`)
      return
    }
    overlay?.remove()
  }

  function scheduleMapZoomForPins(L, nearest3, mode) {
    mapNearestPins = nearest3

    const apply = () => {
      if (!mapInstance || !userPos) return
      if (loadState().findMode !== mode) return

      if (!mapAutoZoomApplied) {
        mapViewZoom = resolveMapZoom(L, mapInstance, userPos, nearest3)
        mapAutoZoomApplied = true
      }
      updateMapHeadingView()
    }

    requestAnimationFrame(() => requestAnimationFrame(apply))
  }

  async function updateNearbyMapForMode(mode) {
    if (!mapInstance || !userPos) return
    const L = await loadLeaflet()

    mapMarkers.filter(marker => marker !== mapUserMarker).forEach(marker => marker.remove())
    mapMarkers = mapUserMarker ? [mapUserMarker] : []

    const nearest3 = findNearestN(stations, userPos.lat, userPos.lon, mode, MAP_NEAREST_COUNT)

    nearest3.forEach(({ station, dist }) => {
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 8,
        color: '#111111',
        fillColor: MAP_RACK_MARKER_FILL,
        fillOpacity: 1,
        weight: 2,
      }).addTo(mapInstance)
      marker.on('click', () => {
        ensureMapOrientation(true)
        openMapDrawer(station, dist)
      })
      mapMarkers.push(marker)
    })

    buildMapPinLabels(nearest3, mode)
    updateNearbyMapOverlay(mode)
    updateMapHeadingView()
  }

  function setFindMode(mode) {
    if (!FIND_MODES.includes(mode)) return
    const state = loadState()
    if (state.findMode === mode) return
    state.findMode = mode
    saveState(state)
    syncModeSwitchUi(mode)

    if (state.activeTab === 'nearby') {
      if (mapInstance && userPos) {
        enqueueMapModeRefresh(mode)
      } else {
        rerender({ preserveSearch: true })
      }
      return
    }

    rerender({ preserveSearch: state.activeTab === 'saved' })
  }

  function commitFindModeIndex(idx) {
    const mode = FIND_MODES[idx]
    if (!mode) return
    if (loadState().findMode === mode) {
      syncModeSwitchUi(mode)
      return
    }
    setFindMode(mode)
  }

  function renderNearbyMapPanel(state) {
    let overlay = ''
    if (loading && stations.length === 0) {
      overlay = '<p class="citibike-map-status">Loading stations…</p>'
    } else if (nearMeLoading || geoStatus === 'loading') {
      overlay = '<p class="citibike-map-status">Finding your location…</p>'
    } else if (geoStatus === 'denied' || geoStatus === 'error') {
      overlay = `
        <p class="citibike-map-status">${escapeHtml(geoError || 'Location unavailable.')}</p>
        <button type="button" class="btn btn-cta citibike-map-load">Try again</button>
      `
    } else if (!userPos) {
      overlay = `
        <p class="citibike-map-status">Show the 5 nearest racks on the map.</p>
        <button type="button" class="btn btn-cta citibike-map-load">${needsMotionPermissionPrompt() ? 'Enable live map' : 'Load map'}</button>
      `
    } else if (stations.length > 0) {
      const items = findNearestN(stations, userPos.lat, userPos.lon, state.findMode, MAP_NEAREST_COUNT)
      if (!items.length) {
        const modeLabel = state.findMode === 'ebike' ? 'e-bikes' : state.findMode === 'parking' ? 'open docks' : 'bikes'
        overlay = `<p class="citibike-map-status">No racks with ${modeLabel} nearby right now.</p>`
      }
    }

    const orientPrompt = userPos && !overlay && needsMotionPermissionPrompt()

    return `
      <div class="citibike-map-block">
        <div class="citibike-map-wrap">
          <div id="citibike-map" class="citibike-map" role="img" aria-label="Map of nearest Citibike racks"></div>
          <div id="citibike-map-labels" class="citibike-map-labels"></div>
          <div class="citibike-map-north" aria-hidden="true">
            <div class="citibike-map-north-compass">
              <div class="citibike-map-north-dial">
                <span class="citibike-map-north-arrow" aria-hidden="true">
                  <svg viewBox="0 0 12 8" aria-hidden="true">
                    <path d="M6 0 L11 7.5 H1 Z" fill="currentColor"/>
                  </svg>
                </span>
                <span class="citibike-map-north-needle">N</span>
              </div>
            </div>
          </div>
          ${orientPrompt ? `
            <div class="citibike-map-orient-prompt">
              <p class="citibike-map-status">Turn on live view so the map follows your location and the direction you're facing.</p>
              <button type="button" class="btn btn-cta citibike-map-orient-btn">Enable live map</button>
            </div>
          ` : ''}
          ${overlay ? `<div class="citibike-map-overlay">${overlay}</div>` : ''}
          <div class="citibike-map-zoom-controls" aria-label="Map zoom">
            <button type="button" class="citibike-map-zoom-btn" data-map-zoom="in" aria-label="Zoom in">+</button>
            <button type="button" class="citibike-map-zoom-btn" data-map-zoom="out" aria-label="Zoom out">−</button>
          </div>
        </div>
      </div>
    `
  }

  async function initNearbyMap(mode) {
    if (loadState().activeTab !== 'nearby') return
    const el = container.querySelector('#citibike-map')
    if (!el || !userPos) return

    const L = await loadLeaflet()
    destroyNearbyMap()
    applyMapOverscan(el)

    mapInstance = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomSnap: MAP_ZOOM_STEP,
      zoomDelta: MAP_ZOOM_STEP,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mapInstance)

    const nearest3 = findNearestN(stations, userPos.lat, userPos.lon, mode, MAP_NEAREST_COUNT)

    const userIcon = L.divIcon({
      className: 'citibike-map-user-icon',
      html: userMapArrowIconHtml(0),
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
    mapUserMarker = L.marker([userPos.lat, userPos.lon], {
      icon: userIcon,
      zIndexOffset: 1000,
    }).addTo(mapInstance)
    mapMarkers.push(mapUserMarker)

    ensureMapOrientation()
    if (getCompassPref() === '1') {
      tryRestoreCompass().catch(console.warn)
    }

    nearest3.forEach((item, i) => {
      const { station, dist } = item
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 8,
        color: '#111111',
        fillColor: MAP_RACK_MARKER_FILL,
        fillOpacity: 1,
        weight: 2,
      }).addTo(mapInstance)
      marker.on('click', () => {
        ensureMapOrientation(true)
        openMapDrawer(station, dist)
      })
      mapMarkers.push(marker)
    })

    buildMapPinLabels(nearest3, mode)
    if (mapOrientationTapHandler) {
      el.removeEventListener('click', mapOrientationTapHandler)
    }
    mapOrientationTapHandler = () => ensureMapOrientation(true)
    el.addEventListener('click', mapOrientationTapHandler)

    scheduleMapZoomForPins(L, nearest3, mode)
    updateMapHeadingView({ force: true })
  }

  function rerender({ preserveSearch = false } = {}) {
    destroyNearbyMap()
    const prevSearchEl = preserveSearch ? container.querySelector('#citibike-search') : null
    const searchVal = prevSearchEl?.value ?? ''
    const searchFocused = preserveSearch && document.activeElement === prevSearchEl

    const state = loadState()
    const saved = state.saved
      .map(entry => {
        const station = stationById(entry.stationId)
        return station ? { ...entry, station } : null
      })
      .filter(Boolean)

    const nearest = nearMeNeedsLoad() ? null : nearestByMode[state.findMode]
    nearestMagneticBearing = nearest?.station
      ? bearingToStation(nearest.station)
      : null

    container.innerHTML = `
      <div class="view${state.activeTab === 'nearby' ? ' citibike-view--nearby' : ''}" id="view-citibike">
        <header class="header">
          <div class="header-left">
            <button class="btn btn-icon menu-grid-btn header-menu-btn" id="btn-citibike-home" aria-label="Menu">
              <span class="menu-grid-icon" aria-hidden="true"></span>
            </button>
          </div>
          <div class="header-title">Citibike</div>
        </header>

        <div class="scroll citibike-scroll citibike-pull-host">
          <div class="citibike-pull-head" aria-hidden="true">
            ${CITIBIKE_PULL_ICON_SVG}
          </div>
          <div class="citibike-pull-body">
          <div class="citibike-tab-panel${state.activeTab === 'nearby' ? ' citibike-tab-panel-active' : ''}" id="citibike-panel-nearby">
            ${renderNearbyMapPanel(state)}
          </div>

          <div class="citibike-tab-panel${state.activeTab === 'saved' ? ' citibike-tab-panel-active' : ''}" id="citibike-panel-saved">
            <div class="citibike-racks-block">
              <ul class="item-list citibike-saved-list">
                ${loading && saved.length === 0 ? `<li style="list-style:none"><div class="empty-state citibike-empty"><p>Loading stations…</p></div></li>` : ''}
                ${!loading && error ? `<li style="list-style:none"><div class="empty-state citibike-empty"><p>${escapeHtml(error)}</p></div></li>` : ''}
                ${!loading && !error && saved.length === 0 ? `<li style="list-style:none"><div class="empty-state citibike-empty"><p>Add racks you check often — search below.</p></div></li>` : ''}
                ${saved.map(entry => renderSaved(entry)).join('')}
              </ul>
              <div class="issues-add-wrap citibike-add-wrap">
                <input
                  class="input"
                  id="citibike-search"
                  type="search"
                  placeholder="Search racks to add…"
                  autocomplete="off"
                />
                <div class="citibike-search-results hidden" id="citibike-search-results"></div>
              </div>
            </div>
          </div>
          </div>
        </div>

        ${state.activeTab === 'nearby' ? `
          <div class="citibike-map-mode-dock">
            ${renderModeSwitch(state, 'Map filter')}
          </div>
        ` : ''}

        <nav class="citibike-tab-bar" aria-label="Citibike sections">
          <button
            type="button"
            class="citibike-tab-btn${state.activeTab === 'nearby' ? ' citibike-tab-active' : ''}"
            data-citibike-tab="nearby"
            aria-selected="${state.activeTab === 'nearby' ? 'true' : 'false'}"
          >Nearby</button>
          <button
            type="button"
            class="citibike-tab-btn${state.activeTab === 'saved' ? ' citibike-tab-active' : ''}"
            data-citibike-tab="saved"
            aria-selected="${state.activeTab === 'saved' ? 'true' : 'false'}"
          >Saved</button>
        </nav>

        <div class="modal-backdrop${mapDrawerStation ? '' : ' hidden'}" id="citibike-map-drawer">
          <div class="modal citibike-map-drawer-modal">
            <div class="modal-handle"></div>
            ${mapDrawerStation ? renderMapDrawerContent(mapDrawerStation, state.findMode) : ''}
          </div>
        </div>

        <div class="modal-backdrop${editingStationId ? '' : ' hidden'}" id="citibike-edit-modal">
          <div class="modal">
            <div class="modal-handle"></div>
            <div class="modal-title">Edit rack</div>
            <input class="input" id="citibike-edit-label" type="text" maxlength="80" placeholder="Custom label (optional)" autocomplete="off" />
            <p class="diet-modal-hint" id="citibike-edit-name"></p>
            <div class="modal-actions">
              <button class="btn btn-secondary" id="citibike-edit-cancel" type="button">Cancel</button>
              <button class="btn btn-primary" id="citibike-edit-save" type="button">Save</button>
            </div>
            <button class="btn btn-danger citibike-edit-remove" id="citibike-edit-remove" type="button">Remove rack</button>
          </div>
        </div>

      </div>
    `

    bind(state)
    if (preserveSearch) {
      const search = container.querySelector('#citibike-search')
      if (search) {
        search.value = searchVal
        if (searchFocused) search.focus({ preventScroll: true })
      }
    }
    scheduleCompassUpdate()
    if (compassActive) startCompassListener()
  }

  function stopCompassListener() {
    if (arrowFrame) {
      cancelAnimationFrame(arrowFrame)
      arrowFrame = null
    }
    if (orientationHandler && orientationEvent) {
      window.removeEventListener(orientationEvent, orientationHandler, true)
    }
    orientationHandler = null
    orientationEvent = null
  }

  function startCompassListener() {
    stopCompassListener()
    orientationEvent = orientationEventName()
    orientationHandler = e => {
      const heading = headingFromOrientationEvent(e)
      if (heading == null) return
      deviceHeading = smoothAngle(deviceHeading, heading, 0.22, 2)
      scheduleCompassUpdate()
    }
    window.addEventListener(orientationEvent, orientationHandler, true)
  }

  function scheduleCompassUpdate() {
    if (arrowFrame) return
    arrowFrame = requestAnimationFrame(() => {
      arrowFrame = null
      updateCompassArrow()
    })
  }

  function setCompassLive(live) {
    const btn = container.querySelector('#citibike-compass-btn')
    if (!btn) return
    btn.classList.toggle('citibike-compass-live', live)
    btn.setAttribute(
      'aria-label',
      live ? 'Live direction toward rack' : 'Tap to enable live direction'
    )
  }

  function updateCompassArrow() {
    const arrow = container.querySelector('#citibike-compass-arrow')
    syncNearestMagneticBearing()
    if (arrow && nearestMagneticBearing != null) {
      const target = arrowRotationDeg(
        nearestMagneticBearing,
        deviceHeading,
        compassActive
      )
      displayArrowRotation = smoothAngle(displayArrowRotation, target, 0.28, 3)
      arrow.style.transform = `rotate3d(0, 0, 1, ${displayArrowRotation}deg)`
    }
    updateUserMapArrowRotation()
  }

  async function enableCompass(fromUserTap = false) {
    if (!compassSupported || compassActive) return
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (!fromUserTap) return
        const granted = await requestCompassPermission()
        if (!granted) {
          setCompassPref('0')
          return
        }
      }
      compassActive = true
      setCompassPref('1')
      deviceHeading = null
      displayArrowRotation = null
      startCompassListener()
      setCompassLive(true)
      scheduleCompassUpdate()
      rerender({ preserveSearch: true })
    } catch (err) {
      console.warn('Compass permission failed:', err)
    }
  }

  async function tryRestoreCompass() {
    if (!compassSupported || compassActive) return
    if (getCompassPref() !== '1') return

    startCompassListener()
    startMapHeadingLoop()
    await new Promise(resolve => setTimeout(resolve, 450))
    if (deviceHeading == null) {
      // Permission remembered, but iOS may need one more gesture to resume
      // events — keep the listener and map tap handler; don't clear the pref
      // or show the full-screen prompt again.
      return
    }
    compassActive = true
    setCompassLive(true)
    scheduleCompassUpdate()
  }

  function nearMeNeedsLoad() {
    if (!nearMeLoadedAt || !nearMeAnchor) return true
    if (userPos) {
      const moved = distanceMeters(
        userPos.lat, userPos.lon, nearMeAnchor.lat, nearMeAnchor.lon
      )
      if (moved > NEAR_ME_MOVE_M) return true
    }
    return false
  }

  function nearMeLoadHint() {
    if (!nearMeLoadedAt) {
      return 'Tap Load to find the nearest rack for Any bike, E-bike, and Parking.'
    }
    return 'You\'ve moved to a new area. Tap Load to refresh nearby racks.'
  }

  function wrapNearestCard(headerHtml, bodyHtml, filled = false) {
    return `
      <div class="citibike-nearest-card citibike-nearest-card--stable">
        <div class="citibike-nearest-header">${headerHtml}</div>
        <div class="citibike-nearest-card-body${filled ? ' citibike-nearest-card-body--filled' : ''}">${bodyHtml}</div>
      </div>
    `
  }

  function nearestStatusHtml({ showAgo = false, loading = false } = {}) {
    if (showAgo && nearMeLoadedAt) {
      return `
        <div class="citibike-nearest-status">
          <span id="citibike-near-ago" class="citibike-near-ago">${formatNearMeAgo(nearMeSecondsAgo(nearMeLoadedAt))}</span>
        </div>
      `
    }
    return `
      <div class="citibike-nearest-status">
        <span class="citibike-near-ago citibike-near-ago--idle" aria-hidden="true">${loading ? '…' : ''}</span>
      </div>
    `
  }

  function nearestHeaderHtml(title, statusOpts) {
    return `
      <span class="item-title citibike-nearest-name">${escapeHtml(title)}</span>
      ${nearestStatusHtml(statusOpts)}
    `
  }

  function stopNearMeAgo() {
    if (nearMeAgoTimer) {
      clearInterval(nearMeAgoTimer)
      nearMeAgoTimer = null
    }
  }

  function startNearMeAgo() {
    stopNearMeAgo()
    const tick = () => {
      const el = container.querySelector('#citibike-near-ago')
      if (!el || !nearMeLoadedAt) {
        stopNearMeAgo()
        return
      }
      el.textContent = formatNearMeAgo(nearMeSecondsAgo(nearMeLoadedAt))
    }
    tick()
    nearMeAgoTimer = setInterval(tick, 1000)
  }

  function recomputeNearestByMode() {
    if (!userPos || stations.length === 0) {
      nearestByMode = { bike: null, ebike: null, parking: null }
      return
    }
    const { lat, lon } = userPos
    nearestByMode = {
      bike: findNearest(stations, lat, lon, 'bike'),
      ebike: findNearest(stations, lat, lon, 'ebike'),
      parking: findNearest(stations, lat, lon, 'parking'),
    }
  }

  function settlePositionFixWaiters(err) {
    const waiters = positionFixWaiters
    positionFixWaiters = []
    waiters.forEach(({ resolve, reject }) => {
      if (err) reject(err)
      else resolve(userPos)
    })
  }

  function applyUserPosition(pos) {
    userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude }
    saveCachedUserPosition(userPos, nearMeAnchor || userPos)
    const geoHeading = pos.coords.heading
    if (typeof geoHeading === 'number' && !Number.isNaN(geoHeading) && geoHeading >= 0) {
      deviceHeading = smoothAngle(deviceHeading, geoHeading, 0.4, 0.5)
    }
    if (positionFixWaiters.length) settlePositionFixWaiters()
  }

  function stopPositionWatch() {
    if (positionWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(positionWatchId)
      positionWatchId = null
    }
    positionWatchStarted = false
    settlePositionFixWaiters(Object.assign(new Error('Location watch stopped'), { code: 2 }))
  }

  function startPositionWatch() {
    if (!navigator.geolocation || positionWatchStarted) return
    positionWatchStarted = true
    positionWatchId = navigator.geolocation.watchPosition(
      pos => {
        applyUserPosition(pos)
        if (nearMeLoadedAt && nearMeNeedsLoad()) {
          scheduleNearbyMoveRefresh()
        }
        if (loadState().activeTab === 'nearby' && userPos) {
          if (mapUserMarker && mapInstance) {
            mapUserMarker.setLatLng([userPos.lat, userPos.lon])
            updateUserMapArrowRotation()
          } else if (!nearMeLoading) {
            initNearbyMap(loadState().findMode).catch(console.warn)
          }
        }
        if (compassActive || activeNearestStation() || mapUserMarker) {
          scheduleCompassUpdate()
        }
      },
      err => {
        if (positionFixWaiters.length) settlePositionFixWaiters(err)
        if (!userPos) {
          geoStatus = err?.code === 1 ? 'denied' : 'error'
          geoError = err?.code === 1
            ? 'Location access is off. Enable it in Settings to find the nearest rack.'
            : 'Could not get your location. Try again when you have a GPS signal.'
        }
      },
      { enableHighAccuracy: true, maximumAge: 120000, timeout: 20000 }
    )
  }

  function waitForFirstPosition(timeoutMs = 12000) {
    if (userPos) return Promise.resolve(userPos)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        positionFixWaiters = positionFixWaiters.filter(w => w.reject !== reject)
        reject(Object.assign(new Error('Location timeout'), { code: 3 }))
      }, timeoutMs)
      positionFixWaiters.push({
        resolve: pos => {
          clearTimeout(timer)
          resolve(pos)
        },
        reject: err => {
          clearTimeout(timer)
          reject(err)
        },
      })
      startPositionWatch()
    })
  }

  function restoreCachedUserPosition() {
    const cached = loadCachedUserPosition()
    if (!cached) return false
    userPos = { lat: cached.lat, lon: cached.lon }
    nearMeAnchor = { lat: cached.anchorLat, lon: cached.anchorLon }
    nearMeLoadedAt = cached.at
    geoStatus = 'ready'
    return true
  }

  async function refreshTabData(tab) {
    if (tab === 'saved') {
      await loadStations()
      return
    }
    await loadNearMe()
  }

  compassCleanup = () => {
    stopMapHeadingLoop()
    stopCompassListener()
    stopPositionWatch()
    stopNearMeAgo()
    cancelNearbyMoveRefresh()
    destroyNearbyMap()
    pullCleanup?.()
    pullCleanup = null
    modeSwipeCleanup?.()
    modeSwipeCleanup = null
    positionFixWaiters = []
    compassCleanup = null
  }

  function renderNearestCard(nearest, mode, geo, geoErr) {
    if (loading && stations.length === 0) {
      return wrapNearestCard(
        nearestHeaderHtml('Nearest', { loading: true }),
        '<p class="citibike-nearest-empty citibike-nearest-body-msg">Loading station data…</p>'
      )
    }
    if (nearMeLoading) {
      return wrapNearestCard(
        nearestHeaderHtml('Nearest', { loading: true }),
        '<p class="citibike-nearest-empty citibike-nearest-body-msg">Finding nearby racks…</p>'
      )
    }
    if (geo === 'denied' || geo === 'error') {
      return wrapNearestCard(
        nearestHeaderHtml('Nearest', {}),
        `<p class="citibike-nearest-empty citibike-nearest-body-msg">${escapeHtml(geoErr || 'Location unavailable.')}</p><button class="btn btn-secondary citibike-retry-geo citibike-nearest-body-action" type="button">Try again</button>`
      )
    }
    if (nearMeNeedsLoad()) {
      return wrapNearestCard(
        nearestHeaderHtml('Nearest', {}),
        `<p class="citibike-nearest-empty citibike-nearest-body-msg">${escapeHtml(nearMeLoadHint())}</p><button class="btn btn-primary citibike-load-near citibike-nearest-body-action" type="button">Load</button>`
      )
    }
    if (!nearest) {
      const modeLabel = mode === 'ebike' ? 'e-bikes' : mode === 'parking' ? 'open docks' : 'bikes'
      return wrapNearestCard(
        nearestHeaderHtml('Nearest', { showAgo: true }),
        `<p class="citibike-nearest-empty citibike-nearest-body-msg">No racks with ${modeLabel} nearby right now.</p><button class="btn btn-secondary citibike-load-near citibike-nearest-body-action" type="button">Load again</button>`
      )
    }

    const { station, dist } = nearest

    return wrapNearestCard(
      nearestHeaderHtml(station.name, { showAgo: true }),
      renderRackDetailStack(station, dist, mode, { includeCompass: true }),
      true
    )
  }

  function renderSaved(entry) {
    const { station, label, stationId } = entry
    const nickname = label.trim()

    return `
      <li class="item citibike-saved-item">
        <button class="citibike-saved-row" type="button" data-edit-station="${stationId}">
          <div class="citibike-row-main">
            <span class="item-title issue-title">${escapeHtml(station.name)}</span>
            ${nickname ? `<span class="item-subtitle">${escapeHtml(nickname)}</span>` : ''}
          </div>
          ${availabilityAside(station)}
        </button>
      </li>
    `
  }

  function bind(state) {
    pullCleanup?.()
    modeSwipeCleanup?.()

    if (state.activeTab === 'nearby') {
      const nearbyView = container.querySelector('#view-citibike')
      modeSwipeCleanup = attachNearbyModeDrag(nearbyView, {
        canDrag: () => !mapDrawerStation,
        getModeIndex: () => FIND_MODES.indexOf(loadState().findMode),
        getModeSwitch: () => container.querySelector('.citibike-map-mode-dock .citibike-mode-switch'),
        onCommitIndex: idx => commitFindModeIndex(idx),
      })
    } else {
      const scrollEl = container.querySelector('.citibike-scroll')
      pullCleanup = attachCitibikePullRefresh(scrollEl, () => {
        const tab = loadState().activeTab
        return refreshTabData(tab)
      })
    }

    container.querySelector('#btn-citibike-home')?.addEventListener('click', () => navigate('home'))

    const mapDrawer = container.querySelector('#citibike-map-drawer')
    mapDrawer?.addEventListener('click', e => {
      if (e.target === mapDrawer) closeMapDrawer()
    })
    container.querySelectorAll('[data-save-station]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return
        addSaved(btn.dataset.saveStation)
        mapDrawerStation = null
        rerender({ preserveSearch: true })
      })
    })

    container.querySelectorAll('[data-citibike-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.citibikeTab
        if (!['nearby', 'saved'].includes(tab)) return
        const next = loadState()
        if (next.activeTab === tab) return
        next.activeTab = tab
        if (tab !== 'nearby') mapDrawerStation = null
        saveState(next)
        rerender({ preserveSearch: tab === 'saved' })
        refreshTabData(tab)
      })
    })

    container.querySelectorAll('.citibike-map-orient-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await ensureMapOrientation(true)
        } catch (err) {
          console.warn('Motion permission failed:', err)
        }
        rerender({ preserveSearch: true })
      })
    })

    container.querySelectorAll('.citibike-map-load').forEach(btn => {
      btn.addEventListener('click', () => loadNearMeFromTap())
    })

    container.querySelectorAll('.citibike-load-near').forEach(btn => {
      btn.addEventListener('click', () => loadNearMeFromTap())
    })

    if (nearMeLoadedAt && !nearMeNeedsLoad() && !nearMeLoading) {
      startNearMeAgo()
    } else {
      stopNearMeAgo()
    }

    container.querySelectorAll('.citibike-directions-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = Number(btn.dataset.directionsLat)
        const lon = Number(btn.dataset.directionsLon)
        const mode = btn.dataset.directionsMode
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
        const url = googleMapsDirectionsUrl(lat, lon, mode, userPos)
        window.open(url, '_blank', 'noopener,noreferrer')
      })
    })

    container.querySelector('.citibike-retry-geo')?.addEventListener('click', () => {
      loadNearMeFromTap()
    })

    container.querySelector('#citibike-compass-btn')?.addEventListener('click', () => {
      if (!compassActive) enableCompass(true)
    })

    container.querySelectorAll('[data-find-mode]').forEach(btn => {
      btn.addEventListener('click', () => setFindMode(btn.dataset.findMode))
    })

    container.querySelectorAll('[data-map-zoom]').forEach(btn => {
      btn.addEventListener('click', () => {
        adjustMapZoom(btn.dataset.mapZoom === 'in' ? 1 : -1)
      })
    })

    if (state.activeTab === 'nearby' && userPos && !nearMeLoading) {
      initNearbyMap(state.findMode).catch(console.warn)
    }

    syncModeIndicator({ animate: false })

    const search = container.querySelector('#citibike-search')
    const results = container.querySelector('#citibike-search-results')

    search?.addEventListener('input', () => {
      const q = String(search.value || '').trim().toLowerCase()
      if (!q) {
        results.classList.add('hidden')
        results.innerHTML = ''
        return
      }
      const savedIds = new Set(loadState().saved.map(s => s.stationId))
      const matches = stations
        .filter(s => s.name.toLowerCase().includes(q))
        .slice(0, 10)
      if (matches.length === 0) {
        results.classList.remove('hidden')
        results.innerHTML = `<p class="citibike-search-empty">No racks match “${escapeHtml(q)}”.</p>`
        return
      }
      results.classList.remove('hidden')
      results.innerHTML = matches.map(s => `
        <button class="citibike-search-hit" type="button" data-station-pick="${s.id}" ${savedIds.has(s.id) ? 'disabled' : ''}>
          <span>${escapeHtml(s.name)}</span>
          <span class="citibike-search-meta">${availabilityText(s)}</span>
        </button>
      `).join('')
    })

    results?.addEventListener('click', e => {
      const btn = e.target.closest('[data-station-pick]')
      if (!btn || btn.disabled) return
      addSaved(btn.dataset.stationPick)
      search.value = ''
      results.classList.add('hidden')
      results.innerHTML = ''
      search.blur()
    })

    container.querySelectorAll('[data-edit-station]').forEach(btn => {
      btn.addEventListener('click', () => {
        openEditModal(btn.dataset.editStation)
      })
    })

    const modal = container.querySelector('#citibike-edit-modal')
    const editInput = container.querySelector('#citibike-edit-label')
    modal?.addEventListener('click', e => {
      if (e.target === modal) closeEditModal()
    })
    container.querySelector('#citibike-edit-cancel')?.addEventListener('click', closeEditModal)
    container.querySelector('#citibike-edit-save')?.addEventListener('click', saveEditModal)
    container.querySelector('#citibike-edit-remove')?.addEventListener('click', () => {
      if (!editingStationId) return
      const id = editingStationId
      editingStationId = null
      removeSaved(id)
    })
    editInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveEditModal()
      if (e.key === 'Escape') closeEditModal()
    })

    if (editingStationId) {
      const entry = loadState().saved.find(s => s.stationId === editingStationId)
      const station = stationById(editingStationId)
      if (entry && station) {
        editInput.value = entry.label || ''
        container.querySelector('#citibike-edit-name').textContent = station.name
        setTimeout(() => editInput.focus(), 50)
      } else {
        editingStationId = null
      }
    }
  }

  function availabilityText(station) {
    if (station.isOffline) return 'Offline'
    return `${station.classic} classic · ${station.ebikes} e-bike · ${station.docks} dock`
  }

  function addSaved(stationId) {
    const next = loadState()
    if (next.saved.some(s => s.stationId === stationId)) return
    next.saved.push({ stationId, label: '' })
    saveState(next)
    rerender()
  }

  function removeSaved(stationId) {
    editingStationId = null
    const next = loadState()
    next.saved = next.saved.filter(s => s.stationId !== stationId)
    saveState(next)
    rerender()
  }

  function openEditModal(stationId) {
    editingStationId = stationId
    rerender()
  }

  function closeEditModal() {
    editingStationId = null
    rerender()
  }

  function saveEditModal() {
    if (!editingStationId) return
    const input = container.querySelector('#citibike-edit-label')
    const label = String(input?.value || '').trim()
    const next = loadState()
    const idx = next.saved.findIndex(s => s.stationId === editingStationId)
    if (idx === -1) return
    next.saved[idx].label = label
    saveState(next)
    editingStationId = null
    rerender()
  }

  async function loadStations({ silent = false } = {}) {
    if (!silent) {
      loading = true
      error = ''
      rerender()
    }
    try {
      stations = await fetchStations()
      lastFetchedAt = Date.now()
      if (!silent) loading = false
    } catch (err) {
      if (!silent) {
        loading = false
        error = 'Could not load live rack data. Check your connection and try again.'
      }
      console.error(err)
    }
    rerender({ preserveSearch: silent })
  }

  /** One tap requests motion access (if pending) and location together. */
  async function loadNearMeFromTap() {
    if (needsMotionPermissionPrompt()) {
      try {
        await ensureMapOrientation(true)
      } catch (err) {
        console.warn('Motion permission failed:', err)
      }
    }
    await loadNearMe({ fromUserGesture: true })
  }

  async function loadNearMe({ fromUserGesture = false } = {}) {
    if (nearMeLoading) return
    nearMeLoading = true
    geoStatus = userPos ? 'ready' : 'loading'
    geoError = ''
    if (!userPos) restoreCachedUserPosition()
    rerender({ preserveSearch: true })
    try {
      stations = await fetchStations()
      lastFetchedAt = Date.now()
      loading = false
      error = ''
      mapAutoZoomApplied = false

      // While the iOS motion prompt is still pending, don't auto-trigger the
      // location prompt — the live-view tap requests both permissions at once.
      const deferLocationForMotion = !fromUserGesture && needsMotionPermissionPrompt()

      if (!userPos) {
        if (deferLocationForMotion) {
          geoStatus = 'idle'
          return
        }
        await waitForFirstPosition()
      } else if (!deferLocationForMotion) {
        startPositionWatch()
      }

      geoStatus = 'ready'
      geoError = ''

      nearMeAnchor = { lat: userPos.lat, lon: userPos.lon }
      saveCachedUserPosition(userPos, nearMeAnchor)
      clearBearingCache()
      recomputeNearestByMode()
      nearMeLoadedAt = Date.now()
      displayArrowRotation = null

      await tryRestoreCompass()
      scheduleCompassUpdate()
    } catch (err) {
      if (!userPos) {
        geoStatus = err?.code === 1 ? 'denied' : 'error'
        geoError = err?.code === 1
          ? 'Location access is off. Enable it in Settings to find the nearest rack.'
          : 'Could not get your location. Try again when you have a GPS signal.'
      }
      console.warn(err)
    } finally {
      nearMeLoading = false
      rerender({ preserveSearch: true })
    }
  }

  restoreCachedUserPosition()
  const initialTab = loadState().activeTab
  refreshTabData(initialTab)
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatFetchedAt(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 8) return 'just now'
  if (sec < 60) return `${sec}s ago`
  return `${Math.round(sec / 60)}m ago`
}
