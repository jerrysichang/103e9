const KEY = 'ps_citibike_v1'
const COMPASS_PREF_KEY = 'ps_citibike_compass_on'
const GBFS_BASE = 'https://gbfs.citibikenyc.com/gbfs/en'
const NEAR_ME_MOVE_M = 120
/** NYC-area magnetic declination (degrees west of true north). iOS webkitCompassHeading is magnetic. */
const MAGNETIC_DECLINATION_WEST_DEG = 12.5

const DEFAULT_STATE = {
  saved: [],
  findMode: 'bike',
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed?.stationIds) && !parsed?.saved) {
      return {
        saved: parsed.stationIds.map(stationId => ({ stationId, label: '' })),
        findMode: 'bike',
      }
    }

    return {
      saved: Array.isArray(parsed?.saved)
        ? parsed.saved
          .filter(s => s && s.stationId)
          .map(s => ({ stationId: String(s.stationId), label: String(s.label || '') }))
        : [],
      findMode: ['bike', 'ebike', 'parking'].includes(parsed?.findMode) ? parsed.findMode : 'bike',
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
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

function stationMatchesMode(station, mode) {
  if (station.isOffline) return false
  if (mode === 'bike') return station.bikes > 0
  if (mode === 'ebike') return station.ebikes > 0
  if (mode === 'parking') return station.docks > 0
  return false
}

function findNearest(stations, lat, lon, mode) {
  let nearest = null
  let nearestDist = Infinity
  for (const station of stations) {
    if (!stationMatchesMode(station, mode)) continue
    const dist = distanceMeters(lat, lon, station.lat, station.lon)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = { station, dist }
    }
  }
  return nearest
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
      ${availabilityCapacityBar(station)}
      <div class="citibike-pills-wrap">${availabilityPillsRow(station)}</div>
    </div>
  `
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

function availabilityCapacityBar(station) {
  if (station.isOffline) {
    return '<div class="citibike-cap-bar citibike-cap-bar--offline" aria-hidden="true"></div>'
  }
  const classic = station.classic
  const ebikes = station.ebikes
  const docks = station.docks
  const total = classic + ebikes + docks
  if (total === 0) {
    return '<div class="citibike-cap-bar" aria-hidden="true"><span class="citibike-cap-seg citibike-cap-empty"></span></div>'
  }
  const segs = []
  if (classic > 0) segs.push(`<span class="citibike-cap-seg citibike-cap-bike" style="flex:${classic}"></span>`)
  if (ebikes > 0) segs.push(`<span class="citibike-cap-seg citibike-cap-ebike" style="flex:${ebikes}"></span>`)
  if (docks > 0) segs.push(`<span class="citibike-cap-seg citibike-cap-dock" style="flex:${docks}"></span>`)
  return `<div class="citibike-cap-bar" aria-hidden="true">${segs.join('')}</div>`
}

function nearMeSecondsAgo(loadedAt) {
  if (!loadedAt) return 0
  return Math.max(0, Math.floor((Date.now() - loadedAt) / 1000))
}

function formatNearMeAgo(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')} ago`
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
  return null
}

function smoothHeading(prev, next) {
  if (prev == null) return next
  let delta = ((next - prev + 540) % 360) - 180
  if (Math.abs(delta) < 3) return prev
  return (prev + delta * 0.12 + 360) % 360
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
  let compassHeadingIsTrueNorth = false
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
  let nearMeAgoTimer = null

  function stationById(id) {
    return stations.find(s => s.id === id)
  }

  function bearingToStation(station) {
    if (!userPos || !station) return null
    const trueDeg = bearingDeg(userPos.lat, userPos.lon, station.lat, station.lon)
    if (compassHeadingIsTrueNorth) return trueDeg
    return trueBearingToMagnetic(trueDeg)
  }

  function activeNearestStation() {
    const mode = loadState().findMode
    return nearestByMode[mode]?.station ?? null
  }

  function syncNearestMagneticBearing() {
    const station = activeNearestStation()
    nearestMagneticBearing = station ? bearingToStation(station) : null
  }

  function rerender({ preserveSearch = false } = {}) {
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
      <div class="view" id="view-citibike">
        <header class="header">
          <div class="header-title">Citibike</div>
        </header>

        <div class="scroll">
          <div class="citibike-near-block">
            <h3 class="text-h3 citibike-block-title">Nearest</h3>

            <div class="citibike-mode-switch" role="tablist" aria-label="Find nearest">
              <button type="button" class="citibike-mode-btn${state.findMode === 'bike' ? ' citibike-mode-active' : ''}" data-find-mode="bike" role="tab">Any bike</button>
              <button type="button" class="citibike-mode-btn${state.findMode === 'ebike' ? ' citibike-mode-active' : ''}" data-find-mode="ebike" role="tab">E-bike</button>
              <button type="button" class="citibike-mode-btn${state.findMode === 'parking' ? ' citibike-mode-active' : ''}" data-find-mode="parking" role="tab">Parking</button>
            </div>

            ${renderNearestCard(nearest, state.findMode, geoStatus, geoError)}
          </div>

          <div class="citibike-racks-block">
            <h3 class="text-h3 citibike-block-title citibike-racks-title">Saved</h3>

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

        <button class="btn btn-icon menu-grid-btn menu-fab" id="btn-citibike-home" aria-label="Menu">
          <span class="menu-grid-icon" aria-hidden="true"></span>
        </button>
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
      compassHeadingIsTrueNorth = false
      deviceHeading = smoothHeading(deviceHeading, heading)
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
    if (!arrow || nearestMagneticBearing == null) return
    const rotation = arrowRotationDeg(
      nearestMagneticBearing,
      deviceHeading,
      compassActive
    )
    arrow.style.transform = `rotate3d(0, 0, 1, ${rotation}deg)`
  }

  async function enableCompass(fromUserTap = false) {
    if (!compassSupported || compassActive) return
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (!fromUserTap) return
        const granted = await requestCompassPermission()
        if (!granted) return
      }
      compassActive = true
      sessionStorage.setItem(COMPASS_PREF_KEY, '1')
      deviceHeading = null
      compassHeadingIsTrueNorth = false
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
    if (sessionStorage.getItem(COMPASS_PREF_KEY) !== '1') return

    startCompassListener()
    await new Promise(resolve => setTimeout(resolve, 450))
    if (deviceHeading == null) {
      stopCompassListener()
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
          <button type="button" class="btn btn-icon citibike-near-refresh" aria-label="Refresh nearby">↻</button>
        </div>
      `
    }
    return `
      <div class="citibike-nearest-status">
        <span class="citibike-near-ago citibike-near-ago--idle" aria-hidden="true">${loading ? '…' : ''}</span>
        <button type="button" class="btn btn-icon citibike-near-refresh"${loading ? ' disabled' : ''} aria-label="Refresh nearby">↻</button>
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

  function stopPositionWatch() {
    if (positionWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(positionWatchId)
      positionWatchId = null
    }
  }

  function startPositionWatch() {
    if (!navigator.geolocation || positionWatchId != null) return
    positionWatchId = navigator.geolocation.watchPosition(
      pos => {
        userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        if (
          compassActive
          && typeof pos.coords.heading === 'number'
          && !Number.isNaN(pos.coords.heading)
          && pos.coords.heading >= 0
        ) {
          compassHeadingIsTrueNorth = true
          deviceHeading = smoothHeading(deviceHeading, pos.coords.heading)
        }
        if (nearMeLoadedAt && nearMeNeedsLoad()) {
          rerender({ preserveSearch: true })
          return
        }
        if (compassActive || activeNearestStation()) {
          scheduleCompassUpdate()
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
    )
  }

  compassCleanup = () => {
    stopCompassListener()
    stopPositionWatch()
    stopNearMeAgo()
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
      `
        <div class="citibike-row citibike-nearest-content">
          <div class="citibike-row-main">
            <div class="citibike-nearest-meta">
              <button
                type="button"
                class="citibike-compass-btn${compassActive ? ' citibike-compass-live' : ''}"
                id="citibike-compass-btn"
                aria-label="${compassActive ? 'Live direction toward rack' : 'Tap to enable live direction'}"
              >
                <svg id="citibike-compass-arrow" class="citibike-compass-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.5 L19.5 21.5 L12 17.5 L4.5 21.5 Z" fill="currentColor"/>
                </svg>
              </button>
              <span class="citibike-nearest-distance">${formatDistance(dist)}</span>
              <button
                type="button"
                class="btn btn-secondary citibike-directions-btn"
                data-directions-lat="${station.lat}"
                data-directions-lon="${station.lon}"
                data-directions-mode="${mode}"
              >Directions</button>
            </div>
            ${compassActive ? '<p class="citibike-compass-hint">Lay phone flat, screen up — top edge toward the rack.</p>' : ''}
          </div>
          ${availabilityAside(station)}
        </div>
      `,
      true
    )
  }

  function renderSaved(entry) {
    const { station, label, stationId } = entry
    const title = label.trim() || station.name
    const subtitle = label.trim() ? station.name : ''

    return `
      <li class="item citibike-saved-item">
        <button class="citibike-saved-row" type="button" data-edit-station="${stationId}">
          <div class="citibike-row-main">
            <span class="item-title issue-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="item-subtitle">${escapeHtml(subtitle)}</span>` : ''}
          </div>
          ${availabilityAside(station)}
        </button>
      </li>
    `
  }

  function bind(state) {
    container.querySelector('#btn-citibike-home')?.addEventListener('click', () => navigate('home'))
    container.querySelectorAll('.citibike-load-near').forEach(btn => {
      btn.addEventListener('click', () => loadNearMe())
    })

    container.querySelectorAll('.citibike-near-refresh').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) loadNearMe()
      })
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
      loadNearMe()
    })

    container.querySelector('#citibike-compass-btn')?.addEventListener('click', () => {
      if (!compassActive) enableCompass(true)
    })

    container.querySelectorAll('[data-find-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = loadState()
        next.findMode = btn.dataset.findMode
        saveState(next)
        rerender()
      })
    })

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

  async function loadNearMe() {
    if (nearMeLoading) return
    nearMeLoading = true
    geoStatus = 'loading'
    geoError = ''
    rerender({ preserveSearch: true })
    try {
      stations = await fetchStations()
      lastFetchedAt = Date.now()
      loading = false
      error = ''

      userPos = await getUserLocation()
      geoStatus = 'ready'
      geoError = ''

      nearMeAnchor = { lat: userPos.lat, lon: userPos.lon }
      recomputeNearestByMode()
      nearMeLoadedAt = Date.now()

      await tryRestoreCompass()
      scheduleCompassUpdate()
    } catch (err) {
      userPos = null
      geoStatus = err?.code === 1 ? 'denied' : 'error'
      geoError = err?.code === 1
        ? 'Location access is off. Enable it in Settings to find the nearest rack.'
        : 'Could not get your location. Try again when you have a GPS signal.'
      console.warn(err)
    } finally {
      nearMeLoading = false
      rerender({ preserveSearch: true })
    }
  }

  loadStations().then(() => {
    startPositionWatch()
  })
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
