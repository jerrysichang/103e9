const KEY = 'ps_citibike_v1'
const GBFS_BASE = 'https://gbfs.citibikenyc.com/gbfs/en'

const DEFAULT_STATE = {
  stationIds: [],
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw)
    return {
      stationIds: Array.isArray(parsed?.stationIds) ? parsed.stationIds : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
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
    stations.push({
      id,
      name: meta.name,
      bikes: live.num_bikes_available ?? 0,
      docks: live.num_docks_available ?? 0,
      ebikes: live.num_ebikes_available ?? 0,
      isOffline: !live.is_renting || !live.is_returning,
    })
  }
  stations.sort((a, b) => a.name.localeCompare(b.name))
  return stations
}

export function renderCitibike(container, { navigate }) {
  let stations = []
  let loading = true
  let error = ''

  function rerender() {
    const state = loadState()
    const saved = state.stationIds
      .map(id => stations.find(s => s.id === id))
      .filter(Boolean)

    container.innerHTML = `
      <div class="view" id="view-citibike">
        <header class="header">
          <div class="header-title">Citibike</div>
        </header>

        <div class="scroll">
          <div class="issues-add-wrap">
            <input
              class="input"
              id="citibike-search"
              type="search"
              placeholder="Search stations to save…"
              autocomplete="off"
            />
            <div class="citibike-search-results hidden" id="citibike-search-results"></div>
          </div>

          <div class="section-header">
            <span class="section-label">Saved</span>
            <span class="section-count">${saved.length}</span>
          </div>
          <ul class="item-list">
            ${loading ? `<li style="list-style:none"><div class="empty-state"><p>Loading stations…</p></div></li>` : ''}
            ${!loading && error ? `<li style="list-style:none"><div class="empty-state"><p>${escapeHtml(error)}</p></div></li>` : ''}
            ${!loading && !error && saved.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>Search above to save stations you use often.</p></div></li>` : ''}
            ${saved.map(s => renderStation(s, true)).join('')}
          </ul>

          <div class="section-header" style="margin-top:12px">
            <span class="section-label">All stations</span>
            <span class="section-count">${stations.length}</span>
          </div>
          <ul class="item-list">
            ${!loading && !error && stations.length === 0 ? `<li style="list-style:none"><div class="empty-state"><p>No stations found.</p></div></li>` : ''}
            ${stations.slice(0, 40).map(s => renderStation(s, saved.some(x => x.id === s.id))).join('')}
            ${stations.length > 40 ? `<li style="list-style:none"><div class="empty-state"><p>Showing first 40 — search to find others.</p></div></li>` : ''}
          </ul>
        </div>

        <button class="btn btn-icon menu-grid-btn menu-fab" id="btn-citibike-home" aria-label="Menu">
          <span class="menu-grid-icon" aria-hidden="true"></span>
        </button>
      </div>
    `

    bind()
  }

  function renderStation(station, isSaved) {
    const status = station.isOffline
      ? 'Offline'
      : `${station.bikes} bikes · ${station.docks} docks${station.ebikes ? ` · ${station.ebikes} e-bikes` : ''}`

    return `
      <li class="item">
        <div class="item-body citibike-item-body">
          <div class="citibike-station-text">
            <span class="item-title issue-title">${escapeHtml(station.name)}</span>
            <span class="item-subtitle">${escapeHtml(status)}</span>
          </div>
        </div>
        <button
          class="btn ${isSaved ? 'issue-delete-btn' : 'btn-secondary citibike-save-btn'}"
          type="button"
          data-station-toggle="${station.id}"
          aria-label="${isSaved ? 'Remove from saved' : 'Save station'}"
        >${isSaved ? '×' : '+'}</button>
      </li>
    `
  }

  function bind() {
    container.querySelector('#btn-citibike-home')?.addEventListener('click', () => navigate('home'))

    const search = container.querySelector('#citibike-search')
    const results = container.querySelector('#citibike-search-results')

    search?.addEventListener('input', () => {
      const q = String(search.value || '').trim().toLowerCase()
      if (!q) {
        results.classList.add('hidden')
        results.innerHTML = ''
        return
      }
      const matches = stations
        .filter(s => s.name.toLowerCase().includes(q))
        .slice(0, 8)
      if (matches.length === 0) {
        results.classList.add('hidden')
        return
      }
      results.classList.remove('hidden')
      results.innerHTML = matches.map(s => `
        <button class="citibike-search-hit" type="button" data-station-pick="${s.id}">
          <span>${escapeHtml(s.name)}</span>
          <span class="citibike-search-meta">${s.bikes} bikes · ${s.docks} docks</span>
        </button>
      `).join('')
    })

    results?.addEventListener('click', e => {
      const btn = e.target.closest('[data-station-pick]')
      if (!btn) return
      const id = btn.dataset.stationPick
      const next = loadState()
      if (!next.stationIds.includes(id)) next.stationIds.push(id)
      saveState(next)
      search.value = ''
      results.classList.add('hidden')
      results.innerHTML = ''
      rerender()
    })

    container.querySelectorAll('[data-station-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.stationToggle
        const next = loadState()
        if (next.stationIds.includes(id)) {
          next.stationIds = next.stationIds.filter(x => x !== id)
        } else {
          next.stationIds.push(id)
        }
        saveState(next)
        rerender()
      })
    })
  }

  async function load() {
    loading = true
    error = ''
    rerender()
    try {
      stations = await fetchStations()
      loading = false
    } catch (err) {
      loading = false
      error = 'Could not load live station data. Check your connection and try again.'
      console.error(err)
    }
    rerender()
  }

  load()
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
