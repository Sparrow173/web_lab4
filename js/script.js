const API_KEY = "fee902e19f17edb9f907e50f854fb759";

// Добавить ключ для localStorage
const STORAGE_KEY = "weatherAppState_v1";

const statusEl = document.getElementById("status");
const forecastEl = document.getElementById("forecast");

const controlsEl = document.getElementById("controls");
const locationTitleEl = document.getElementById("locationTitle");

// Добавить состояние основного прогноза
let mainForecast = null;
let mainForecastTitle = "Ваше текущее местоположение";

// Добавить состояние источника основного прогноза (нужно для обновления)
let mainSource = null; // { type: "coords", lat, lon } | { type: "city", city }

// Добавить состояние статуса основного блока (нужно для "Загрузка..." при обновлении)
let mainStatus = "idle"; // "idle" | "loading" | "ready" | "error"
let mainErrorText = "";

// Добавить состояние дополнительных городов
const extraCityOrder = []; // хранит порядок добавления (ключи)
const extraCityMap = new Map(); // key -> { name, status, forecast, error }

// Добавить ссылки на элементы дополнительных городов
const mainControlsEl = document.getElementById("mainControls");
const extraCityFormEl = document.getElementById("extraCityForm");
const extraCityInputEl = document.getElementById("extraCityInput");
const extraCityListEl = document.getElementById("extraCityList");

// Добавить ссылку на кнопку обновления
const refreshBtnEl = document.getElementById("refreshBtn");

// Добавить флаг "идёт обновление"
let isRefreshing = false;

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!API_KEY || API_KEY === "PASTE_YOUR_API_KEY_HERE") {
    setStatus("Нужно указать API ключ в app.js");
    showMessage("Вставьте API_KEY и перезагрузите страницу.", true);
    return;
  }

  // Добавить загрузку состояния из localStorage
  const loaded = loadAppState();
  if (loaded) applyLoadedState(loaded);

  // Добавить инициализацию UI дополнительных городов
  initExtraCitiesControls();

  // Добавить инициализацию кнопки "Обновить"
  initRefreshControl();

  // Если есть сохранённый основной источник — сразу восстановить прогнозы
  if (mainSource) {
    clearControls();
    setMainTitleFromSource();

    setStatus("Восстанавливаем прогноз…");
    showMessage("Загрузка…");

    // Перевести основной блок в загрузку и отрисовать заглушки
    mainStatus = "loading";
    updateForecastView();

    Promise.allSettled([
      refreshMainForecast(),
      refreshExtraCitiesForecasts(),
    ]).then(() => {
      updateForecastView();

      // Вывести аккуратный статус после восстановления
      if (mainStatus === "error") {
        setStatus("Ошибка");
      } else {
        setStatus("Погода успешно получена");
      }

      // Добавить сохранение состояния после восстановления
      saveAppState();
    });

    return;
  }

  // Если основного источника нет, но есть доп. города — загрузить их (и параллельно запросить гео)
  if (extraCityOrder.length) {
    refreshExtraCitiesForecasts().then(() => updateForecastView());
  }

  setStatus("Запрашиваем геолокацию…");
  showMessage("Загрузка…");

  requestGeolocation();
}

// Добавить обработчик кнопки "Обновить"
function initRefreshControl() {
  if (!refreshBtnEl) return;
  refreshBtnEl.addEventListener("click", onRefreshClick);
}

function onRefreshClick() {
  // Запустить обновление прогнозов без перезагрузки страницы
  refreshAllForecasts();
}

async function refreshAllForecasts() {
  if (isRefreshing) return;

  isRefreshing = true;
  if (refreshBtnEl) refreshBtnEl.disabled = true;

  setStatus("Обновляем прогноз…");

  // Показать "Загрузка..." внутри основного блока и городов
  await Promise.allSettled([
    refreshMainForecast(),
    refreshExtraCitiesForecasts(),
  ]);

  // Отрисовать итоговое состояние после всех запросов
  updateForecastView();

  // Статус по завершению
  setStatus("Обновление завершено");

  // Добавить сохранение состояния после обновления
  saveAppState();

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

      // Для геолокации спрятаь форму города (если вдруг была показана)
      clearControls();
      if (locationTitleEl)
        locationTitleEl.textContent = "Ваше текущее местоположение";

      setStatus("Получаем прогноз погоды…");

      try {
        const data = await fetchForecastByCoords(latitude, longitude);
        const forecast = normalizeTo3Days(data);

        // Добавить сохранение источника основного прогноза (coords)
        mainSource = { type: "coords", lat: latitude, lon: longitude };

        // Добавить сохранение основного прогноза
        mainForecast = forecast;
        mainForecastTitle = "Ваше текущее местоположение";

        // Добавить статус готовности основного блока
        mainStatus = "ready";
        mainErrorText = "";

        setStatus("Погода успешно получена");

        // Добавить сохранение состояния после получения основного прогноза
        saveAppState();

        // Отобразить общий прогноз: основной + дополнительные города
        updateForecastView();
      } catch (err) {
        // Добавить статус ошибки основного блока
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

  // Добавить рендер формы основного города в отдельный контейнер
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
  // Изменить очистку: чистить только блок основного города (доп. города не трогать)
  if (mainControlsEl) {
    mainControlsEl.innerHTML = "";
    return;
  }

  // Фоллбек: если отдельного блока нет — очищаем весь controls
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

  // Добавить отображение выбранного города в заголовке локации
  if (locationTitleEl) locationTitleEl.textContent = `Город: ${city}`;

  // Добавить сохранение источника основного прогноза (city) до запроса
  mainSource = { type: "city", city };
  mainForecastTitle = `Город: ${city}`;
  saveAppState();

  // Блок формы на время запроса
  if (input) input.disabled = true;
  if (button) button.disabled = true;

  setStatus("Получаем прогноз погоды…");
  showMessage("Загрузка…");

  try {
    const data = await fetchForecastByCity(city);
    const forecast = normalizeTo3Days(data);

    // Добавить сохранение основного прогноза
    mainForecast = forecast;

    // Добавить статус готовности основного блока
    mainStatus = "ready";
    mainErrorText = "";

    setStatus("Погода успешно получена");

    // Добавить сохранение состояния после успешного получения прогноза
    saveAppState();

    // Отобразить общий прогноз: основной + дополнительные города
    updateForecastView();

    // Убрать форму после успешного выбора города
    clearControls();
  } catch (err) {
    // Если это "город не найден" — показать человеко-понятно
    const msg = err?.message || "Не удалось загрузить прогноз.";

    // Добавить статус ошибки основного блока
    mainStatus = "error";
    mainErrorText = msg;

    setStatus("Ошибка");
    showMessage(msg, true);
  } finally {
    if (input) input.disabled = false;
    if (button) button.disabled = false;
  }
}

// Добавить обновление основного прогноза по сохранённому источнику
async function refreshMainForecast() {
  // Если основного источника нет — ничего не обновляем
  if (!mainSource) return;

  mainStatus = "loading";
  mainErrorText = "";
  setMainTitleFromSource();
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
    // Добавить обработчик сабмита формы дополнительных городов
    extraCityFormEl.addEventListener("submit", onExtraCitySubmit);
  }

  if (extraCityListEl) {
    // Добавить обработчик кликов по списку (удаление)
    extraCityListEl.addEventListener("click", onExtraCityListClick);
  }

  // Отобразить текущий список (с учётом восстановления из localStorage)
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

  // Добавить защиту от дублей
  if (extraCityMap.has(key)) {
    setStatus("Ошибка");
    showMessage("Этот город уже добавлен.", true);
    return;
  }

  // Добавить город в состояние как "loading"
  extraCityOrder.push(key);
  extraCityMap.set(key, {
    name: rawName,
    status: "loading",
    forecast: null,
    error: "",
  });

  // Очистить поле ввода
  extraCityInputEl.value = "";

  // Отобразить список городов
  renderExtraCityList();

  // Добавить сохранение состояния после добавления города в список
  saveAppState();

  // Отобразить заглушку "Загрузка..." в прогнозе для нового города
  updateForecastView();

  try {
    // Получить прогноз для дополнительного города
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
    // Отобразить общий прогноз: основной + дополнительные города
    updateForecastView();

    // Добавить сохранение состояния после попытки загрузки (чтобы ошибка тоже восстановилась)
    saveAppState();
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
    // Удалить город из состояния
    extraCityMap.delete(key);

    const idx = extraCityOrder.indexOf(key);
    if (idx >= 0) extraCityOrder.splice(idx, 1);

    // Отобразить обновлённый список и прогноз
    renderExtraCityList();
    updateForecastView();

    // Добавить сохранение состояния после удаления города
    saveAppState();
  }
}

function renderExtraCityList() {
  if (!extraCityListEl) return;

  if (!extraCityOrder.length) {
    extraCityListEl.innerHTML = `<li class="muted">Пока нет добавленных городов</li>`;
    return;
  }

  // Отобразить список добавленных городов
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
  // Получить ключ города для сравнения (антидубли)
  return String(name).trim().toLowerCase();
}

// Добавить обновление всех дополнительных городов одним действием
async function refreshExtraCitiesForecasts() {
  if (!extraCityOrder.length) return;

  // Перевести все города в "loading"
  for (const key of extraCityOrder) {
    const entry = extraCityMap.get(key);
    if (entry) {
      entry.status = "loading";
      entry.error = "";
    }
  }

  updateForecastView();

  // Получить прогнозы параллельно
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

// LOCALSTORAGE
function buildState() {
  // Добавить формирование объекта состояния приложения
  return {
    mainSource,
    extraCities: extraCityOrder.map(
      (key) => extraCityMap.get(key)?.name || key,
    ),
  };
}

function saveAppState() {
  // Добавить сохранение состояния в localStorage
  try {
    const state = buildState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

function loadAppState() {
  // Получить состояние из localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;

    return data;
  } catch {
    return null;
  }
}

function applyLoadedState(state) {
  // Применить загруженное состояние к приложению
  const src = state.mainSource;

  if (src && typeof src === "object") {
    if (
      src.type === "coords" &&
      typeof src.lat === "number" &&
      typeof src.lon === "number"
    ) {
      mainSource = { type: "coords", lat: src.lat, lon: src.lon };
      mainForecastTitle = "Ваше текущее местоположение";
      mainStatus = "loading";
      mainErrorText = "";
    }

    if (
      src.type === "city" &&
      typeof src.city === "string" &&
      src.city.trim()
    ) {
      mainSource = { type: "city", city: src.city.trim() };
      mainForecastTitle = `Город: ${mainSource.city}`;
      mainStatus = "loading";
      mainErrorText = "";

      // Восстановить текст заголовка (чтобы было видно выбранный город)
      if (locationTitleEl) locationTitleEl.textContent = mainForecastTitle;
    }
  }

  const cities = state.extraCities;
  if (Array.isArray(cities)) {
    for (const name of cities) {
      if (typeof name !== "string") continue;

      const clean = name.trim();
      if (!clean) continue;

      const key = normalizeCityKey(clean);
      if (extraCityMap.has(key)) continue;

      extraCityOrder.push(key);
      extraCityMap.set(key, {
        name: clean,
        status: "loading",
        forecast: null,
        error: "",
      });
    }
  }

  setMainTitleFromSource();
}

function setMainTitleFromSource() {
  // Установить заголовок локации по текущему источнику
  if (!locationTitleEl) return;

  if (!mainSource) {
    locationTitleEl.textContent = "Ваше текущее местоположение";
    return;
  }

  if (mainSource.type === "coords") {
    locationTitleEl.textContent = "Ваше текущее местоположение";
    mainForecastTitle = "Ваше текущее местоположение";
    return;
  }

  locationTitleEl.textContent = `Город: ${mainSource.city}`;
  mainForecastTitle = `Город: ${mainSource.city}`;
}

// ЗАПРОС В OPENWEATHER
async function fetchForecastByCoords(lat, lon) {
  // Собрать URL корректно
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

//  НОРМАЛИЗАЦИЯ:
//  Берём прогноз 5 days/3 hours и превращаем в 3 дня:
//  сегодня + 2 следующих.
function normalizeTo3Days(apiData) {
  // timezone города в секундах
  const tz = apiData.city?.timezone ?? 0;

  // список 3-часовых прогнозов
  const list = apiData.list || [];

  // Группируем прогноз по локальной дате города
  const byDay = new Map();

  for (const item of list) {
    // item.dt — время точки в секундах UTC
    const dt = item.dt;

    // cityLocal возвращает локальную дату города + час
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
// Перевести время точки прогноза в локальную дату города:
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
    // Если источника ещё нет, но есть прогноз
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
  // Если дней нет — показать ошибку
  if (!forecast?.days?.length) {
    return renderGroupMessage(title, "Нет данных прогноза.", true);
  }

  const cardsHtml = forecast.days
    .map((dayForecast) => {
      const dateLabel = formatDateKey(dayForecast.dateKey);

      // округлить температуру
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

  // День недели по UTC
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
