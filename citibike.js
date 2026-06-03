const KEY = 'ps_citibike_v1'
const GBFS_BASE = 'https://gbfs.citibikenyc.com/gbfs/en'
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

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

function compassLabel(deg) {
  return COMPASS[Math.round(deg / 45) % 8]
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
      nearest = { station, dist, bearing: bearingDeg(lat, lon, station.lat, station.lon) }
    }
  }
  return nearest
}

function availabilityLine(station) {
  if (station.isOffline) return 'Offline'
  return [
    pill('Classic', station.classic, station.classic > 0),
    pill('E-bike', station.ebikes, station.ebikes > 0),
    pill('Dock', station.docks, station.docks > 0),
  ].join('')
}

function pill(label, count, ok) {
  return `<span class="citibike-pill${ok ? ' citibike-pill-ok' : ' citibike-pill-empty'}">${label} ${count}</span>`
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

export function renderCitibike(container, { navigate }) {
  let stations = []
  let loading = true
  let error = ''
  let userPos = null
  let geoStatus = 'idle'
  let geoError = ''
  let editingStationId = null

  function stationById(id) {
    return stations.find(s => s.id === id)
  }

  function rerender() {
    const state = loadState()
    const saved = state.saved
      .map(entry => {
        const station = stationById(entry.stationId)
        return station ? { ...entry, station } : null
      })
      .filter(Boolean)

    const nearest = userPos
      ? findNearest(stations, userPos.lat, userPos.lon, state.findMode)
      : null

    container.innerHTML = `
      <div class="view" id="view-citibike">
        <header class="header">
          <div class="header-title">Citibike</div>
          <div class="header-right">
            <button class="btn btn-icon" id="btn-citibike-refresh" aria-label="Refresh" type="button">↻</button>
          </div>
        </header>

        <div class="scroll">
          <div class="citibike-near-block">
            <div class="section-header citibike-section-tight">
              <span class="section-label">Near me</span>
            </div>

            <div class="citibike-mode-switch" role="tablist" aria-label="Find nearest">
              <button type="button" class="citibike-mode-btn${state.findMode === 'bike' ? ' citibike-mode-active' : ''}" data-find-mode="bike" role="tab">Any bike</button>
              <button type="button" class="citibike-mode-btn${state.findMode === 'ebike' ? ' citibike-mode-active' : ''}" data-find-mode="ebike" role="tab">E-bike</button>
              <button type="button" class="citibike-mode-btn${state.findMode === 'parking' ? ' citibike-mode-active' : ''}" data-find-mode="parking" role="tab">Parking</button>
            </div>

            ${renderNearestCard(nearest, state.findMode, geoStatus, geoError)}
          </div>

          <div class="section-header">
            <span class="section-label">My racks</span>
            <span class="section-count">${saved.length}</span>
          </div>

          <div class="issues-add-wrap">
            <input
              class="input"
              id="citibike-search"
              type="search"
              placeholder="Search racks to add…"
              autocomplete="off"
            />
            <div class="citibike-search-results hidden" id="citibike-search-results"></div>
          </div>

          <ul class="item-list">
            ${loading && saved.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>Loading stations…</p></div></li>` : ''}
            ${!loading && error ? `<li style="list-style:none"><div class="empty-state"><p>${escapeHtml(error)}</p></div></li>` : ''}
            ${!loading && !error && saved.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>Add racks you check often — search above or pick from results.</p></div></li>` : ''}
            ${saved.map(entry => renderSaved(entry)).join('')}
          </ul>
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
          </div>
        </div>

        <button class="btn btn-icon menu-grid-btn menu-fab" id="btn-citibike-home" aria-label="Menu">
          <span class="menu-grid-icon" aria-hidden="true"></span>
        </button>
      </div>
    `

    bind(state)
  }

  function renderNearestCard(nearest, mode, geo, geoErr) {
    if (loading && stations.length === 0) {
      return `<div class="citibike-nearest-card"><p class="citibike-nearest-empty">Loading live racks…</p></div>`
    }
    if (geo === 'loading') {
      return `<div class="citibike-nearest-card"><p class="citibike-nearest-empty">Finding your location…</p></div>`
    }
    if (geo === 'denied' || geo === 'error') {
      return `<div class="citibike-nearest-card"><p class="citibike-nearest-empty">${escapeHtml(geoErr || 'Location unavailable.')}</p><button class="btn btn-secondary citibike-retry-geo" type="button">Try again</button></div>`
    }
    if (!nearest) {
      const modeLabel = mode === 'ebike' ? 'e-bikes' : mode === 'parking' ? 'open docks' : 'bikes'
      return `<div class="citibike-nearest-card"><p class="citibike-nearest-empty">No racks with ${modeLabel} nearby right now.</p></div>`
    }

    const { station, dist, bearing } = nearest
    const modeDetail = mode === 'ebike'
      ? `${station.ebikes} e-bike${station.ebikes === 1 ? '' : 's'}`
      : mode === 'parking'
        ? `${station.docks} open dock${station.docks === 1 ? '' : 's'}`
        : `${station.bikes} bike${station.bikes === 1 ? '' : 's'} (${station.classic} classic · ${station.ebikes} e-bike)`

    return `
      <div class="citibike-nearest-card">
        <div class="citibike-nearest-name">${escapeHtml(station.name)}</div>
        <div class="citibike-nearest-meta">
          <span class="citibike-compass" style="transform: rotate(${bearing}deg)" aria-hidden="true">↑</span>
          <span>${compassLabel(bearing)} · ${formatDistance(dist)}</span>
        </div>
        <div class="citibike-nearest-detail">${escapeHtml(modeDetail)}</div>
        <div class="citibike-nearest-pills">${availabilityLine(station)}</div>
      </div>
    `
  }

  function renderSaved(entry) {
    const { station, label, stationId } = entry
    const title = label.trim() || station.name
    const subtitle = label.trim() ? station.name : ''

    return `
      <li class="item citibike-saved-item">
        <button class="item-body citibike-item-body citibike-saved-body" type="button" data-edit-station="${stationId}">
          <div class="citibike-station-text">
            <span class="item-title issue-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="item-subtitle">${escapeHtml(subtitle)}</span>` : ''}
            <div class="citibike-nearest-pills">${availabilityLine(station)}</div>
          </div>
        </button>
        <button class="btn issue-delete-btn" type="button" data-station-delete="${stationId}" aria-label="Remove rack">×</button>
      </li>
    `
  }

  function bind(state) {
    container.querySelector('#btn-citibike-home')?.addEventListener('click', () => navigate('home'))
    container.querySelector('#btn-citibike-refresh')?.addEventListener('click', () => {
      refreshAll()
    })

    container.querySelector('.citibike-retry-geo')?.addEventListener('click', () => {
      locateUser()
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
    })

    container.querySelectorAll('[data-station-delete]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        removeSaved(btn.dataset.stationDelete)
      })
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

  async function loadStations() {
    loading = true
    error = ''
    rerender()
    try {
      stations = await fetchStations()
      loading = false
    } catch (err) {
      loading = false
      error = 'Could not load live rack data. Check your connection and try again.'
      console.error(err)
    }
    rerender()
  }

  async function locateUser() {
    geoStatus = 'loading'
    geoError = ''
    rerender()
    try {
      userPos = await getUserLocation()
      geoStatus = 'ready'
      geoError = ''
    } catch (err) {
      userPos = null
      geoStatus = err?.code === 1 ? 'denied' : 'error'
      geoError = err?.code === 1
        ? 'Location access is off. Enable it in Settings to find the nearest rack.'
        : 'Could not get your location. Try again when you have a GPS signal.'
      console.warn(err)
    }
    rerender()
  }

  async function refreshAll() {
    await Promise.all([loadStations(), locateUser()])
  }

  refreshAll()
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
