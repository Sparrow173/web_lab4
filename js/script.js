const API_KEY = "fee902e19f17edb9f907e50f854fb759";

const statusEl = document.getElementById("status");
const forecastEl = document.getElementById("forecast");

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!API_KEY || API_KEY === "PASTE_YOUR_API_KEY_HERE") {
    setStatus("Нужно указать API ключ в app.js");
    showMessage("Вставьте API_KEY и перезагрузите страницу.", true);
    return;
  }

  setStatus("Запрашиваем геолокацию…");
  showMessage("Загрузка…");

  requestGeolocation();
}

// ГЕОЛОКАЦИЯ
function requestGeolocation() {
  if (!navigator.geolocation) {
    setStatus("Ошибка");
    showMessage("Геолокация не поддерживается браузером.", true);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    // SUCCESS: пользователь разрешил доступ или координаты доступны
    async (pos) => {
      // Достаём координаты
      const { latitude, longitude } = pos.coords;

      setStatus("Получаем прогноз погоды…");

      try {
        // Запросить прогноз по координатам
        const data = await fetchForecast(latitude, longitude);

        // Превращаем прогноз из 3-часовых точек в "сегодня + 2 дня"
        const forecast = normalizeTo3Days(data);

        console.log(
          "OpenWeather city:",
          data.city?.name,
          data.city?.country,
          "tz:",
          data.city?.timezone,
        );
        console.log("Координаты:", latitude, longitude);

        // 3) Рендерим в интерфейсе
        setStatus("Погода успешно получена");
        renderForecast(forecast);
      } catch (err) {
        setStatus("Ошибка");
        showMessage(
          "Не удалось загрузить прогноз. Проверьте сеть и API_KEY.",
          true,
        );
      }
    },

    () => {
      setStatus("Доступ отклонён");
      showMessage("Доступ к геопозиции отклонён. Проверьте настройки ПК", true);
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
  );
}

// ==========================
// ЗАПРОС В OPENWEATHER
// ==========================
async function fetchForecast(lat, lon) {
  // Собирать URL корректно
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
function renderForecast(forecast) {
  // Если по какой-то причине дней нет — показать ошибку
  if (!forecast.days.length) {
    showMessage("Нет данных прогноза.", true);
    return;
  }

  // Рендер карточки дней в forecastEl
  forecastEl.innerHTML = forecast.days
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

  // День недели  по UTC
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
