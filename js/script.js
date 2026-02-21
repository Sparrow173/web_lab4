const API_KEY = "fee902e19f17edb9f907e50f854fb759";

const statusEl = document.getElementById("status");
const forecastEl = document.getElementById("forecast");

const controlsEl = document.getElementById("controls");
const locationTitleEl = document.getElementById("locationTitle");

let mainForecast = null;
let mainForecastTitle = "Ваше текущее местоположение";

let mainSource = null;

let mainStatus = "idle";
let mainErrorText = "";

const extraCityOrder = []; // хранит порядок добавления (ключи)
const extraCityMap = new Map(); // key -> { name, status, forecast, error }

const mainControlsEl = document.getElementById("mainControls");
const extraCityFormEl = document.getElementById("extraCityForm");
const extraCityInputEl = document.getElementById("extraCityInput");
const extraCityListEl = document.getElementById("extraCityList");

const refreshBtnEl = document.getElementById("refreshBtn");

let isRefreshing = false;

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!API_KEY || API_KEY === "PASTE_YOUR_API_KEY_HERE") {
    setStatus("Нужно указать API ключ в app.js");
    showMessage("Вставьте API_KEY и перезагрузите страницу.", true);
    return;
  }

  initExtraCitiesControls();

  initRefreshControl();

  setStatus("Запрашиваем геолокацию…");
  showMessage("Загрузка…");

  requestGeolocation();
}

function initRefreshControl() {
  if (!refreshBtnEl) return;
  refreshBtnEl.addEventListener("click", onRefreshClick);
}

function onRefreshClick() {
  refreshAllForecasts();
}

async function refreshAllForecasts() {
  if (isRefreshing) return;

  isRefreshing = true;
  if (refreshBtnEl) refreshBtnEl.disabled = true;

  setStatus("Обновляем прогноз…");

  await Promise.allSettled([
    refreshMainForecast(),
    refreshExtraCitiesForecasts(),
  ]);

  updateForecastView();

  // Статус по завершению
  setStatus("Обновление завершено");

  isRefreshing = false;
  if (refreshBtnEl) refreshBtnEl.disabled = false;
}

// ГЕОЛОКАЦИЯ
function requestGeolocation() {
  if (!navigator.geolocation) {
    setStatus("Геолокация недоступна");
    showMessage("Геолокация не поддерживается браузером.", true);

    // Фоллбек на ввод города
    showCityForm();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;

      clearControls();
      if (locationTitleEl)
        locationTitleEl.textContent = "Ваше текущее местоположение";

      setStatus("Получаем прогноз погоды…");

      try {
        const data = await fetchForecastByCoords(latitude, longitude);
        const forecast = normalizeTo3Days(data);

        mainSource = { type: "coords", lat: latitude, lon: longitude };

        mainForecast = forecast;
        mainForecastTitle =
          locationTitleEl?.textContent || "Текущее местоположение";

        mainStatus = "ready";
        mainErrorText = "";

        setStatus("Погода успешно получена");

        updateForecastView();
      } catch (err) {
        mainStatus = "error";
        mainErrorText =
          "Не удалось загрузить прогноз. Проверьте сеть и API_KEY.";

        setStatus("Ошибка");
        showMessage(mainErrorText, true);
      }
    },

    // ERROR: пользователь отклонил доступ (или таймаут/ошибка)
    () => {
      setStatus("Доступ отклонён");
      showMessage("Доступ к геопозиции отклонён. Введите город вручную.", true);

      // показать форму ввода города
      showCityForm();
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
  );
}

// ФОРМА ГОРОДА
function showCityForm() {
  if (!mainControlsEl && !controlsEl) return;

  if (locationTitleEl) locationTitleEl.textContent = "Выбранный город";

  const host = mainControlsEl || controlsEl;

  host.innerHTML = `
    <form id="cityForm" autocomplete="off">
      <label>
        Город:
        <input
          class="input"
          id="cityInput"
          name="city"
          type="text"
          placeholder="Например: Берлин"
          required
        />
      </label>
      <button class="btn" id="citySubmit" type="submit">Показать прогноз</button>
    </form>
  `;

  const form = document.getElementById("cityForm");
  form.addEventListener("submit", onCitySubmit);
}

function clearControls() {
  if (mainControlsEl) {
    mainControlsEl.innerHTML = "";
    return;
  }

  if (!controlsEl) return;
  controlsEl.innerHTML = "";
}

async function onCitySubmit(e) {
  e.preventDefault();

  const input = document.getElementById("cityInput");
  const button = document.getElementById("citySubmit");

  const city = (input?.value || "").trim();

  if (!city) {
    setStatus("Ошибка");
    showMessage("Введите название города.", true);
    return;
  }

  if (input) input.disabled = true;
  if (button) button.disabled = true;

  setStatus("Получаем прогноз погоды…");
  showMessage("Загрузка…");

  try {
    const data = await fetchForecastByCity(city);
    const forecast = normalizeTo3Days(data);

    mainSource = { type: "city", city };

    mainForecast = forecast;
    mainForecastTitle = locationTitleEl?.textContent || "Выбранный город";

    mainStatus = "ready";
    mainErrorText = "";

    setStatus("Погода успешно получена");

    updateForecastView();
  } catch (err) {
    const msg = err?.message || "Не удалось загрузить прогноз.";

    mainStatus = "error";
    mainErrorText = msg;

    setStatus("Ошибка");
    showMessage(msg, true);
  } finally {
    if (input) input.disabled = false;
    if (button) button.disabled = false;
  }
}

async function refreshMainForecast() {
  if (!mainSource) return;

  mainStatus = "loading";
  mainErrorText = "";
  updateForecastView();

  try {
    let data;

    if (mainSource.type === "coords") {
      data = await fetchForecastByCoords(mainSource.lat, mainSource.lon);
    } else {
      data = await fetchForecastByCity(mainSource.city);
    }

    const forecast = normalizeTo3Days(data);

    mainForecast = forecast;
    mainStatus = "ready";
    mainErrorText = "";
  } catch (err) {
    mainStatus = "error";
    mainErrorText = err?.message || "Не удалось обновить основной прогноз.";
  }
}

// ДОПОЛНИТЕЛЬНЫЕ ГОРОДА
function initExtraCitiesControls() {
  if (extraCityFormEl) {
    extraCityFormEl.addEventListener("submit", onExtraCitySubmit);
  }

  if (extraCityListEl) {
    extraCityListEl.addEventListener("click", onExtraCityListClick);
  }

  renderExtraCityList();
}

async function onExtraCitySubmit(e) {
  e.preventDefault();

  if (!extraCityInputEl) return;

  const rawName = (extraCityInputEl.value || "").trim();
  if (!rawName) {
    setStatus("Ошибка");
    showMessage("Введите название города для добавления.", true);
    return;
  }

  const key = normalizeCityKey(rawName);

  if (extraCityMap.has(key)) {
    setStatus("Ошибка");
    showMessage("Этот город уже добавлен.", true);
    return;
  }

  extraCityOrder.push(key);
  extraCityMap.set(key, {
    name: rawName,
    status: "loading",
    forecast: null,
    error: "",
  });

  extraCityInputEl.value = "";

  renderExtraCityList();

  updateForecastView();

  try {
    const data = await fetchForecastByCity(rawName);
    const forecast = normalizeTo3Days(data);

    const entry = extraCityMap.get(key);
    if (entry) {
      entry.status = "ready";
      entry.forecast = forecast;
      entry.error = "";
    }

    setStatus("Погода успешно получена");
  } catch (err) {
    const entry = extraCityMap.get(key);
    if (entry) {
      entry.status = "error";
      entry.forecast = null;
      entry.error = err?.message || "Не удалось загрузить прогноз.";
    }

    setStatus("Ошибка");
  } finally {
    updateForecastView();
  }
}

function onExtraCityListClick(e) {
  const btn = e.target?.closest?.("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const encodedKey = btn.getAttribute("data-city-key") || "";
  const key = decodeURIComponent(encodedKey);

  if (!key) return;

  if (action === "remove") {
    extraCityMap.delete(key);

    const idx = extraCityOrder.indexOf(key);
    if (idx >= 0) extraCityOrder.splice(idx, 1);

    renderExtraCityList();
    updateForecastView();
  }
}

function renderExtraCityList() {
  if (!extraCityListEl) return;

  if (!extraCityOrder.length) {
    extraCityListEl.innerHTML = `<li class="muted">Пока нет добавленных городов</li>`;
    return;
  }

  extraCityListEl.innerHTML = extraCityOrder
    .map((key) => {
      const entry = extraCityMap.get(key);
      const name = entry?.name || key;

      return `
        <li class="extra-city-item">
          <span class="extra-city-name">${escapeHtml(name)}</span>
          <button
            class="btn btn--sm"
            type="button"
            data-action="remove"
            data-city-key="${encodeURIComponent(key)}"
          >
            Удалить
          </button>
        </li>
      `;
    })
    .join("");
}

function normalizeCityKey(name) {
  return String(name).trim().toLowerCase();
}

async function refreshExtraCitiesForecasts() {
  if (!extraCityOrder.length) return;

  for (const key of extraCityOrder) {
    const entry = extraCityMap.get(key);
    if (entry) {
      entry.status = "loading";
      entry.error = "";
    }
  }

  updateForecastView();

  const tasks = extraCityOrder.map(async (key) => {
    const entry = extraCityMap.get(key);
    if (!entry) return;

    try {
      const data = await fetchForecastByCity(entry.name);
      const forecast = normalizeTo3Days(data);

      entry.status = "ready";
      entry.forecast = forecast;
      entry.error = "";
    } catch (err) {
      entry.status = "error";
      entry.forecast = null;
      entry.error = err?.message || "Не удалось обновить прогноз.";
    }
  });

  await Promise.allSettled(tasks);
}

// ЗАПРОС В OPENWEATHER
async function fetchForecastByCoords(lat, lon) {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", API_KEY);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "ru");

  console.log("forecast url:", url.toString());

  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error("Запрос прогноза не удался: " + res.status);
  }

  return await res.json();
}

async function fetchForecastByCity(city) {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("q", city);
  url.searchParams.set("appid", API_KEY);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "ru");

  const res = await fetch(url.toString());

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Город не найден. Проверьте написание.");
    }
    throw new Error("Запрос прогноза не удался: " + res.status);
  }

  return await res.json();
}


function normalizeTo3Days(apiData) {
  const tz = apiData.city?.timezone ?? 0;

  const list = apiData.list || [];

  const byDay = new Map();

  for (const item of list) {
    const dt = item.dt;

    const { dateKey, hour } = cityLocal(dt, tz);

    // Создать массив для дня, если его ещё нет
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);

    // Положить точку в соответствующий день
    byDay.get(dateKey).push({ item, hour });
  }

  // Определить "сегодня" по локальному времени города
  const nowSec = Math.floor(Date.now() / 1000);
  const todayKey = cityLocal(nowSec, tz).dateKey;

  // Взять все даты и отсортировать
  const keys = Array.from(byDay.keys()).sort();

  // Найти индекс "сегодня"
  let startIdx = keys.indexOf(todayKey);

  if (startIdx < 0) startIdx = 0;

  // Взять 3 дня: сегодня + 2
  const wantedKeys = keys.slice(startIdx, startIdx + 3);

  // Для каждого дня посчитать min/max и выбрать "главную" точку (примерно 12:00)
  const days = wantedKeys.map((k) => summarizeDay(k, byDay.get(k)));

  return { days };
}

function summarizeDay(dateKey, entries) {
  entries = entries || [];
  if (!entries.length) {
    return { dateKey, tempMin: null, tempMax: null, icon: "01d", desc: "—" };
  }

  let min = Infinity;
  let max = -Infinity;

  // Взять точку ближе всего к 12:00, чтобы использовать её описание/иконку
  let best = entries[0].item;
  let bestDist = Infinity;

  for (const e of entries) {
    // Температура в точке
    const temp = e.item.main?.temp;

    // min/max за день
    if (typeof temp === "number") {
      if (temp < min) min = temp;
      if (temp > max) max = temp;
    }

    // Насколько точка близка к 12:00
    const dist = Math.abs((e.hour ?? 12) - 12);

    if (dist < bestDist) {
      bestDist = dist;
      best = e.item;
    }
  }

  // взять описание и иконку из "лучшей" точки
  const w = best?.weather?.[0] || {};

  return {
    dateKey,
    tempMin: Number.isFinite(min) ? min : null,
    tempMax: Number.isFinite(max) ? max : null,
    icon: w.icon || "01d",
    desc: w.description || "—",
  };
}

// РАБОТА С ВРЕМЕНЕМ ГОРОДА
// Переводим время точки прогноза в локальную дату города:
function cityLocal(dtSec, tzSec) {
  const date = new Date((dtSec + tzSec) * 1000);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = date.getUTCHours();

  return { dateKey: `${year}-${month}-${day}`, hour };
}

// ОТОБРАЖЕНИЕ
function updateForecastView() {
  // Отобразить общий прогноз: основной + дополнительные города
  const groups = [];

  // Добавить поддержку состояния основного блока (loading/error)
  if (mainSource) {
    if (mainStatus === "loading") {
      groups.push(renderGroupMessage(mainForecastTitle, "Загрузка…", false));
    } else if (mainStatus === "error") {
      groups.push(
        renderGroupMessage(mainForecastTitle, mainErrorText || "Ошибка", true),
      );
    } else if (mainForecast?.days?.length) {
      groups.push(renderForecastGroup(mainForecastTitle, mainForecast));
    }
  } else {
    // Если источника ещё нет, но есть прогноз (на всякий случай)
    if (mainForecast?.days?.length) {
      groups.push(renderForecastGroup(mainForecastTitle, mainForecast));
    }
  }

  for (const key of extraCityOrder) {
    const entry = extraCityMap.get(key);
    const title = entry?.name || key;

    if (!entry || entry.status === "loading") {
      groups.push(renderGroupMessage(title, "Загрузка…", false));
      continue;
    }

    if (entry.status === "error") {
      groups.push(
        renderGroupMessage(title, entry.error || "Ошибка загрузки", true),
      );
      continue;
    }

    groups.push(renderForecastGroup(title, entry.forecast));
  }

  // Если вообще нечего показывать — оставить текущий контент
  if (!groups.length) return;

  forecastEl.innerHTML = groups.join("");
}

function renderForecastGroup(title, forecast) {
  if (!forecast?.days?.length) {
    return renderGroupMessage(title, "Нет данных прогноза.", true);
  }

  const cardsHtml = forecast.days
    .map((dayForecast) => {
      const dateLabel = formatDateKey(dayForecast.dateKey);

      // округляем температуру
      const tempMin =
        dayForecast.tempMin == null ? "—" : Math.round(dayForecast.tempMin);
      const tempMax =
        dayForecast.tempMax == null ? "—" : Math.round(dayForecast.tempMax);

      // URL иконки OpenWeather
      const iconCode = dayForecast.icon;
      const iconUrl = `https://openweathermap.org/img/wn/${encodeURIComponent(iconCode)}@2x.png`;

      const descText = dayForecast.desc;

      return `
        <article class="card">
          <div class="card__top">
            <p class="card__date">${escapeHtml(dateLabel)}</p>
            <img class="card__icon" src="${iconUrl}" alt="" />
          </div>
          <p class="card__temp">${tempMin}…${tempMax}°C</p>
          <p class="card__desc">${escapeHtml(descText)}</p>
        </article>
      `;
    })
    .join("");

  return `
    <section class="forecast-group">
      <h3 class="forecast-group__title">${escapeHtml(title)}</h3>
      <div class="forecast-group__cards">
        ${cardsHtml}
      </div>
    </section>
  `;
}

function renderGroupMessage(title, text, isError) {
  // Отобразить сообщение внутри конкретного блока города
  return `
    <section class="forecast-group">
      <h3 class="forecast-group__title">${escapeHtml(title)}</h3>
      <div class="msg ${isError ? "msg--error" : ""}">
        ${escapeHtml(text)}
      </div>
    </section>
  `;
}

function showMessage(text, isError = false) {
  // Универсальная заглушка (loading / ошибка / информация)
  forecastEl.innerHTML = `
    <div class="msg ${isError ? "msg--error" : ""}">
      ${escapeHtml(text)}
    </div>
  `;
}

function setStatus(text) {
  // Статус в шапке страницы
  statusEl.textContent = text;
}

function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);

  const monthNames = [
    "янв",
    "фев",
    "мар",
    "апр",
    "май",
    "июн",
    "июл",
    "авг",
    "сен",
    "окт",
    "ноя",
    "дек",
  ];

  const weekDayNames = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  // День недели считаем по UTC
  const weekDayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekDay = weekDayNames[weekDayIndex];

  return `${weekDay}, ${String(day).padStart(2, "0")} ${monthNames[month - 1]}`;
}

function escapeHtml(text) {
  // Защита от вставки нежелательного HTML при innerHTML
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}