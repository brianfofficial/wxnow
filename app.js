(() => {
  'use strict';

  // WMO weather code → { icon, label }
  const WMO = {
    0: { icon: '☀️', label: 'Clear sky' },
    1: { icon: '🌤️', label: 'Mainly clear' },
    2: { icon: '⛅', label: 'Partly cloudy' },
    3: { icon: '☁️', label: 'Overcast' },
    45: { icon: '🌫️', label: 'Fog' },
    48: { icon: '🌫️', label: 'Depositing rime fog' },
    51: { icon: '🌦️', label: 'Light drizzle' },
    53: { icon: '🌦️', label: 'Moderate drizzle' },
    55: { icon: '🌧️', label: 'Dense drizzle' },
    56: { icon: '🌧️', label: 'Freezing drizzle' },
    57: { icon: '🌧️', label: 'Heavy freezing drizzle' },
    61: { icon: '🌧️', label: 'Slight rain' },
    63: { icon: '🌧️', label: 'Moderate rain' },
    65: { icon: '🌧️', label: 'Heavy rain' },
    66: { icon: '🌧️', label: 'Light freezing rain' },
    67: { icon: '🌧️', label: 'Heavy freezing rain' },
    71: { icon: '🌨️', label: 'Slight snow' },
    73: { icon: '🌨️', label: 'Moderate snow' },
    75: { icon: '❄️', label: 'Heavy snow' },
    77: { icon: '🌨️', label: 'Snow grains' },
    80: { icon: '🌦️', label: 'Slight showers' },
    81: { icon: '🌧️', label: 'Moderate showers' },
    82: { icon: '🌧️', label: 'Violent showers' },
    85: { icon: '🌨️', label: 'Slight snow showers' },
    86: { icon: '🌨️', label: 'Heavy snow showers' },
    95: { icon: '⛈️', label: 'Thunderstorm' },
    96: { icon: '⛈️', label: 'Thunderstorm w/ slight hail' },
    99: { icon: '⛈️', label: 'Thunderstorm w/ heavy hail' },
  };

  const wmo = (code) => WMO[code] || { icon: '🌡️', label: 'Unknown' };

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const el = {
    loading: $('loading'),
    error: $('error'),
    locationLabel: $('location-label'),
    weatherContent: $('weather-content'),
    currentTemp: $('current-temp'),
    currentCondition: $('current-condition'),
    currentFeels: $('current-feels'),
    statsInline: $('stats-inline'),
    tabNow: $('tab-now'),
    precipIndicator: $('precip-indicator'),
    alertBanner: $('alert-banner-nws'),
    tabHourly: $('tab-hourly'),
    tab7day: $('tab-7day'),
    btnRefresh: $('btn-refresh'),
    header: $('header'),
    alertSheetOverlay: $('alert-sheet-overlay'),
    alertSheetContent: $('alert-sheet-content'),
    installNudge: $('install-nudge'),
    btnInstallDismiss: $('btn-install-dismiss'),
    btnRadar: $('btn-radar'),
    btnUnit: $('btn-unit'),
    feelsTrend: $('feels-trend'),
    btnShare: $('btn-share'),
    searchInput: $('search-input'),
    searchResults: $('search-results'),
    weatherBgCurrent: $('weather-bg-current'),
    weatherBgNext: $('weather-bg-next'),
  };

  // Append last-updated span to header via JS
  const lastUpdatedEl = document.createElement('span');
  lastUpdatedEl.id = 'last-updated';
  el.header.appendChild(lastUpdatedEl);

  // Data age indicator
  const dataAgeEl = document.createElement('span');
  dataAgeEl.id = 'data-age';
  el.header.appendChild(dataAgeEl);

  // Helper: format ISO time string to locale time
  function formatTime(isoStr) {
    return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Helper: format hour only
  function formatHour(isoStr) {
    return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric' });
  }

  // Module-scoped lat/lon for retry
  let savedLat = null;
  let savedLon = null;
  let useFahrenheit = true;
  let lastWeather = null;
  let lastLocation = null;
  let activeAlerts = [];
  let refreshInterval = null;
  let lastFetchTime = null;
  let deferredInstallPrompt = null;
  let fetchId = 0;
  let isFirstRender = true;
  let isVeryFirstRender = true;
  let tabTransitioning = false;
  let currentSavedLocation = null;
  let confettiFired = false; // { name, lat, lon } or null for GPS

  try { if (localStorage.getItem('wxnow-unit') === 'c') useFahrenheit = false; } catch {}

  // --- Saved Locations ---

  function getSavedLocations() {
    try {
      const raw = localStorage.getItem('wxnow-saved-locations');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function setSavedLocations(locs) {
    try { localStorage.setItem('wxnow-saved-locations', JSON.stringify(locs.slice(0, 5))); } catch {}
  }

  function addSavedLocation(name, lat, lon) {
    const locs = getSavedLocations();
    const roundLat = Math.round(lat * 100) / 100;
    const roundLon = Math.round(lon * 100) / 100;
    const exists = locs.some(l =>
      Math.round(l.lat * 100) / 100 === roundLat &&
      Math.round(l.lon * 100) / 100 === roundLon
    );
    if (exists) return false;
    if (locs.length >= 5) {
      showToast('Max 5 locations. Remove one first.');
      return false;
    }
    locs.push({ name, lat, lon });
    setSavedLocations(locs);
    return true;
  }

  function removeSavedLocation(lat, lon) {
    const locs = getSavedLocations().filter(l =>
      !(Math.round(l.lat * 100) / 100 === Math.round(lat * 100) / 100 &&
        Math.round(l.lon * 100) / 100 === Math.round(lon * 100) / 100)
    );
    setSavedLocations(locs);
  }

  function initiateRemove(chip) {
    if (chip.classList.contains('confirm-remove')) return;
    chip.classList.add('confirm-remove');
    const tempEl = chip.querySelector('.loc-chip-temp');
    const origTemp = tempEl ? tempEl.textContent : '';
    if (tempEl) tempEl.textContent = '✕';
    const timer = setTimeout(() => {
      chip.classList.remove('confirm-remove');
      if (tempEl) tempEl.textContent = origTemp;
    }, 2000);
    chip.addEventListener('click', function removeHandler() {
      clearTimeout(timer);
      const lat = parseFloat(chip.dataset.lat);
      const lon = parseFloat(chip.dataset.lon);
      removeSavedLocation(lat, lon);
      if (currentSavedLocation &&
          Math.round(currentSavedLocation.lat * 100) / 100 === Math.round(lat * 100) / 100 &&
          Math.round(currentSavedLocation.lon * 100) / 100 === Math.round(lon * 100) / 100) {
        currentSavedLocation = null;
        restoreGps();
      }
      renderLocationChips();
      chip.removeEventListener('click', removeHandler);
    }, { once: true });
  }

  function handleChipClick(chip) {
    if (chip.classList.contains('confirm-remove')) return;
    if (chip.classList.contains('loc-chip-gps')) {
      currentSavedLocation = null;
      if (el.searchInput) el.searchInput.value = '';
      isFirstRender = true;
      getPosition().then(pos => {
        savedLat = pos.coords.latitude;
        savedLon = pos.coords.longitude;
        debouncedFetch(savedLat, savedLon);
        renderLocationChips();
      }).catch(() => {
        showToast('Location unavailable');
        if (lastWeather) renderLocationChips();
      });
      renderLocationChips();
      return;
    }
    const lat = parseFloat(chip.dataset.lat);
    const lon = parseFloat(chip.dataset.lon);
    const name = chip.querySelector('.loc-chip-name').textContent;
    currentSavedLocation = { name, lat, lon };
    savedLat = lat;
    savedLon = lon;
    lastLocation = name;
    if (el.searchInput) el.searchInput.value = '';
    isFirstRender = true;
    debouncedFetch(lat, lon, name);
    renderLocationChips();
  }

  function renderLocationChips() {
    const container = $('saved-locations');
    if (!container) return;
    clearEl(container);

    // GPS chip
    const gpsChip = document.createElement('button');
    gpsChip.className = 'loc-chip loc-chip-gps';
    if (!currentSavedLocation) gpsChip.classList.add('active');
    gpsChip.dataset.lat = '';
    gpsChip.dataset.lon = '';
    const gpsName = document.createElement('span');
    gpsName.className = 'loc-chip-name';
    gpsName.textContent = '📍 GPS';
    const gpsTemp = document.createElement('span');
    gpsTemp.className = 'loc-chip-temp';
    gpsTemp.textContent = (lastWeather && !currentSavedLocation) ? displayTemp(lastWeather.current.temperature_2m) : '';
    gpsChip.appendChild(gpsName);
    gpsChip.appendChild(gpsTemp);
    gpsChip.addEventListener('click', () => handleChipClick(gpsChip));
    container.appendChild(gpsChip);

    // Saved locations
    const saved = getSavedLocations();
    saved.forEach(loc => {
      const chip = document.createElement('button');
      chip.className = 'loc-chip';
      chip.dataset.lat = loc.lat;
      chip.dataset.lon = loc.lon;
      if (currentSavedLocation &&
          Math.round(loc.lat * 100) === Math.round(currentSavedLocation.lat * 100) &&
          Math.round(loc.lon * 100) === Math.round(currentSavedLocation.lon * 100)) {
        chip.classList.add('active');
      }
      const nameEl = document.createElement('span');
      nameEl.className = 'loc-chip-name';
      nameEl.textContent = loc.name;
      const tempEl = document.createElement('span');
      tempEl.className = 'loc-chip-temp';
      tempEl.textContent = '—';
      chip.appendChild(nameEl);
      chip.appendChild(tempEl);
      chip.addEventListener('click', () => handleChipClick(chip));

      // Long-press / right-click removal
      let pressTimer;
      chip.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => initiateRemove(chip), 500);
      }, { passive: true });
      chip.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
      chip.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });
      chip.addEventListener('contextmenu', (e) => { e.preventDefault(); initiateRemove(chip); });

      container.appendChild(chip);
    });

    // Chip-shaped search input at end
    const searchChip = document.createElement('div');
    searchChip.className = 'loc-chip loc-chip-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'search-input';
    searchInput.placeholder = '+ Add';
    searchInput.autocomplete = 'off';
    searchInput.autocorrect = 'off';
    searchInput.spellcheck = false;
    searchChip.appendChild(searchInput);
    container.appendChild(searchChip);

    // Re-bind search input ref
    el.searchInput = searchInput;
    bindSearchInput();
  }

  async function updateChipTemps() {
    const saved = getSavedLocations();
    if (saved.length === 0) return;
    const results = await Promise.all(saved.map(async (loc) => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`
        );
        const data = await res.json();
        return { lat: loc.lat, lon: loc.lon, temp: data.current.temperature_2m, code: data.current.weather_code };
      } catch { return null; }
    }));
    results.forEach(r => {
      if (!r) return;
      const chip = document.querySelector(`.loc-chip[data-lat="${r.lat}"][data-lon="${r.lon}"] .loc-chip-temp`);
      if (chip) chip.textContent = `${wmo(r.code).icon} ${displayTemp(r.temp)}`;
    });
  }

  // Theme init (blocking script in <head> handles the data attribute; this syncs button text)
  function isLightTheme() {
    return document.documentElement.dataset.theme === 'light';
  }

  function displayTemp(f) {
    return useFahrenheit ? Math.round(f) + '°' : Math.round((f - 32) * 5 / 9) + '°';
  }

  function displayWind(mph) {
    return useFahrenheit ? Math.round(mph) + ' mph' : Math.round(mph * 1.609) + ' km/h';
  }

  function degToCompass(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // Debounce utility
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Tab switching with animated transitions
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (tabTransitioning) return;
      const currentPanel = document.querySelector('.tab-panel.active');
      const nextPanel = $(btn.dataset.tab);
      if (currentPanel === nextPanel) return;

      tabTransitioning = true;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (currentPanel) {
        currentPanel.classList.add('tab-exit');
        setTimeout(() => {
          currentPanel.classList.remove('active', 'tab-exit');
          nextPanel.classList.add('active', 'tab-enter');
          // Animate 7-day bars if switching to that tab
          if (btn.dataset.tab === 'tab-7day') animate7DayBars();
          setTimeout(() => {
            nextPanel.classList.remove('tab-enter');
            tabTransitioning = false;
          }, 250);
        }, 150);
      } else {
        nextPanel.classList.add('active');
        tabTransitioning = false;
      }
    });
  });

  // Geolocation
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 10000, maximumAge: 300000,
      });
    });
  }

  // Reverse geocode — prefer state_code, county fallback for city
  async function reverseGeocode(lat, lon) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      const a = data.address || {};
      const city = a.city || a.town || a.village || a.suburb || a.neighbourhood || a.county || '';
      const state = a['ISO3166-2-lvl4']
        ? a['ISO3166-2-lvl4'].split('-').pop()
        : (a.state_code || a.state || '');
      return city && state ? `${city}, ${state}` : city || state || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    } catch {
      return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }
  }

  // Fetch weather — expanded params
  async function fetchWeather(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,dew_point_2m,wind_direction_10m',
      minutely_15: 'precipitation,temperature_2m,weather_code',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto',
      forecast_days: 7,
      forecast_minutely_15: 12,
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    return res.json();
  }

  // Clear children helper
  function clearEl(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }

  // --- Render functions (all use createElement + textContent) ---

  function renderCurrent(current, location) {
    const w = wmo(current.weather_code);
    el.locationLabel.textContent = location;
    el.currentTemp.textContent = displayTemp(current.temperature_2m);
    el.currentCondition.textContent = `${w.icon} ${w.label}`;
    el.currentFeels.textContent = `Feels like ${displayTemp(current.apparent_temperature)}`;
  }

  function renderStatsInline(current) {
    if (!el.statsInline) return;
    const parts = [
      `<span class="font-data">${Math.round(current.relative_humidity_2m)}%</span> humidity`,
      `<span class="font-data">${displayWind(current.wind_speed_10m)}</span> ${degToCompass(current.wind_direction_10m)}`,
      `<span class="font-data">${displayTemp(current.dew_point_2m)}</span> dew`,
      `<span class="font-data">${current.precipitation > 0 ? current.precipitation.toFixed(2) + '"' : '—'}</span> precip`
    ];
    el.statsInline.innerHTML = parts.join(' <span class="stats-dot">·</span> ');
  }


  function rainSummary(minutelySlots) {
    if (!minutelySlots || minutelySlots.length === 0) {
      return { text: 'Forecast data unavailable.', active: false };
    }
    const allZero = minutelySlots.every((s) => s.precip === 0);
    if (allZero) {
      return { text: 'No precipitation expected in the next 2 hours.', active: false };
    }
    if (minutelySlots[0].precip > 0) {
      return { text: 'Rain is falling now.', active: true };
    }
    const firstIdx = minutelySlots.findIndex((s) => s.precip > 0);
    const minutesAway = firstIdx * 15;
    const slotTime = formatTime(minutelySlots[firstIdx].time);
    if (minutesAway <= 30) {
      const rounded = Math.round(minutesAway / 15) * 15 || 15;
      return { text: `Rain expected in about ${rounded} minutes.`, active: false };
    }
    if (minutesAway <= 60) {
      return { text: `Rain expected around ${slotTime}.`, active: false };
    }
    if (minutesAway <= 90) {
      return { text: `Possible rain around ${slotTime}.`, active: false };
    }
    return { text: `Brief chance of rain after ${slotTime}.`, active: false };
  }

  // renderRainSummary now creates an element inside the Now tab (called from renderNowTab)

  function renderPrecipIndicator(minutelySlots) {
    if (minutelySlots && minutelySlots.some((s) => s.precip > 0)) {
      el.precipIndicator.classList.add('active');
    } else {
      el.precipIndicator.classList.remove('active');
    }
  }

  function renderNowTab(minutelySlots, dailySlots, hourlySlots, alerts) {
    clearEl(el.tabNow);

    const hasPrecip = minutelySlots && minutelySlots.some(s => s.precip > 0);

    if (!minutelySlots || minutelySlots.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'tab-unavailable font-label';
      msg.textContent = '15-min data unavailable for this location';
      el.tabNow.appendChild(msg);
    } else if (!hasPrecip) {
      // All clear — single consolidated message
      const empty = document.createElement('div');
      empty.className = 'now-empty font-label';
      empty.innerHTML = '<div class="now-empty-icon">👍</div>All clear for the next 2 hours.';
      el.tabNow.appendChild(empty);
    } else {
      // Rain summary at top
      const summary = rainSummary(minutelySlots);
      const summaryEl = document.createElement('p');
      summaryEl.id = 'rain-summary';
      summaryEl.className = 'font-label';
      summaryEl.textContent = summary.text;
      if (summary.active) summaryEl.classList.add('rain-active');
      else summaryEl.classList.add('rain-expected');
      el.tabNow.appendChild(summaryEl);

      // Section label
      const label = document.createElement('div');
      label.className = 'section-label font-label';
      label.textContent = 'Next 2 Hours';
      el.tabNow.appendChild(label);

      {
        const capped = minutelySlots.slice(0, 8);
        const maxPrecip = Math.max(...capped.map(s => s.precip), 0.01);
        capped.forEach((slot, idx) => {
          const row = document.createElement('div');
          row.className = 'now-row';
          const time = document.createElement('span');
          time.className = 'now-time font-label';
          time.textContent = idx === 0 ? 'NOW' : formatTime(slot.time);
          const barWrap = document.createElement('div');
          barWrap.className = 'now-bar-wrap';
          const bar = document.createElement('div');
          bar.className = 'now-bar';
          const finalWidth = `${Math.max((slot.precip / maxPrecip) * 100, 0)}%`;
          if (isFirstRender) {
            bar.style.width = '0%';
            bar.style.transitionDelay = `${idx * 60}ms`;
            requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = finalWidth; }));
          } else {
            bar.style.width = finalWidth;
          }
          barWrap.appendChild(bar);
          const temp = document.createElement('span');
          temp.className = 'now-temp font-data';
          temp.textContent = displayTemp(slot.temp);
          const precip = document.createElement('span');
          precip.className = 'now-precip font-data';
          precip.textContent = slot.precip === 0 ? '—' : `${slot.precip}"`;
          row.appendChild(time);
          row.appendChild(barWrap);
          row.appendChild(temp);
          row.appendChild(precip);
          el.tabNow.appendChild(row);
        });
      }
    }

    // Briefing card at bottom of Now tab
    const briefing = generateBriefing(dailySlots, hourlySlots, alerts, minutelySlots);
    const card = document.createElement('div');
    card.id = 'briefing-card';
    const headline = document.createElement('div');
    headline.id = 'briefing-headline';
    headline.className = 'font-label';
    headline.textContent = briefing.headline;
    const lines = document.createElement('div');
    lines.id = 'briefing-lines';
    lines.className = 'font-label';
    briefing.lines.forEach(line => {
      const div = document.createElement('div');
      div.textContent = line;
      lines.appendChild(div);
    });
    card.appendChild(headline);
    card.appendChild(lines);
    el.tabNow.appendChild(card);
  }

  function probClass(prob) {
    if (prob > 50) return 'prob-high';
    if (prob > 20) return 'prob-med';
    return 'prob-low';
  }

  function renderHourlyTab(hourlySlots) {
    clearEl(el.tabHourly);
    if (!hourlySlots || hourlySlots.length === 0) return;
    hourlySlots.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'hourly-row';

      const time = document.createElement('span');
      time.className = 'hr-time';
      time.textContent = formatHour(slot.time);

      const icon = document.createElement('span');
      icon.className = 'hr-icon';
      icon.textContent = wmo(slot.code).icon;

      const probWrap = document.createElement('div');
      probWrap.className = 'hr-prob-wrap';
      const probBar = document.createElement('div');
      probBar.className = `hr-prob-bar ${probClass(slot.prob)}`;
      probBar.style.width = `${slot.prob}%`;
      probWrap.appendChild(probBar);

      const temp = document.createElement('span');
      temp.className = 'hr-temp';
      temp.textContent = displayTemp(slot.temp);

      const precip = document.createElement('span');
      precip.className = 'hr-precip';
      precip.textContent = `${slot.prob}%`;

      row.appendChild(time);
      row.appendChild(icon);
      row.appendChild(probWrap);
      row.appendChild(temp);
      const precipAmt = document.createElement('span');
      precipAmt.className = 'hr-precip-amt';
      const p = slot.precip != null ? slot.precip : 0;
      precipAmt.textContent = p > 0 ? `${p.toFixed(2)}"` : '—';
      precipAmt.style.color = p > 0 ? '#38bdf8' : '#1e293b';

      row.appendChild(precip);
      row.appendChild(precipAmt);
      el.tabHourly.appendChild(row);
    });
  }

  // --- Data processing ---

  function processMinutely(m15) {
    if (!m15 || !m15.time || !m15.precipitation) return null;
    const now = new Date();
    const startIdx = m15.time.findIndex((t) => new Date(t) >= now);
    if (startIdx === -1) return null;
    const slots = [];
    for (let i = startIdx; i < Math.min(startIdx + 8, m15.time.length); i++) {
      slots.push({
        time: m15.time[i],
        precip: m15.precipitation[i],
        temp: m15.temperature_2m ? m15.temperature_2m[i] : null,
        code: m15.weather_code ? m15.weather_code[i] : null,
      });
    }
    return slots.length > 0 ? slots : null;
  }

  function processHourly(hourly) {
    if (!hourly || !hourly.time) return null;
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const startIdx = hourly.time.findIndex((t) => new Date(t) >= currentHour);
    if (startIdx === -1) return null;
    const slots = [];
    for (let i = startIdx; i < Math.min(startIdx + 12, hourly.time.length); i++) {
      slots.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m[i],
        prob: hourly.precipitation_probability[i],
        precip: hourly.precipitation ? hourly.precipitation[i] : 0,
        code: hourly.weather_code[i],
        wind: hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null,
      });
    }
    return slots.length > 0 ? slots : null;
  }

  function processDaily(daily) {
    if (!daily || !daily.time) return null;
    return daily.time.map((t, i) => ({
      date: t,
      maxTemp: daily.temperature_2m_max[i],
      minTemp: daily.temperature_2m_min[i],
      precipSum: daily.precipitation_sum[i],
      precipProb: daily.precipitation_probability_max[i],
      code: daily.weather_code[i],
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
      uvMax: daily.uv_index_max[i],
      windMax: daily.wind_speed_10m_max[i],
      gustMax: daily.wind_gusts_10m_max[i],
    }));
  }

  function uvLabel(uv) {
    if (uv <= 2) return 'Low';
    if (uv <= 5) return 'Mod';
    if (uv <= 7) return 'High';
    if (uv <= 10) return 'V.High';
    return 'Extreme';
  }

  function uvColor(uv) {
    if (uv <= 2) return '#22c55e';
    if (uv <= 5) return '#eab308';
    if (uv <= 7) return '#f97316';
    if (uv <= 10) return '#ef4444';
    return '#a855f7';
  }

  function renderDaily(days, hourlySlots) {
    clearEl(el.tab7day);
    if (!days || days.length === 0) return;

    // Best window banner
    const bw = bestWindow(hourlySlots);
    const banner = document.createElement('div');
    banner.id = 'best-window-banner';
    if (bw) {
      banner.textContent = `Best time outside today · ${bw.startTime}–${bw.endTime}`;
      banner.className = 'best-window-good';
      banner.style.position = 'relative';
    } else {
      banner.textContent = 'Outdoor conditions poor today';
      banner.className = 'best-window-poor';
    }
    el.tab7day.appendChild(banner);

    // Confetti burst for good window
    if (bw && !confettiFired) {
      confettiFired = true;
      const colors = ['#4ade80', '#38bdf8', '#fbbf24', '#a78bfa', '#f472b6'];
      setTimeout(() => {
        for (let i = 0; i < 5; i++) {
          const dot = document.createElement('div');
          dot.className = 'confetti-dot';
          dot.style.background = colors[i % colors.length];
          dot.style.left = `${40 + Math.random() * 20}%`;
          dot.style.top = '50%';
          dot.style.setProperty('--tx', `${-30 + Math.random() * 60}px`);
          dot.style.setProperty('--ty', `${-20 - Math.random() * 30}px`);
          banner.appendChild(dot);
          setTimeout(() => dot.remove(), 850);
        }
      }, 200);
    }

    days.forEach((day, idx) => {
      const row = document.createElement('div');
      row.className = 'daily-row' + (idx === 0 ? ' today' : '');

      // Day label
      const dayLabel = document.createElement('span');
      dayLabel.className = 'daily-day';
      if (idx === 0) dayLabel.textContent = 'TODAY';
      else if (idx === 1) dayLabel.textContent = 'TMR';
      else dayLabel.textContent = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

      // WMO icon
      const icon = document.createElement('span');
      icon.className = 'daily-icon';
      icon.textContent = wmo(day.code).icon;

      // Temps
      const temps = document.createElement('span');
      temps.className = 'daily-temps';
      const hi = document.createElement('span');
      hi.className = 'hi';
      hi.textContent = displayTemp(day.maxTemp);
      const sep = document.createTextNode(' / ');
      const lo = document.createElement('span');
      lo.className = 'lo';
      lo.textContent = displayTemp(day.minTemp);
      temps.appendChild(hi);
      temps.appendChild(sep);
      temps.appendChild(lo);

      // Precip probability bar
      const probWrap = document.createElement('div');
      probWrap.className = 'daily-prob-wrap';
      const probBar = document.createElement('div');
      probBar.className = 'daily-prob-bar';
      const prob = day.precipProb;
      probBar.style.background = prob > 50 ? '#0284c7' : prob > 20 ? '#38bdf8' : '#1e293b';
      probBar.dataset.finalWidth = `${prob}%`;
      probBar.style.width = `${prob}%`;
      probWrap.appendChild(probBar);

      // UV index
      const uv = document.createElement('span');
      uv.className = 'daily-uv';
      const uvVal = Math.round(day.uvMax);
      uv.textContent = `UV ${uvVal} · ${uvLabel(day.uvMax)}`;
      uv.style.color = uvColor(day.uvMax);

      row.appendChild(dayLabel);
      row.appendChild(icon);
      row.appendChild(temps);
      row.appendChild(probWrap);
      row.appendChild(uv);

      // Sub-row
      const sub = document.createElement('div');
      sub.className = 'daily-sub';

      // Sunrise/sunset
      let sunText = '—';
      try {
        const rise = new Date(day.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const set = new Date(day.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        sunText = `↑ ${rise}  ↓ ${set}`;
      } catch { /* fallback */ }
      const sunSpan = document.createElement('span');
      sunSpan.textContent = sunText;
      sub.appendChild(sunSpan);

      // Precip sum
      if (day.precipSum > 0) {
        const precipSpan = document.createElement('span');
        precipSpan.className = 'daily-precip-sum';
        precipSpan.textContent = `${day.precipSum.toFixed(2)}"`;
        sub.appendChild(precipSpan);
      }

      row.appendChild(sub);
      el.tab7day.appendChild(row);
    });
  }

  // --- Smart Features ---

  function generateBriefing(daily, hourly, alerts, minutelySlots) {
    const result = { headline: '', lines: [] };
    const today = daily && daily.length > 0 ? daily[0] : null;

    // Headline
    const severeAlert = (alerts || []).find(a => a.severity === 'Extreme' || a.severity === 'Severe');
    if (severeAlert) {
      result.headline = `⚠ ${severeAlert.event} in effect`;
    } else if (today && today.precipSum > 0.5) {
      result.headline = 'Heavy rain expected today';
    } else if (today && today.precipSum > 0) {
      result.headline = 'Light rain possible today';
    } else if (today && today.uvMax >= 8) {
      result.headline = `Strong UV today — ${uvLabel(today.uvMax)}`;
    } else {
      result.headline = 'Clear conditions today';
    }

    // Line 0: High/Low + condition
    if (today) {
      const w = wmo(today.code);
      result.lines.push(`High ${displayTemp(today.maxTemp)} / Low ${displayTemp(today.minTemp)} · ${w.icon} ${w.label}`);
    }

    // Line 1: Rain status — active rain takes priority
    if (minutelySlots && minutelySlots.length > 0 && minutelySlots[0].precip > 0) {
      result.lines.push('Rain is falling now');
    } else if (hourly && hourly.length > 0) {
      const next8 = hourly.slice(0, 8);
      const highProb = next8.filter(s => s.prob > 50);
      if (highProb.length > 0) {
        // Find contiguous window
        let startIdx = next8.findIndex(s => s.prob > 50);
        let endIdx = startIdx;
        for (let i = startIdx + 1; i < next8.length; i++) {
          if (next8[i].prob > 50) endIdx = i;
          else break;
        }
        result.lines.push(`Rain likely ${formatHour(next8[startIdx].time)}–${formatHour(next8[endIdx].time)}`);
      } else if (next8.every(s => s.prob < 20)) {
        result.lines.push('Dry all day');
      } else {
        result.lines.push('Slight chance of showers');
      }
    }

    // Line 2: Sunrise/sunset + UV
    if (today) {
      try {
        const rise = new Date(today.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const set = new Date(today.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const uvVal = Math.round(today.uvMax);
        result.lines.push(`Sunrise ${rise} · Sunset ${set} · UV max ${uvVal} (${uvLabel(today.uvMax)})`);
      } catch { /* skip line if date parse fails */ }
    }

    return result;
  }


  function bestWindow(hourlySlots) {
    if (!hourlySlots || hourlySlots.length < 2) return null;
    // Filter to daylight hours (6am–8pm) today only
    const today = new Date();
    const todayDate = today.toDateString();
    const daylight = [];
    hourlySlots.forEach((slot) => {
      const d = new Date(slot.time);
      const hr = d.getHours();
      if (d.toDateString() === todayDate && hr >= 6 && hr < 20) {
        daylight.push({ ...slot });
      }
    });
    if (daylight.length < 2) return null;

    // Score each hour
    const scores = daylight.map(slot => {
      let score = 100;
      score -= (slot.prob / 100) * 40;
      if (slot.temp > 95) score -= 20;
      if (slot.temp < 50) score -= 20;
      if (slot.wind != null && slot.wind > 20) score -= 10;
      return score;
    });

    // Find best 2-consecutive-hour window
    let bestScore = -1;
    let bestIdx = -1;
    for (let i = 0; i < scores.length - 1; i++) {
      const avg = (scores[i] + scores[i + 1]) / 2;
      if (avg > bestScore) {
        bestScore = avg;
        bestIdx = i;
      }
    }

    if (bestScore < 30) return null;
    return {
      startTime: formatHour(daylight[bestIdx].time),
      endTime: formatHour(daylight[bestIdx + 1].time),
      score: bestScore,
    };
  }

  function feelsTrend(current, hourlySlots) {
    if (!hourlySlots || hourlySlots.length < 4) {
      return { arrow: '→', label: 'steady', color: '#475569' };
    }
    const currentFeels = current.apparent_temperature;
    // hourlySlots[3] is ~3 hours from now; use temp as proxy (apparent not in hourly)
    const futureTemp = hourlySlots[3].temp;
    const diff = futureTemp - currentFeels;
    if (diff > 3) return { arrow: '↑', label: 'warming', color: '#f97316' };
    if (diff < -3) return { arrow: '↓', label: 'cooling', color: '#38bdf8' };
    return { arrow: '→', label: 'steady', color: '#475569' };
  }

  function renderFeelsTrend(current, hourlySlots) {
    const trend = feelsTrend(current, hourlySlots);
    el.feelsTrend.textContent = `${trend.arrow} ${trend.label}`;
  }

  function generateShareText(weather, location, alerts) {
    const current = weather.current;
    const w = wmo(current.weather_code);
    const minutelySlots = processMinutely(weather.minutely_15);
    const daily = processDaily(weather.daily);
    const rain = rainSummary(minutelySlots);

    const lines = [];
    lines.push(`📍 ${location}`);
    lines.push(`🌡 ${displayTemp(current.temperature_2m)} (Feels ${displayTemp(current.apparent_temperature)}) · ${w.label}`);
    lines.push(`💧 ${rain.text}`);
    if (alerts && alerts.length > 0) {
      lines.push(`⚠ ${alerts[0].event} in effect`);
    }
    if (daily && daily.length > 0) {
      const today = daily[0];
      lines.push(`📊 High ${displayTemp(today.maxTemp)} / Low ${displayTemp(today.minTemp)} · UV ${Math.round(today.uvMax)} ${uvLabel(today.uvMax)}`);
    }
    lines.push('🕐 via WXNOW · wxnow.vercel.app');
    return lines.join('\n');
  }

  // --- Weather Background ---

  let bgTransitionTimer = null;

  function applyWeatherBackground(weatherCode, dailySlots) {
    let isDaytime = true;
    if (dailySlots && dailySlots.length > 0) {
      const now = Date.now();
      const rise = new Date(dailySlots[0].sunrise).getTime();
      const set = new Date(dailySlots[0].sunset).getTime();
      isDaytime = now > rise && now < set;
    }

    const light = isLightTheme();
    const code = weatherCode;
    const apparentTemp = lastWeather ? lastWeather.current.apparent_temperature : null;
    let c1, c2, c3, c4;

    // Night palettes — always dark regardless of theme
    const NIGHT_CLEAR = ['#070b1e','#0f1640','#1a2060','#252d75'];
    const NIGHT_CLOUDY = ['#0a1025','#141d3a','#1e2a4e','#2a3660'];

    if (!isDaytime) {
      if (code >= 95 && code <= 99) { [c1,c2,c3,c4] = ['#08060e','#100c20','#1a1230','#221840']; }
      else if ((code >= 51 && code <= 82)) { [c1,c2,c3,c4] = ['#080e1a','#0e1a2c','#14263c','#1c324c']; }
      else if (code === 2) { [c1,c2,c3,c4] = NIGHT_CLOUDY; }
      else if (code === 3) { [c1,c2,c3,c4] = ['#0c1018','#141a24','#1e242e','#282f38']; }
      else if (code === 45 || code === 48) { [c1,c2,c3,c4] = ['#0a0f16','#121820','#1a222c','#242c36']; }
      else if (code >= 71 && code <= 77) { [c1,c2,c3,c4] = ['#0c1420','#14202e','#1e2c3c','#28364a']; }
      else { [c1,c2,c3,c4] = NIGHT_CLEAR; }
    } else if (isDaytime && apparentTemp != null && apparentTemp > 90) {
      if (light) { [c1,c2,c3,c4] = ['#d4520a','#e87a2e','#f0a050','#f5cc8a']; }
      else { [c1,c2,c3,c4] = ['#180800','#2a1206','#3c1c0c','#4e2812']; }
    } else if (code === 0 || code === 1) {
      if (light) { [c1,c2,c3,c4] = ['#1a8cff','#4da6ff','#87c4f5','#bfdcf5']; }
      else { [c1,c2,c3,c4] = ['#06101f','#0c1e38','#122c4e','#183a5c']; }
    } else if (code === 2) {
      if (light) { [c1,c2,c3,c4] = ['#5494cc','#7aadda','#a3c5e5','#ccdceb']; }
      else { [c1,c2,c3,c4] = ['#0a1420','#0f1e30','#162940','#1e344e']; }
    } else if (code === 3) {
      if (light) { [c1,c2,c3,c4] = ['#6a7a8a','#8494a2','#a0adb8','#bcc5cc']; }
      else { [c1,c2,c3,c4] = ['#0c1018','#141a24','#1e242e','#282f38']; }
    } else if (code === 45 || code === 48) {
      if (light) { [c1,c2,c3,c4] = ['#8a95a0','#a0a9b2','#b8bfc6','#d0d5da']; }
      else { [c1,c2,c3,c4] = ['#0a0f16','#121820','#1a222c','#242c36']; }
    } else if (code >= 71 && code <= 77) {
      if (light) { [c1,c2,c3,c4] = ['#a8b8c6','#bcc9d4','#d2dbe3','#e8ecf0']; }
      else { [c1,c2,c3,c4] = ['#0c1420','#14202e','#1e2c3c','#28364a']; }
    } else if (code >= 95 && code <= 99) {
      if (light) { [c1,c2,c3,c4] = ['#1e2430','#2a3242','#3a4454','#4e5868']; }
      else { [c1,c2,c3,c4] = ['#08060e','#100c20','#1a1230','#221840']; }
    } else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
      if (light) { [c1,c2,c3,c4] = ['#2e3e4e','#40525f','#586a76','#728490']; }
      else { [c1,c2,c3,c4] = ['#080e1a','#0e1a2c','#14263c','#1c324c']; }
    } else if (code >= 51 && code <= 57) {
      if (light) { [c1,c2,c3,c4] = ['#4a5c6e','#627586','#7e909e','#9caab5']; }
      else { [c1,c2,c3,c4] = ['#080e1a','#0e1a2c','#14263c','#1c324c']; }
    } else {
      if (light) { [c1,c2,c3,c4] = ['#4a5c6e','#627586','#7e909e','#9caab5']; }
      else { [c1,c2,c3,c4] = ['#080e1a','#0e1a2c','#14263c','#1c324c']; }
    }

    const newGrad = `linear-gradient(180deg, ${c1} 0%, ${c2} 35%, ${c3} 70%, ${c4} 100%)`;
    document.documentElement.style.setProperty('--weather-top', c1);
    document.documentElement.style.setProperty('--weather-bottom', c4);

    if (bgTransitionTimer) clearTimeout(bgTransitionTimer);
    el.weatherBgNext.style.background = newGrad;
    el.weatherBgNext.style.opacity = '1';

    bgTransitionTimer = setTimeout(() => {
      el.weatherBgCurrent.style.background = newGrad;
      el.weatherBgNext.style.opacity = '0';
      bgTransitionTimer = null;
    }, 850);

    // Adaptive hero card opacity based on gradient brightness
    const heroCard = $('hero-card');
    const tempEl = $('current-temp');
    if (heroCard) {
      const avg = (hexBrightness(c1) + hexBrightness(c2)) / 2;
      if (avg > 140) {
        heroCard.style.background = 'rgba(255,255,255,0.45)';
        heroCard.style.borderColor = 'rgba(255,255,255,0.55)';
        if (tempEl) tempEl.style.textShadow = '0 2px 16px rgba(0,0,0,0.2)';
      } else if (avg > 80) {
        heroCard.style.background = 'rgba(255,255,255,0.25)';
        heroCard.style.borderColor = 'rgba(255,255,255,0.3)';
        if (tempEl) tempEl.style.textShadow = '0 2px 12px rgba(0,0,0,0.15)';
      } else {
        heroCard.style.background = 'rgba(0,0,0,0.2)';
        heroCard.style.borderColor = 'rgba(255,255,255,0.08)';
        if (tempEl) tempEl.style.textShadow = '0 2px 12px rgba(0,0,0,0.3)';
      }
    }

    // Ambient glow color
    const glowEl = $('ambient-glow');
    if (glowEl) {
      let ambientColor = 'rgba(255,255,255,0.03)';
      if ((code === 0 || code === 1) && isDaytime) ambientColor = 'rgba(255,255,255,0.06)';
      else if (!isDaytime) ambientColor = 'rgba(100,120,200,0.04)';
      else if (code >= 95 && code <= 99) ambientColor = 'rgba(139,92,246,0.05)';
      else if (apparentTemp != null && apparentTemp > 90) ambientColor = 'rgba(251,191,36,0.05)';
      glowEl.style.setProperty('--ambient-color', ambientColor);
    }
  }

  function hexBrightness(hex) {
    try {
      const r = parseInt(hex.slice(1,3), 16);
      const g = parseInt(hex.slice(3,5), 16);
      const b = parseInt(hex.slice(5,7), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    } catch { return 128; }
  }

  // --- Loading Skeleton ---

  function renderSkeleton() {
    el.loading.classList.add('hidden');
    el.weatherContent.classList.remove('hidden');
    const heroCard = $('hero-card');
    const tabs = el.weatherContent.querySelector('#tabs');

    if (heroCard) {
      const current = heroCard.querySelector('#current');
      if (current) {
        current.innerHTML = '<div class="skeleton-hero">'
          + '<div class="skeleton-rect" style="width:40%;height:60px;margin:0 auto"></div>'
          + '<div class="skeleton-rect" style="width:50%;height:14px;margin:4px auto 0"></div>'
          + '<div class="skeleton-rect" style="width:70%;height:12px;margin:4px auto 0"></div>'
          + '</div>';
      }
    }

    if (el.statsInline) {
      el.statsInline.innerHTML = '<div class="skeleton-rect" style="width:90%;height:14px;display:inline-block"></div>';
    }

    if (tabs) tabs.style.visibility = 'hidden';
  }

  // --- Offline Cache ---

  function saveCache() {
    try {
      const data = {
        weather: lastWeather,
        location: lastLocation,
        lat: savedLat,
        lon: savedLon,
        alerts: activeAlerts,
        timestamp: Date.now(),
      };
      localStorage.setItem('wxnow-cache', JSON.stringify(data));
    } catch { /* quota exceeded or private browsing */ }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem('wxnow-cache');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.weather || !data.timestamp) return null;
      // Reject if > 6 hours old as primary source, but still return for stale display
      return data;
    } catch { return null; }
  }

  function updateDataAge(timestamp) {
    if (!timestamp) { dataAgeEl.textContent = ''; return; }
    const age = Date.now() - timestamp;
    const mins = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);

    if (mins < 5) {
      dataAgeEl.textContent = '';
      dataAgeEl.style.color = '';
    } else if (mins < 60) {
      dataAgeEl.textContent = ` · ${mins}m ago`;
      dataAgeEl.style.color = '#475569';
    } else if (hours < 6) {
      dataAgeEl.textContent = ` · ${hours}h ago`;
      dataAgeEl.style.color = '#f59e0b';
    } else {
      dataAgeEl.textContent = ' · Stale data';
      dataAgeEl.style.color = '#ef4444';
    }
  }

  let cacheTimestamp = null;

  // --- Weather Briefing (personality) ---

  function getWeatherBriefing(weather, dailySlots, hourlySlots) {
    if (!weather || !weather.current) return 'Loading...';
    const c = weather.current;
    const code = c.weather_code;
    const temp = c.apparent_temperature;

    const extreme = (activeAlerts || []).find(a => a.severity === 'Extreme');
    if (extreme) return 'Hey, stay safe out there. ⚠️';
    const severe = (activeAlerts || []).find(a => a.severity === 'Severe');
    if (severe) return 'Heads up — there\'s a weather alert nearby.';

    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
      const precip = c.precipitation != null ? c.precipitation : 0;
      return `Yep, it's raining. ☔ ${precip}" so far.`;
    }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow day! ❄️ Bundle up.';
    if (code >= 95 && code <= 99) return 'Thunder and lightning — maybe stay in? ⛈';

    if (hourlySlots && hourlySlots.length > 0) {
      const nextProb = hourlySlots[0].prob;
      if (nextProb > 80) return 'Rain\'s coming soon. Grab an umbrella. 🌂';
      if (nextProb > 50) return 'Might rain soon — just a heads up.';
    }

    if (temp > 100) return 'It\'s dangerously hot. Please hydrate. 🥵';
    if (temp > 90) return 'It\'s a hot one. Stay cool. 😎';
    if (temp < 20) return 'Brutally cold. Layer up. 🥶';
    if (temp < 32) return 'Below freezing — watch for ice.';

    if (c.wind_speed_10m > 30) return 'Super windy out there. Hold your hat! 💨';

    // Daytime check (used for UV and clear conditions)
    let isDaytime = true;
    if (dailySlots && dailySlots.length > 0) {
      const now = Date.now();
      isDaytime = now > new Date(dailySlots[0].sunrise).getTime() && now < new Date(dailySlots[0].sunset).getTime();
    }

    // UV only relevant during daytime
    const uv = dailySlots && dailySlots[0] ? dailySlots[0].uvMax : 0;
    if (isDaytime && uv > 8) return 'UV is extreme today. Sunscreen is a must. 🧴';
    if (isDaytime && uv > 5) return 'UV is high — don\'t skip sunscreen.';

    if (code <= 1) {
      if (isDaytime && temp >= 65 && temp <= 80) return 'Perfect weather. Go enjoy it! ☀️';
      if (isDaytime) return 'Clear skies. Nice.';
      return 'Clear night. Sleep well. 🌙';
    }
    if (code === 2) return isDaytime ? 'A few clouds, nothing dramatic.' : 'Partly cloudy tonight.';
    if (code === 3) return isDaytime ? 'Cloudy, but that\'s okay.' : 'Overcast tonight.';
    if (code === 45 || code === 48) return isDaytime ? 'Foggy out. Drive carefully. 🌫' : 'Foggy tonight. Drive carefully. 🌫';

    return 'Weather loaded. You\'re all set.';
  }

  // --- Animations ---

  function cinematicEntrance() {
    const heroCard = $('hero-card');
    const surface = $('content-surface');
    const locLabel = $('location-label');
    const condition = $('current-condition');
    const briefing = $('weather-briefing');

    [heroCard, surface].forEach(e => {
      if (!e) return;
      e.style.opacity = '0';
      e.style.transform = 'translateY(20px)';
    });
    [locLabel, condition, briefing].forEach(e => { if (e) e.style.opacity = '0'; });

    requestAnimationFrame(() => {
      if (heroCard) {
        heroCard.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.16,1,0.3,1)';
        heroCard.style.opacity = '1';
        heroCard.style.transform = 'translateY(0)';
      }
    });

    setTimeout(() => {
      if (locLabel) { locLabel.style.transition = 'opacity 0.4s ease'; locLabel.style.opacity = '1'; }
    }, 300);

    setTimeout(() => {
      [condition, briefing].forEach(e => {
        if (!e) return;
        e.style.transition = 'opacity 0.4s ease';
        e.style.opacity = '1';
      });
    }, 500);

    setTimeout(() => {
      if (surface) {
        surface.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1)';
        surface.style.opacity = '1';
        surface.style.transform = 'translateY(0)';
      }
    }, 700);

    setTimeout(() => animateEntrance(), 1000);

    setTimeout(() => {
      [heroCard, surface, locLabel, condition, briefing].forEach(e => {
        if (!e) return;
        e.style.transition = '';
        e.style.transform = '';
        e.style.opacity = '';
      });
    }, 2000);
  }

  function animateEntrance() {
    // Remove any existing animations first
    document.querySelectorAll('.animate-in').forEach(e => e.classList.remove('animate-in'));

    const targets = [
      { sel: '#hero-card', delay: 0 },
      { sel: '#content-surface', delay: 100 },
      { sel: '#stats-inline', delay: 160 },
      { sel: '#alert-banner-nws', delay: 220 },
      { sel: '#tabs', delay: 280 },
    ];

    targets.forEach(({ sel, delay, stagger }) => {
      const els = Array.from(document.querySelectorAll(sel));
      els.forEach((e, i) => {
        if (!e) return;
        e.style.animationDelay = `${delay + (stagger ? i * stagger : 0)}ms`;
        void e.offsetWidth;
        e.classList.add('animate-in');
      });
    });
  }

  let tempAnimFrame = null;
  function animateTemperature(targetF) {
    if (tempAnimFrame) cancelAnimationFrame(tempAnimFrame);
    if (targetF == null || isNaN(targetF)) {
      el.currentTemp.textContent = '—';
      return;
    }
    const startTime = performance.now();
    const duration = 600;
    const startVal = 0;
    const endVal = targetF;

    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const current = startVal + (endVal - startVal) * easeOutExpo(progress);
      el.currentTemp.textContent = displayTemp(current);
      if (progress < 1) {
        tempAnimFrame = requestAnimationFrame(tick);
      } else {
        el.currentTemp.textContent = displayTemp(endVal);
        tempAnimFrame = null;
      }
    }
    tempAnimFrame = requestAnimationFrame(tick);
  }

  function animate7DayBars() {
    const bars = document.querySelectorAll('.daily-prob-bar');
    bars.forEach((bar, i) => {
      const finalWidth = bar.dataset.finalWidth;
      if (!finalWidth) return;
      bar.style.width = '0%';
      bar.style.transitionDelay = `${i * 80}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bar.style.width = finalWidth;
      }));
    });
  }

  // --- Main render orchestrator ---

  function render(weather, location) {
    const current = weather.current;
    const minutelySlots = processMinutely(weather.minutely_15);
    const hourlySlots = processHourly(weather.hourly);

    const dailySlots = processDaily(weather.daily);

    renderCurrent(current, location);

    // Animate temperature counter on first render
    if (isFirstRender || isVeryFirstRender) {
      animateTemperature(current.temperature_2m);
    }

    // Weather briefing
    const briefingEl = $('weather-briefing');
    if (briefingEl) briefingEl.textContent = getWeatherBriefing(weather, dailySlots, hourlySlots);
    renderFeelsTrend(current, hourlySlots);
    renderStatsInline(current);
    renderAlertBanner(activeAlerts);
    renderPrecipIndicator(minutelySlots);
    renderNowTab(minutelySlots, dailySlots, hourlySlots, activeAlerts);
    renderHourlyTab(hourlySlots);
    renderDaily(dailySlots, hourlySlots);
    applyWeatherBackground(current.weather_code, dailySlots);

    el.loading.classList.add('hidden');
    el.error.classList.add('hidden');
    el.weatherContent.classList.remove('hidden');

    // Restore tabs visibility after skeleton
    const tabsEl = el.weatherContent.querySelector('#tabs');
    if (tabsEl) tabsEl.style.visibility = '';

    // Update last-updated timestamp
    cacheTimestamp = Date.now();
    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    updateDataAge(null);

    // Stop refresh spinner
    el.btnRefresh.classList.remove('spinning');

    // Update GPS chip temp
    const gpsChipTemp = document.querySelector('.loc-chip-gps .loc-chip-temp');
    if (gpsChipTemp && !currentSavedLocation) {
      gpsChipTemp.textContent = `${wmo(current.weather_code).icon} ${displayTemp(current.temperature_2m)}`;
    }
    // Update active saved chip temp
    if (currentSavedLocation) {
      const activeChipTemp = document.querySelector('.loc-chip.active .loc-chip-temp');
      if (activeChipTemp) activeChipTemp.textContent = `${wmo(current.weather_code).icon} ${displayTemp(current.temperature_2m)}`;
    }
    // Background update all chip temps
    updateChipTemps();

    // Entrance animation
    if (isVeryFirstRender) {
      cinematicEntrance();
      isVeryFirstRender = false;
      isFirstRender = false;
    } else if (isFirstRender) {
      animateEntrance();
      isFirstRender = false;
    }

    if (!refreshInterval) {
      refreshInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && savedLat !== null) {
          debouncedFetch(savedLat, savedLon);
        }
      }, 15 * 60 * 1000);
    }
  }

  // --- Error handling ---

  function showError(message, retryable) {
    el.loading.classList.add('hidden');
    el.error.classList.remove('hidden');
    el.error.textContent = message;
    el.error.style.cursor = retryable ? 'pointer' : 'default';
  }

  el.error.addEventListener('click', () => {
    if (el.error.style.cursor === 'pointer') load();
  });

  // --- NWS Alerts ---

  async function fetchAlerts(lat, lon) {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
      { headers: { 'User-Agent': 'WXNOW/1.0 (wxnow.vercel.app)', 'Accept': 'application/geo+json' } }
    );
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    const data = await res.json();
    const now = new Date();
    const sevOrder = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    return (data.features || [])
      .map(f => f.properties)
      .filter(p => new Date(p.expires) >= now)
      .sort((a, b) => (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4));
  }

  function renderAlertBanner(alerts) {
    if (!alerts || alerts.length === 0) {
      el.alertBanner.classList.add('hidden');
      document.title = 'WXNOW';
      return;
    }
    const most = alerts[0]; // already sorted by severity
    const borderColors = { Extreme: '#ef4444', Severe: '#f97316', Moderate: '#f59e0b' };
    const bgColors = { Extreme: 'rgba(239,68,68,0.06)', Severe: 'rgba(249,115,22,0.06)', Moderate: 'rgba(245,158,11,0.06)' };
    el.alertBanner.style.borderLeftColor = borderColors[most.severity] || 'var(--border)';
    el.alertBanner.style.background = bgColors[most.severity] || 'rgba(245,158,11,0.06)';
    el.alertBanner.querySelector('.alert-banner-text').textContent = `${most.event} · Expires ${formatTime(most.expires)}`;
    el.alertBanner.classList.remove('hidden');

    const severe = alerts.find(a => a.severity === 'Extreme' || a.severity === 'Severe');
    document.title = severe ? `⚠ WXNOW — ${severe.event}` : 'WXNOW';
  }

  function openAlertSheet(alerts) {
    clearEl(el.alertSheetContent);
    const sevStyles = {
      Extreme: { bg: '#7f1d1d', text: '#fca5a5' },
      Severe:  { bg: '#7c2d12', text: '#fdba74' },
      Moderate:{ bg: '#713f12', text: '#fde68a' },
    };
    const defaultStyle = { bg: '#1e293b', text: '#94a3b8' };
    alerts.forEach(a => {
      const s = sevStyles[a.severity] || defaultStyle;
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '20px';
      const badge = document.createElement('span');
      badge.className = 'sheet-alert-badge';
      badge.textContent = a.severity;
      badge.style.background = s.bg;
      badge.style.color = s.text;
      const event = document.createElement('div');
      event.className = 'sheet-alert-event';
      event.textContent = a.event;
      const headline = document.createElement('div');
      headline.className = 'sheet-alert-headline';
      headline.textContent = a.headline || '';
      const expires = document.createElement('div');
      expires.className = 'sheet-alert-expires';
      expires.textContent = `Expires ${formatTime(a.expires)}`;
      wrap.appendChild(badge);
      wrap.appendChild(event);
      wrap.appendChild(headline);
      wrap.appendChild(expires);
      if (a.instruction) {
        const inst = document.createElement('div');
        inst.className = 'sheet-alert-instruction';
        inst.textContent = a.instruction;
        wrap.appendChild(inst);
      }
      el.alertSheetContent.appendChild(wrap);
    });
    el.alertSheetOverlay.classList.remove('hidden');
    requestAnimationFrame(() => el.alertSheetOverlay.classList.add('visible'));
  }

  function closeAlertSheet() {
    el.alertSheetOverlay.classList.remove('visible');
    setTimeout(() => el.alertSheetOverlay.classList.add('hidden'), 300);
  }

  // Alert banner click → open sheet
  el.alertBanner.addEventListener('click', () => {
    if (activeAlerts && activeAlerts.length > 0) openAlertSheet(activeAlerts);
  });
  // Close sheet on overlay click
  el.alertSheetOverlay.addEventListener('click', (e) => {
    if (e.target === el.alertSheetOverlay) closeAlertSheet();
  });


  // --- Load ---

  const debouncedFetch = debounce(async (lat, lon, overrideLocation) => {
    isFirstRender = true;
    confettiFired = false;
    const myFetchId = ++fetchId;
    try {
      lastFetchTime = Date.now();
      const results = await Promise.allSettled([
        fetchWeather(lat, lon),
        overrideLocation ? Promise.resolve(overrideLocation) : reverseGeocode(lat, lon),
        fetchAlerts(lat, lon),
      ]);
      if (myFetchId !== fetchId) return; // stale
      const weather = results[0].status === 'fulfilled' ? results[0].value : null;
      const location = results[1].status === 'fulfilled' ? results[1].value : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      activeAlerts = results[2].status === 'fulfilled' ? results[2].value : [];
      if (!weather) throw new Error('Weather fetch failed');
      lastWeather = weather;
      lastLocation = location;
      render(weather, location);
      saveCache();
    } catch {
      if (myFetchId === fetchId && !lastWeather) showError('Failed to load weather data. Tap to retry.', true);
    }
  }, 300);

  async function load() {
    // Try loading cached data immediately
    const cached = loadCache();
    let showedCache = false;

    if (cached) {
      // Restore cached state immediately
      lastWeather = cached.weather;
      lastLocation = cached.location;
      savedLat = cached.lat;
      savedLon = cached.lon;
      activeAlerts = cached.alerts || [];
      cacheTimestamp = cached.timestamp;
      render(cached.weather, cached.location);
      updateDataAge(cached.timestamp);
      lastUpdatedEl.textContent = `Updated ${new Date(cached.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      showedCache = true;
    } else {
      // No cache — show skeleton
      renderSkeleton();
    }

    if (!navigator.onLine) {
      if (!showedCache) {
        showError('No connection. Tap to retry when connected.', true);
      }
      return;
    }

    // Fetch fresh data (background refresh if cache was shown)
    try {
      const pos = await getPosition();
      savedLat = pos.coords.latitude;
      savedLon = pos.coords.longitude;
      debouncedFetch(savedLat, savedLon);
    } catch (err) {
      if (!showedCache) {
        if (err.code === 1) {
          showError('WXNOW needs your location to show weather. You can also search for a city above. 📍', false);
        } else if (err.code === 3) {
          showError('Location request timed out. Tap to retry.', true);
        } else {
          showError(`Location error: ${err.message}. Tap to retry.`, true);
        }
      } else if (savedLat !== null) {
        // Have cached coords, try refreshing with those
        debouncedFetch(savedLat, savedLon);
      }
    }
  }

  el.btnRefresh.addEventListener('click', () => {
    el.btnRefresh.classList.add('spinning');
    if (savedLat !== null && savedLon !== null) {
      debouncedFetch(savedLat, savedLon);
    } else {
      load();
    }
  });

  // --- Onboarding ---
  let needsOnboarding = false;
  try { needsOnboarding = !localStorage.getItem('wxnow-onboarded'); } catch { needsOnboarding = false; }

  if (needsOnboarding) {
    // Build onboarding overlay
    const overlay = document.createElement('div');
    overlay.id = 'onboarding';

    const screens = [
      {
        heading: 'Hey there! 👋',
        subtext: 'WXNOW shows you minute-by-minute weather — no ads, no account, no nonsense.',
        visual: '<div style="font-size:48px">⛅</div>',
      },
      {
        heading: 'Know before it rains 🌧',
        subtext: '15-minute precipitation windows, best time to go outside, and severe weather alerts from NOAA — all in one glance.',
        visual: '<div style="font-size:48px">🌧</div>',
      },
      {
        heading: 'One more thing 📍',
        subtext: 'WXNOW needs your location for local weather. Nothing is stored or tracked. Promise.',
        visual: '<div class="onboard-pin">📍</div>',
      },
    ];

    let currentScreen = 0;
    const screenEls = [];

    screens.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'onboard-screen' + (i === 0 ? ' active' : '');
      div.innerHTML = `
        <div class="onboard-heading">${s.heading}</div>
        <div class="onboard-subtext">${s.subtext}</div>
        ${s.visual}
      `;
      screenEls.push(div);
      overlay.appendChild(div);
    });

    // Dots
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'onboard-dots';
    const dots = [];
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'onboard-dot' + (i === 0 ? ' active' : '');
      dots.push(dot);
      dotsWrap.appendChild(dot);
    }
    overlay.appendChild(dotsWrap);

    // Nav buttons container
    const navWrap = document.createElement('div');
    navWrap.className = 'onboard-nav';
    navWrap.style.marginTop = '16px';

    const backBtn = document.createElement('button');
    backBtn.className = 'onboard-nav-btn';
    backBtn.textContent = '← Back';
    backBtn.style.visibility = 'hidden';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'onboard-nav-btn';
    nextBtn.textContent = 'Next →';

    navWrap.appendChild(backBtn);
    navWrap.appendChild(nextBtn);
    overlay.appendChild(navWrap);

    // Screen 3 action buttons (hidden initially)
    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'none';
    actionWrap.style.flexDirection = 'column';
    actionWrap.style.alignItems = 'center';
    actionWrap.style.gap = '12px';
    actionWrap.style.marginTop = '16px';
    actionWrap.style.width = '100%';
    actionWrap.style.maxWidth = '280px';

    const enableBtn = document.createElement('button');
    enableBtn.className = 'onboard-btn';
    enableBtn.textContent = 'Let\'s go →';

    const searchLink = document.createElement('button');
    searchLink.className = 'onboard-btn-secondary';
    searchLink.textContent = 'Or search a city instead';

    actionWrap.appendChild(enableBtn);
    actionWrap.appendChild(searchLink);
    overlay.appendChild(actionWrap);

    document.body.appendChild(overlay);

    function goToScreen(idx) {
      if (idx < 0 || idx > 2) return;
      screenEls[currentScreen].classList.remove('active');
      dots[currentScreen].classList.remove('active');
      currentScreen = idx;
      screenEls[currentScreen].classList.add('active');
      dots[currentScreen].classList.add('active');

      backBtn.style.visibility = currentScreen === 0 ? 'hidden' : 'visible';

      if (currentScreen === 2) {
        navWrap.style.display = 'none';
        actionWrap.style.display = 'flex';
      } else {
        navWrap.style.display = 'flex';
        actionWrap.style.display = 'none';
      }
    }

    nextBtn.addEventListener('click', () => goToScreen(currentScreen + 1));
    backBtn.addEventListener('click', () => goToScreen(currentScreen - 1));

    function dismissOnboarding() {
      try { localStorage.setItem('wxnow-onboarded', 'true'); } catch {}
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 300);
    }

    enableBtn.addEventListener('click', async () => {
      enableBtn.textContent = 'Locating...';
      enableBtn.disabled = true;
      try {
        const pos = await getPosition();
        savedLat = pos.coords.latitude;
        savedLon = pos.coords.longitude;
        dismissOnboarding();
        debouncedFetch(savedLat, savedLon);
      } catch {
        dismissOnboarding();
        el.searchInput.focus();
        showError('Location denied. Search for a city above.', false);
      }
    });

    searchLink.addEventListener('click', () => {
      dismissOnboarding();
      el.searchInput.focus();
    });

    // Swipe navigation
    let touchStartX = 0;
    overlay.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dx < -50) goToScreen(currentScreen + 1);
      else if (dx > 50) goToScreen(currentScreen - 1);
    }, { passive: true });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('onboarding')) return;
      if (e.key === 'ArrowRight') goToScreen(currentScreen + 1);
      else if (e.key === 'ArrowLeft') goToScreen(currentScreen - 1);
    });

    // Hide loading spinner since onboarding is showing
    el.loading.classList.add('hidden');
  } else {
    renderLocationChips();
    load();
  }

  // Radar button
  function radarStation(lat) {
    if (lat < 27.5) return 'KAMX';
    if (lat < 29.5) return 'KTBW';
    if (lat < 31.5) return 'KJAX';
    return 'KEVX';
  }

  el.btnRadar.addEventListener('click', () => {
    if (savedLat !== null) {
      window.open(`https://radar.weather.gov/station/${radarStation(savedLat)}/standard`, '_blank');
    }
  });

  // Unit toggle
  el.btnUnit.textContent = useFahrenheit ? '°C' : '°F';

  el.btnUnit.addEventListener('click', () => {
    if (!lastWeather) return;
    useFahrenheit = !useFahrenheit;
    el.btnUnit.textContent = useFahrenheit ? '°C' : '°F';
    try { localStorage.setItem('wxnow-unit', useFahrenheit ? 'f' : 'c'); } catch {}
    render(lastWeather, lastLocation);
    renderLocationChips();
    updateChipTemps();
  });

  // Theme toggle
  const btnTheme = $('btn-theme');
  btnTheme.textContent = isLightTheme() ? '🌙' : '☀';

  function toggleTheme() {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 500);
    const current = document.documentElement.dataset.theme || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('wxnow-theme', next); } catch {}
    btnTheme.textContent = next === 'dark' ? '☀' : '🌙';
    if (lastWeather) {
      const dailySlots = processDaily(lastWeather.daily);
      applyWeatherBackground(lastWeather.current.weather_code, dailySlots);
    }
  }

  btnTheme.addEventListener('click', toggleTheme);

  // OS-level preference changes
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    try { if (localStorage.getItem('wxnow-theme')) return; } catch {}
    document.documentElement.dataset.theme = e.matches ? 'light' : 'dark';
    btnTheme.textContent = e.matches ? '🌙' : '☀';
    if (lastWeather) {
      const dailySlots = processDaily(lastWeather.daily);
      applyWeatherBackground(lastWeather.current.weather_code, dailySlots);
    }
  });

  // --- Weather Card Generator ---

  function getWeatherGradient(weatherCode, dailySlots) {
    let isDaytime = true;
    if (dailySlots && dailySlots.length > 0) {
      const now = Date.now();
      const rise = new Date(dailySlots[0].sunrise).getTime();
      const set = new Date(dailySlots[0].sunset).getTime();
      isDaytime = now > rise && now < set;
    }
    const light = isLightTheme();
    const code = weatherCode;
    // Returns 4-stop gradient matching applyWeatherBackground palettes
    if (!isDaytime) {
      if (code >= 95) return { c1:'#08060e',c2:'#100c20',c3:'#1a1230',c4:'#221840' };
      if (code >= 51 && code <= 82) return { c1:'#080e1a',c2:'#0e1a2c',c3:'#14263c',c4:'#1c324c' };
      return { c1:'#070b1e',c2:'#0f1640',c3:'#1a2060',c4:'#252d75' };
    }
    if (code === 0 || code === 1) {
      return light ? { c1:'#1a8cff',c2:'#4da6ff',c3:'#87c4f5',c4:'#bfdcf5' }
        : { c1:'#06101f',c2:'#0c1e38',c3:'#122c4e',c4:'#183a5c' };
    }
    if (code === 3) {
      return light ? { c1:'#6a7a8a',c2:'#8494a2',c3:'#a0adb8',c4:'#bcc5cc' }
        : { c1:'#0c1018',c2:'#141a24',c3:'#1e242e',c4:'#282f38' };
    }
    if (code >= 95) {
      return light ? { c1:'#1e2430',c2:'#2a3242',c3:'#3a4454',c4:'#4e5868' }
        : { c1:'#08060e',c2:'#100c20',c3:'#1a1230',c4:'#221840' };
    }
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
      return light ? { c1:'#2e3e4e',c2:'#40525f',c3:'#586a76',c4:'#728490' }
        : { c1:'#080e1a',c2:'#0e1a2c',c3:'#14263c',c4:'#1c324c' };
    }
    return light ? { c1:'#5494cc',c2:'#7aadda',c3:'#a3c5e5',c4:'#ccdceb' }
      : { c1:'#0a1420',c2:'#0f1e30',c3:'#162940',c4:'#1e344e' };
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function generateWeatherCard() {
    return new Promise((resolve, reject) => {
      try {
        if (!lastWeather) return reject(new Error('No weather data'));
        const W = 1080, H = 1920;
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
          canvas = new OffscreenCanvas(W, H);
        } else {
          canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
        }
        const ctx = canvas.getContext('2d');
        const current = lastWeather.current;
        const hourlySlots = processHourly(lastWeather.hourly);
        const dailySlots = processDaily(lastWeather.daily);
        const location = lastLocation || 'Unknown';

        // --- Background gradient ---
        const grad = getWeatherGradient(current.weather_code, dailySlots);
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, grad.c1);
        bgGrad.addColorStop(0.35, grad.c2);
        bgGrad.addColorStop(0.7, grad.c3);
        bgGrad.addColorStop(1, grad.c4);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Noise overlay
        const noiseData = ctx.getImageData(0, 0, W, H);
        const pixels = noiseData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const v = Math.random() * 255;
          pixels[i] = Math.min(255, pixels[i] + v * 0.03);
          pixels[i + 1] = Math.min(255, pixels[i + 1] + v * 0.03);
          pixels[i + 2] = Math.min(255, pixels[i + 2] + v * 0.03);
        }
        ctx.putImageData(noiseData, 0, 0);

        const BODY = 'system-ui, -apple-system, sans-serif';
        const light = isLightTheme();
        const textPrimary = light ? '#0f172a' : '#ffffff';
        const textSecondary = light ? '#64748b' : '#94a3b8';
        const textTertiary = light ? '#64748b' : '#64748b';
        const textDim = light ? '#94a3b8' : '#475569';
        const pillBg = light ? 'rgba(241,245,249,0.8)' : 'rgba(15, 23, 42, 0.6)';
        const barBg = light ? '#e2e8f0' : '#1e293b';
        const accentColor = light ? '#0284c7' : '#38bdf8';
        const footerDim = light ? '#94a3b8' : '#334155';

        // --- Top section (y: 80–300) ---
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Location
        ctx.fillStyle = textPrimary;
        ctx.font = `600 32px ${BODY}`;
        ctx.fillText(location, W / 2, 80);

        // "Right Now" label
        ctx.fillStyle = textSecondary;
        ctx.font = `400 16px ${BODY}`;
        ctx.fillText('Right Now', W / 2, 124);

        // Current temp — scale down if too wide
        const tempStr = displayTemp(current.temperature_2m);
        let tempSize = 120;
        ctx.font = `800 ${tempSize}px ${BODY}`;
        while (ctx.measureText(tempStr).width > W * 0.7 && tempSize > 60) {
          tempSize -= 4;
          ctx.font = `800 ${tempSize}px ${BODY}`;
        }
        ctx.fillStyle = textPrimary;
        ctx.fillText(tempStr, W / 2, 152);

        // Condition
        const w = wmo(current.weather_code);
        ctx.fillStyle = textSecondary;
        ctx.font = `400 20px ${BODY}`;
        ctx.fillText(`${w.icon} ${w.label}`, W / 2, 152 + tempSize + 8);

        // Feels like
        ctx.fillStyle = textTertiary;
        ctx.font = `400 16px ${BODY}`;
        ctx.fillText(`Feels like ${displayTemp(current.apparent_temperature)}`, W / 2, 152 + tempSize + 44);

        // --- Middle section: Next 12 Hours (y: 340–700) ---
        const hourly = hourlySlots || [];
        const hourCount = Math.min(hourly.length, 12);
        if (hourCount > 0) {
          ctx.fillStyle = textSecondary;
          ctx.font = `400 16px ${BODY}`;
          ctx.fillText('Next 12 Hours', W / 2, 340);

          const margin = 60;
          const usableW = W - margin * 2;
          const colW = hourCount > 1 ? usableW / hourCount : usableW;
          const baseY = 370;

          // Gather temps for curve
          const temps = hourly.slice(0, hourCount).map(s => s.temp);
          const minT = Math.min(...temps);
          const maxT = Math.max(...temps);
          const range = maxT - minT || 1;
          const curveTop = 460;
          const curveBottom = 600;
          const curveH = curveBottom - curveTop;

          // Hour labels, emojis, temps
          for (let i = 0; i < hourCount; i++) {
            const x = margin + colW * i + colW / 2;
            const slot = hourly[i];

            // Hour label
            ctx.fillStyle = textDim;
            ctx.font = `400 12px ${BODY}`;
            ctx.fillText(new Date(slot.time).toLocaleTimeString([], { hour: 'numeric' }), x, baseY);

            // Emoji
            ctx.font = `400 20px ${BODY}`;
            ctx.fillText(wmo(slot.code).icon, x, baseY + 20);

            // Temp
            ctx.fillStyle = textPrimary;
            ctx.font = `400 14px ${BODY}`;
            ctx.fillText(displayTemp(slot.temp), x, baseY + 50);
          }

          // Smooth curve
          const points = [];
          for (let i = 0; i < hourCount; i++) {
            const x = margin + colW * i + colW / 2;
            const y = curveBottom - ((temps[i] - minT) / range) * curveH;
            points.push({ x, y });
          }

          if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
              const cx = (points[i].x + points[i + 1].x) / 2;
              const cy = (points[i].y + points[i + 1].y) / 2;
              ctx.quadraticCurveTo(points[i].x, points[i].y, cx, cy);
            }
            ctx.quadraticCurveTo(
              points[points.length - 1].x,
              points[points.length - 1].y,
              points[points.length - 1].x,
              points[points.length - 1].y
            );
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Fill below curve
            ctx.lineTo(points[points.length - 1].x, curveBottom + 10);
            ctx.lineTo(points[0].x, curveBottom + 10);
            ctx.closePath();
            ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
            ctx.fill();
          }
        }

        // --- Bottom section: Stat pills (y: 640–710) ---
        const pillY = 660;
        const pills = [
          { emoji: '💨', text: `${displayWind(current.wind_speed_10m)} ${degToCompass(current.wind_direction_10m)}` },
          { emoji: '💧', text: `${current.relative_humidity_2m}%` },
          { emoji: '☀️', text: `UV ${dailySlots && dailySlots[0] ? Math.round(dailySlots[0].uvMax) : '—'}` },
        ];
        const pillW = 280;
        const pillH = 48;
        const pillGap = 30;
        const totalPillW = pills.length * pillW + (pills.length - 1) * pillGap;
        const pillStartX = (W - totalPillW) / 2;

        pills.forEach((pill, i) => {
          const px = pillStartX + i * (pillW + pillGap);
          ctx.fillStyle = pillBg;
          roundRect(ctx, px, pillY, pillW, pillH, 20);
          ctx.fill();
          ctx.fillStyle = textPrimary;
          ctx.font = `400 14px ${BODY}`;
          ctx.textAlign = 'center';
          ctx.fillText(`${pill.emoji} ${pill.text}`, px + pillW / 2, pillY + 16);
        });

        // --- Alert banner (y: 740, conditional) ---
        let yOffset = 760;
        const severeAlert = (activeAlerts || []).find(a => a.severity === 'Extreme' || a.severity === 'Severe');
        if (severeAlert) {
          const alertBg = severeAlert.severity === 'Extreme' ? '#7f1d1d' : '#7c2d12';
          ctx.fillStyle = alertBg;
          ctx.fillRect(0, yOffset, W, 60);
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 16px ${BODY}`;
          ctx.textAlign = 'center';
          ctx.fillText(`⚠ ${severeAlert.event}`, W / 2, yOffset + 22);
          yOffset += 80;
        }

        // --- 7-Day forecast (yOffset → +560) ---
        if (dailySlots && dailySlots.length > 0) {
          ctx.fillStyle = textSecondary;
          ctx.font = `400 16px ${BODY}`;
          ctx.textAlign = 'center';
          ctx.fillText('7-Day Forecast', W / 2, yOffset);
          yOffset += 36;

          const weekMin = Math.min(...dailySlots.map(d => d.minTemp));
          const weekMax = Math.max(...dailySlots.map(d => d.maxTemp));
          const weekRange = weekMax - weekMin || 1;
          const rowH = 75;
          const rowGap = 8;
          const rowMargin = 60;
          const barAreaX = 420;
          const barAreaW = 400;

          dailySlots.forEach((day, idx) => {
            const ry = yOffset + idx * (rowH + rowGap);

            // Day label
            ctx.textAlign = 'left';
            ctx.fillStyle = textSecondary;
            ctx.font = `400 16px ${BODY}`;
            let dayLabel;
            if (idx === 0) dayLabel = 'TODAY';
            else if (idx === 1) dayLabel = 'TMR';
            else dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
            ctx.fillText(dayLabel, rowMargin, ry + 10);

            // Emoji
            ctx.textAlign = 'center';
            ctx.font = `400 22px ${BODY}`;
            ctx.fillText(wmo(day.code).icon, rowMargin + 100, ry + 8);

            // High temp
            ctx.textAlign = 'right';
            ctx.fillStyle = textPrimary;
            ctx.font = `600 16px ${BODY}`;
            ctx.fillText(displayTemp(day.maxTemp), barAreaX - 16, ry + 10);

            // Low temp
            ctx.textAlign = 'left';
            ctx.fillStyle = textTertiary;
            ctx.font = `400 16px ${BODY}`;
            ctx.fillText(displayTemp(day.minTemp), barAreaX + barAreaW + 16, ry + 10);

            // Temp bar background
            ctx.fillStyle = barBg;
            roundRect(ctx, barAreaX, ry + 8, barAreaW, 18, 9);
            ctx.fill();

            // Temp bar fill
            const barStart = ((day.minTemp - weekMin) / weekRange) * barAreaW;
            const barEnd = ((day.maxTemp - weekMin) / weekRange) * barAreaW;
            const barFillW = Math.max(barEnd - barStart, 12);
            const barGrad = ctx.createLinearGradient(barAreaX + barStart, 0, barAreaX + barStart + barFillW, 0);
            barGrad.addColorStop(0, '#38bdf8');
            barGrad.addColorStop(1, '#f59e0b');
            ctx.fillStyle = barGrad;
            roundRect(ctx, barAreaX + barStart, ry + 8, barFillW, 18, 9);
            ctx.fill();
          });

          yOffset += dailySlots.length * (rowH + rowGap);
        }

        // --- Footer branding (bottom area) ---
        const footerY = Math.max(yOffset + 40, 1700);

        // Divider
        ctx.strokeStyle = barBg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.2, footerY);
        ctx.lineTo(W * 0.8, footerY);
        ctx.stroke();

        // WXNOW wordmark
        ctx.textAlign = 'center';
        ctx.fillStyle = accentColor;
        ctx.font = `800 28px ${BODY}`;
        ctx.fillText('WXNOW', W / 2, footerY + 24);

        // URL
        ctx.fillStyle = textDim;
        ctx.font = `400 14px ${BODY}`;
        ctx.fillText('wxnow.vercel.app', W / 2, footerY + 62);

        // Tagline
        ctx.fillStyle = footerDim;
        ctx.font = `400 12px ${BODY}`;
        ctx.fillText('Minute-by-minute weather · No ads · No account', W / 2, footerY + 86);

        // --- Export as PNG blob ---
        if (canvas.convertToBlob) {
          canvas.convertToBlob({ type: 'image/png' }).then(resolve).catch(reject);
        } else {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed'));
          }, 'image/png');
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // --- Toast notification ---
  function showToast(msg) {
    let toast = document.getElementById('wxnow-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wxnow-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  // --- Card Preview Modal ---
  function showCardPreview(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const overlay = document.createElement('div');
      overlay.id = 'card-preview-overlay';

      const img = document.createElement('img');
      img.src = url;
      img.id = 'card-preview-img';

      const btnRow = document.createElement('div');
      btnRow.id = 'card-preview-btns';

      const shareBtn = document.createElement('button');
      shareBtn.textContent = 'Share';
      shareBtn.className = 'card-preview-btn primary';
      shareBtn.addEventListener('click', () => { cleanup(); resolve('share'); });

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'card-preview-btn';
      saveBtn.addEventListener('click', () => { cleanup(); resolve('save'); });

      btnRow.appendChild(shareBtn);
      btnRow.appendChild(saveBtn);
      overlay.appendChild(img);
      overlay.appendChild(btnRow);
      document.body.appendChild(overlay);

      // Force reflow then animate in
      overlay.offsetHeight;
      overlay.classList.add('visible');

      // Dismiss on outside click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { cleanup(); resolve('dismiss'); }
      });

      function cleanup() {
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.remove();
          URL.revokeObjectURL(url);
        }, 300);
      }
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function cardFilename() {
    const loc = (lastLocation || 'weather').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    return `wxnow-${loc}-${date}.png`;
  }

  async function shareWithCard() {
    const blob = await generateWeatherCard();
    const file = new File([blob], 'wxnow-weather.png', { type: 'image/png' });
    const text = generateShareText(lastWeather, lastLocation, activeAlerts);

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
    } else if (navigator.share) {
      await navigator.share({ text, url: 'https://wxnow.vercel.app' });
    } else {
      downloadBlob(blob, cardFilename());
      showToast('Weather card saved!');
    }
  }

  // Share button
  el.btnShare.addEventListener('click', async () => {
    if (!lastWeather) return;
    const origText = el.btnShare.textContent;
    el.btnShare.textContent = '···';
    el.btnShare.disabled = true;
    try {
      const start = performance.now();
      const blob = await generateWeatherCard();
      const elapsed = performance.now() - start;

      if (elapsed < 500) {
        // Show preview
        const action = await showCardPreview(blob);
        if (action === 'share') {
          const file = new File([blob], 'wxnow-weather.png', { type: 'image/png' });
          const text = generateShareText(lastWeather, lastLocation, activeAlerts);
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text });
          } else if (navigator.share) {
            await navigator.share({ text, url: 'https://wxnow.vercel.app' });
          } else {
            downloadBlob(blob, cardFilename());
            showToast('Weather card saved!');
          }
        } else if (action === 'save') {
          downloadBlob(blob, cardFilename());
          showToast('Weather card saved!');
        }
      } else {
        // Skip preview, share directly
        await shareWithCard();
      }
      el.btnShare.textContent = '✓';
      setTimeout(() => { el.btnShare.textContent = origText; }, 2000);
    } catch (err) {
      // Fall back to text-only share
      try {
        const text = generateShareText(lastWeather, lastLocation, activeAlerts);
        if (navigator.share) {
          await navigator.share({ text });
        } else {
          await navigator.clipboard.writeText(text);
          showToast('Weather copied to clipboard');
        }
        el.btnShare.textContent = '✓';
        setTimeout(() => { el.btnShare.textContent = origText; }, 2000);
      } catch { /* user cancelled */ }
    } finally {
      el.btnShare.disabled = false;
      if (el.btnShare.textContent === '···') el.btnShare.textContent = origText;
    }
  });

  // Smart auto-refresh on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lastFetchTime && savedLat !== null) {
      if (Date.now() - lastFetchTime > 15 * 60 * 1000) {
        debouncedFetch(savedLat, savedLon);
      }
    }
  });

  // Install nudge
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    try {
      if (!localStorage.getItem('wxnow-install-dismissed')) {
        el.installNudge.classList.remove('hidden');
      }
    } catch {}
  });

  el.btnInstallDismiss.addEventListener('click', () => {
    el.installNudge.classList.add('hidden');
    try { localStorage.setItem('wxnow-install-dismissed', '1'); } catch {}
  });

  // Install nudge swipe dismiss
  let nudgeTouchStartX = 0;
  el.installNudge.addEventListener('touchstart', (e) => {
    nudgeTouchStartX = e.touches[0].clientX;
  }, { passive: true });
  el.installNudge.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - nudgeTouchStartX;
    if (dx < -50) {
      el.installNudge.classList.add('hidden');
      try { localStorage.setItem('wxnow-install-dismissed', '1'); } catch {}
    }
  }, { passive: true });

  // --- Location Search ---

  let searchTimer = null;

  function hideSearchResults() {
    el.searchResults.classList.remove('visible');
  }

  function showSearchItem(text, clickable, onClick) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.textContent = text;
    if (!clickable) {
      item.style.color = '#475569';
      item.style.cursor = 'default';
    } else {
      item.addEventListener('click', onClick);
    }
    el.searchResults.appendChild(item);
  }

  function restoreGps() {
    if (el.searchInput) el.searchInput.value = '';
    hideSearchResults();
    currentSavedLocation = null;
    isFirstRender = true;
    getPosition().then(pos => {
      savedLat = pos.coords.latitude;
      savedLon = pos.coords.longitude;
      debouncedFetch(savedLat, savedLon);
      renderLocationChips();
    }).catch(() => {
      if (lastWeather) {
        renderLocationChips();
      } else {
        showError('Location access denied.', false);
      }
    });
    renderLocationChips();
  }

  function bindSearchInput() {
    if (!el.searchInput) return;
    el.searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Escape') {
        hideSearchResults();
        el.searchInput.blur();
        return;
      }
      clearTimeout(searchTimer);
      const query = el.searchInput.value.trim();
      if (query.length < 2) {
        hideSearchResults();
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const res = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
          );
          const data = await res.json();
          clearEl(el.searchResults);
          showSearchItem('📍 Use my location', true, restoreGps);
          const results = data.results || [];
          if (results.length === 0) {
            showSearchItem('No results found', false);
          } else {
            results.forEach(r => {
              const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
              showSearchItem(label, true, () => {
                savedLat = r.latitude;
                savedLon = r.longitude;
                const locName = [r.name, r.admin1].filter(Boolean).join(', ');
                lastLocation = locName;
                el.searchInput.value = '';
                el.searchInput.blur();
                hideSearchResults();
                isFirstRender = true;
                debouncedFetch(savedLat, savedLon, locName);
                addSavedLocation(locName, r.latitude, r.longitude);
                currentSavedLocation = { name: locName, lat: r.latitude, lon: r.longitude };
                renderLocationChips();
              });
            });
          }
          el.searchResults.classList.add('visible');
        } catch {
          clearEl(el.searchResults);
          showSearchItem('Search unavailable', false);
          el.searchResults.classList.add('visible');
        }
      }, 300);
    });
  }

  // Initial bind (will be re-bound on each renderLocationChips)
  bindSearchInput();

  // Close search results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#location-bar')) {
      hideSearchResults();
    }
  });

  // --- Pull-to-Refresh ---
  let pullStartY = 0;
  let pulling = false;
  let pullRefreshing = false;
  const pullIndicator = $('pull-indicator');
  const pullText = $('pull-text');

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0 && !pullRefreshing) {
      pullStartY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const pullDistance = e.touches[0].clientY - pullStartY;
    if (pullDistance < 0) { pulling = false; return; }

    const capped = Math.min(pullDistance, 120);
    pullIndicator.style.height = `${capped * 0.5}px`;

    if (capped >= 60) {
      pullText.textContent = '↻ Release to refresh';
      pullIndicator.classList.add('active');
    } else {
      pullText.textContent = '↓ Pull to refresh';
      pullIndicator.classList.remove('active');
    }
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;

    const height = parseInt(pullIndicator.style.height) || 0;
    if (height >= 30 && savedLat !== null && !pullRefreshing) {
      pullRefreshing = true;
      pullText.textContent = '↻';
      pullIndicator.classList.add('refreshing');
      pullIndicator.style.height = '40px';

      isFirstRender = true;
      debouncedFetch(savedLat, savedLon);

      // Wait for render to complete (fetchId change signals completion)
      const waitForRender = () => {
        setTimeout(() => {
          pullIndicator.classList.remove('refreshing', 'active');
          pullIndicator.style.height = '0';
          pullRefreshing = false;
        }, 800);
      };
      waitForRender();
    } else {
      pullIndicator.style.height = '0';
      pullIndicator.classList.remove('active');
    }
  }, { passive: true });
})();
