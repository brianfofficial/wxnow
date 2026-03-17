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
    heroSparkline: $('hero-sparkline'),
    rainSummary: $('rain-summary'),
    statsBar: $('stats-bar'),
    nowAlways: $('now-always'),
    precipIndicator: $('precip-indicator'),
    tab15: $('tab-15min'),
    tabHourly: $('tab-hourly'),
    tab7day: $('tab-7day'),
    btnRefresh: $('btn-refresh'),
    header: $('header'),
    alertsContainer: $('alerts-container'),
    installNudge: $('install-nudge'),
    btnInstallDismiss: $('btn-install-dismiss'),
    btnRadar: $('btn-radar'),
    btnUnit: $('btn-unit'),
    briefingHeadline: $('briefing-headline'),
    briefingLines: $('briefing-lines'),
    feelsTrend: $('feels-trend'),
    btnShare: $('btn-share'),
    searchInput: $('search-input'),
    searchResults: $('search-results'),
    btnSearchClear: $('btn-search-clear'),
    bgGlow: $('bg-glow'),
  };

  // Append last-updated span to header via JS
  const lastUpdatedEl = document.createElement('span');
  lastUpdatedEl.id = 'last-updated';
  el.header.appendChild(lastUpdatedEl);

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

  try { if (localStorage.getItem('wxnow-unit') === 'c') useFahrenheit = false; } catch {}

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

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
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

  function renderStatsBar(current) {
    clearEl(el.statsBar);
    const items = [
      { label: 'HUMIDITY', value: `${current.relative_humidity_2m}%` },
      { label: 'WIND', value: `${displayWind(current.wind_speed_10m)} ${degToCompass(current.wind_direction_10m)}` },
      { label: 'DEW', value: displayTemp(current.dew_point_2m) },
      { label: 'PRECIP', value: current.precipitation === 0 ? 'NONE' : `${current.precipitation}"` },
    ];
    items.forEach((item, idx) => {
      if (idx > 0) {
        const divider = document.createElement('span');
        divider.className = 'stats-divider';
        el.statsBar.appendChild(divider);
      }
      const pill = document.createElement('span');
      pill.className = 'stats-pill';
      const label = document.createElement('span');
      label.className = 'stats-label';
      label.textContent = item.label;
      const value = document.createElement('span');
      value.className = 'stats-value';
      value.textContent = item.value;
      pill.appendChild(label);
      pill.appendChild(value);
      el.statsBar.appendChild(pill);
    });
  }

  function renderSparkline(hourlySlots) {
    clearEl(el.heroSparkline);
    if (!hourlySlots || hourlySlots.length === 0) return;
    const slots = hourlySlots.slice(0, 6);
    slots.forEach((slot) => {
      const col = document.createElement('div');
      col.className = 'spark-col';
      const bar = document.createElement('div');
      bar.className = 'spark-bar';
      const height = Math.max(slot.prob, 4);
      bar.style.height = `${height}%`;
      if (slot.prob > 50) bar.classList.add('spark-high');
      else if (slot.prob > 20) bar.classList.add('spark-med');
      else bar.classList.add('spark-low');
      const label = document.createElement('span');
      label.className = 'spark-label';
      label.textContent = formatHour(slot.time);
      col.appendChild(bar);
      col.appendChild(label);
      el.heroSparkline.appendChild(col);
    });
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

  function renderRainSummary(minutelySlots) {
    const summary = rainSummary(minutelySlots);
    el.rainSummary.textContent = summary.text;
    el.rainSummary.classList.remove('rain-active', 'rain-expected');
    if (summary.active) {
      el.rainSummary.classList.add('rain-active');
    } else if (minutelySlots && minutelySlots.some((s) => s.precip > 0)) {
      el.rainSummary.classList.add('rain-expected');
    }
  }

  function renderPrecipIndicator(minutelySlots) {
    if (minutelySlots && minutelySlots.some((s) => s.precip > 0)) {
      el.precipIndicator.classList.add('active');
    } else {
      el.precipIndicator.classList.remove('active');
    }
  }

  function renderNowTab(minutelySlots) {
    clearEl(el.nowAlways);
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'NEXT 2 HRS';
    el.nowAlways.appendChild(label);

    if (!minutelySlots || minutelySlots.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'tab-unavailable';
      msg.textContent = '15-min data unavailable for this location';
      el.nowAlways.appendChild(msg);
      return;
    }
    const capped = minutelySlots.slice(0, 8);
    const maxPrecip = Math.max(...capped.map((s) => s.precip), 0.01);
    capped.forEach((slot, idx) => {
      const row = document.createElement('div');
      row.className = 'now-row';

      const time = document.createElement('span');
      time.className = 'now-time';
      time.textContent = idx === 0 ? 'NOW' : formatTime(slot.time);

      const barWrap = document.createElement('div');
      barWrap.className = 'now-bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'now-bar';
      bar.style.width = `${Math.max((slot.precip / maxPrecip) * 100, 0)}%`;
      barWrap.appendChild(bar);

      const temp = document.createElement('span');
      temp.className = 'now-temp';
      temp.textContent = displayTemp(slot.temp);

      const precip = document.createElement('span');
      precip.className = 'now-precip';
      precip.textContent = slot.precip === 0 ? '—' : `${slot.precip}"`;

      row.appendChild(time);
      row.appendChild(barWrap);
      row.appendChild(temp);
      row.appendChild(precip);
      el.nowAlways.appendChild(row);
    });
  }

  function render15MinTab(minutelySlots) {
    clearEl(el.tab15);
    if (!minutelySlots || minutelySlots.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'tab-unavailable';
      msg.textContent = '15-min data unavailable for this location';
      el.tab15.appendChild(msg);
      return;
    }
    const hasRain = minutelySlots.some((s) => s.precip > 0);
    if (!hasRain) {
      const msg = document.createElement('div');
      msg.className = 'precip-no-rain';
      msg.textContent = 'No precipitation expected';
      el.tab15.appendChild(msg);
      return;
    }
    const maxPrecip = Math.max(...minutelySlots.map((s) => s.precip), 0.01);
    const chart = document.createElement('div');
    chart.className = 'precip-chart';
    minutelySlots.forEach((slot, idx) => {
      const col = document.createElement('div');
      col.className = 'precip-col';
      const bar = document.createElement('div');
      bar.className = 'precip-bar';
      bar.style.height = `${Math.max((slot.precip / maxPrecip) * 100, 2)}%`;
      const label = document.createElement('span');
      label.className = 'precip-bar-label';
      label.textContent = idx === 0 ? 'NOW' : formatTime(slot.time);
      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);
    });
    el.tab15.appendChild(chart);
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
      banner.textContent = `BEST TIME OUTSIDE TODAY · ${bw.startTime}–${bw.endTime}`;
      banner.className = 'best-window-good';
    } else {
      banner.textContent = 'OUTDOOR CONDITIONS POOR TODAY';
      banner.className = 'best-window-poor';
    }
    el.tab7day.appendChild(banner);

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

  function renderBriefing(daily, hourly, alerts, minutelySlots) {
    const briefing = generateBriefing(daily, hourly, alerts, minutelySlots);
    el.briefingHeadline.textContent = briefing.headline;
    clearEl(el.briefingLines);
    briefing.lines.forEach(line => {
      const div = document.createElement('div');
      div.textContent = line;
      el.briefingLines.appendChild(div);
    });
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
    el.feelsTrend.style.color = trend.color;
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
    lines.push('🕐 via WXNOW · wxnow.app');
    return lines.join('\n');
  }

  // --- Weather Background ---

  function applyWeatherBackground(weatherCode, dailySlots) {
    let isDaytime = true;
    if (dailySlots && dailySlots.length > 0) {
      const now = Date.now();
      const rise = new Date(dailySlots[0].sunrise).getTime();
      const set = new Date(dailySlots[0].sunset).getTime();
      isDaytime = now > rise && now < set;
    }

    let top, bottom, glowBg, glowOp;
    const code = weatherCode;

    if (code === 0 || code === 1) {
      if (isDaytime) {
        top = '#0a1628'; bottom = '#0d2137';
        glowBg = 'radial-gradient(circle, rgba(56,189,248,0.06), transparent)';
        glowOp = '1';
      } else {
        top = '#020617'; bottom = '#060d1f';
        glowBg = ''; glowOp = '0';
      }
    } else if (code === 2 || code === 3) {
      top = code === 2 ? '#0d1f35' : '#111827';
      bottom = code === 2 ? '#111827' : '#0f172a';
      glowBg = ''; glowOp = '0';
    } else if (code === 45 || code === 48) {
      top = '#111820'; bottom = '#0d1520';
      glowBg = ''; glowOp = '0';
    } else if (code >= 71 && code <= 77) {
      top = '#101828'; bottom = '#1a2436';
      glowBg = ''; glowOp = '0';
    } else if (code >= 95 && code <= 99) {
      top = '#0c0a1e'; bottom = '#120824';
      glowBg = 'radial-gradient(circle, rgba(139,92,246,0.08), transparent)';
      glowOp = '1';
    } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
      top = '#0a1525'; bottom = '#060f1a';
      glowBg = 'radial-gradient(circle, rgba(14,116,144,0.07), transparent)';
      glowOp = '1';
    } else {
      // Default: rain-like for unknown codes
      top = '#0a1525'; bottom = '#060f1a';
      glowBg = ''; glowOp = '0';
    }

    document.body.style.setProperty('--weather-top', top);
    document.body.style.setProperty('--weather-bottom', bottom);
    el.bgGlow.style.background = glowBg;
    el.bgGlow.style.opacity = glowOp;
  }

  // --- Main render orchestrator ---

  function render(weather, location) {
    const current = weather.current;
    const minutelySlots = processMinutely(weather.minutely_15);
    const hourlySlots = processHourly(weather.hourly);

    const dailySlots = processDaily(weather.daily);

    renderCurrent(current, location);
    renderFeelsTrend(current, hourlySlots);
    renderSparkline(hourlySlots);
    renderRainSummary(minutelySlots);
    renderStatsBar(current);
    renderPrecipIndicator(minutelySlots);
    renderNowTab(minutelySlots);
    renderBriefing(dailySlots, hourlySlots, activeAlerts, minutelySlots);
    render15MinTab(minutelySlots);
    renderHourlyTab(hourlySlots);
    renderDaily(dailySlots, hourlySlots);
    renderAlerts(activeAlerts);
    applyWeatherBackground(current.weather_code, dailySlots);

    el.loading.classList.add('hidden');
    el.error.classList.add('hidden');
    el.weatherContent.classList.remove('hidden');

    // Update last-updated timestamp
    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

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
      { headers: { 'User-Agent': 'WXNOW/1.0 (wxnow.app)', 'Accept': 'application/geo+json' } }
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

  function renderAlerts(alerts) {
    clearEl(el.alertsContainer);
    if (!alerts || alerts.length === 0) {
      el.alertsContainer.classList.add('hidden');
      document.title = 'WXNOW';
      return;
    }
    el.alertsContainer.classList.remove('hidden');

    const sevStyles = {
      Extreme: { bg: '#7f1d1d', text: '#fca5a5', border: '#ef4444' },
      Severe:  { bg: '#7c2d12', text: '#fdba74', border: '#f97316' },
      Moderate:{ bg: '#713f12', text: '#fde68a', border: '#eab308' },
    };
    const defaultStyle = { bg: '#1e293b', text: '#94a3b8', border: '#475569' };

    alerts.forEach((a) => {
      const s = sevStyles[a.severity] || defaultStyle;
      const card = document.createElement('div');
      card.className = 'alert-card';
      card.style.borderLeftColor = s.border;

      const badge = document.createElement('span');
      badge.className = 'alert-badge';
      badge.textContent = a.severity;
      badge.style.background = s.bg;
      badge.style.color = s.text;

      const event = document.createElement('div');
      event.className = 'alert-event';
      event.textContent = a.event;

      const headline = document.createElement('div');
      headline.className = 'alert-headline';
      headline.textContent = a.headline || '';

      const expires = document.createElement('div');
      expires.className = 'alert-expires';
      expires.textContent = `Expires ${formatTime(a.expires)}`;

      card.appendChild(badge);
      card.appendChild(event);
      card.appendChild(headline);
      card.appendChild(expires);

      if (a.instruction) {
        const toggle = document.createElement('button');
        toggle.className = 'alert-toggle';
        toggle.textContent = '▸ Details';
        toggle.dataset.action = 'toggle-alert';

        const instruction = document.createElement('div');
        instruction.className = 'alert-instruction';
        instruction.textContent = a.instruction;

        card.appendChild(toggle);
        card.appendChild(instruction);
      }

      el.alertsContainer.appendChild(card);
    });

    const severe = alerts.find(a => a.severity === 'Extreme' || a.severity === 'Severe');
    document.title = severe ? `⚠ WXNOW — ${severe.event}` : 'WXNOW';
  }

  el.alertsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="toggle-alert"]');
    if (!btn) return;
    const card = btn.closest('.alert-card');
    card.classList.toggle('expanded');
    btn.textContent = card.classList.contains('expanded') ? '▾ Details' : '▸ Details';
  });

  // --- Load ---

  const debouncedFetch = debounce(async (lat, lon, overrideLocation) => {
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
    } catch {
      if (myFetchId === fetchId) showError('Failed to load weather data. Tap to retry.', true);
    }
  }, 300);

  async function load() {
    el.loading.textContent = '\u25CC';
    el.loading.classList.remove('hidden');
    el.error.classList.add('hidden');
    el.weatherContent.classList.add('hidden');

    if (!navigator.onLine) {
      showError('You appear to be offline. Tap to retry when connected.', true);
      return;
    }

    try {
      const pos = await getPosition();
      savedLat = pos.coords.latitude;
      savedLon = pos.coords.longitude;
      debouncedFetch(savedLat, savedLon);
    } catch (err) {
      if (err.code === 1) {
        showError('Location access denied. Please enable location services in your device settings.', false);
      } else if (err.code === 3) {
        showError('Location request timed out. Tap to retry.', true);
      } else {
        showError(`Location error: ${err.message}. Tap to retry.`, true);
      }
    }
  }

  el.btnRefresh.addEventListener('click', () => {
    if (savedLat !== null && savedLon !== null) {
      el.loading.textContent = '\u25CC';
      el.loading.classList.remove('hidden');
      el.weatherContent.classList.add('hidden');
      debouncedFetch(savedLat, savedLon);
    } else {
      load();
    }
  });

  load();

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
  });

  // Share button
  el.btnShare.addEventListener('click', async () => {
    if (!lastWeather) return;
    const text = generateShareText(lastWeather, lastLocation, activeAlerts);
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      el.btnShare.textContent = '✓';
      setTimeout(() => { el.btnShare.textContent = '↑'; }, 2000);
    } catch {
      // User cancelled share or clipboard failed — ignore silently
      try {
        await navigator.clipboard.writeText(text);
        el.btnShare.textContent = '✓';
        setTimeout(() => { el.btnShare.textContent = '↑'; }, 2000);
      } catch { /* no-op */ }
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
    el.searchInput.value = '';
    el.btnSearchClear.classList.add('hidden');
    hideSearchResults();
    el.loading.textContent = '\u25CC';
    el.loading.classList.remove('hidden');
    el.weatherContent.classList.add('hidden');
    getPosition().then(pos => {
      savedLat = pos.coords.latitude;
      savedLon = pos.coords.longitude;
      debouncedFetch(savedLat, savedLon);
    }).catch(() => {
      // GPS denied — just re-render with existing data if available
      if (lastWeather) {
        el.loading.classList.add('hidden');
        el.weatherContent.classList.remove('hidden');
      } else {
        showError('Location access denied.', false);
      }
    });
  }

  el.searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
      hideSearchResults();
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

        // GPS restore option
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
              el.searchInput.value = locName;
              el.btnSearchClear.classList.remove('hidden');
              hideSearchResults();
              el.loading.textContent = '\u25CC';
              el.loading.classList.remove('hidden');
              el.weatherContent.classList.add('hidden');
              debouncedFetch(savedLat, savedLon, locName);
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

  el.btnSearchClear.addEventListener('click', restoreGps);

  // Close search results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-bar')) {
      hideSearchResults();
    }
  });
})();
