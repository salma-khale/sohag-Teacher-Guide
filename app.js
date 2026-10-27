/**
 * app.js — Arabic Teacher Search Application
 * محافظة سوهاج — البحث عن المعلمين
 *
 * Architecture:
 *   1. loadTeacherData()     — fetch teachers.json, build normalised search index
 *   2. normalizeArabicText() — strip diacritics, unify alef variants, collapse spaces
 *   3. searchTeachers()      — case/variant-insensitive partial name search
 *   4. renderResults()       — display teacher cards or state messages
 *   5. showState()           — centralised state management (loading / success / error / etc.)
 *   6. Event wiring         — form submit (Enter) and button click → same handler
 *
 * Search triggers: ONLY pressing Enter or clicking the "بحث" button.
 * Typing alone never runs a search. Clearing resets to initial state.
 */

'use strict';

/* ============================================================
   Constants & DOM references
   ============================================================ */

const DATA_URL = 'teachers.json';

const formEl       = document.getElementById('search-form');
const inputEl      = document.getElementById('search-input');
const clearBtnEl   = document.getElementById('clear-btn');
const searchBtnEl  = document.getElementById('search-btn');
const resultsEl    = document.getElementById('results-container');
const announcerEl  = document.getElementById('sr-announcer');

/* ============================================================
   Application State
   ============================================================ */

/**
 * @typedef {Object} Teacher
 * @property {number} id
 * @property {string} name         — original Arabic name from PDF
 * @property {string} governorate  — always "سوهاج"
 * @property {string} specialty    — subject/specialty
 * @property {string} _normalized  — normalised search key (computed at load time)
 */

/** @type {Teacher[]} */
let teacherIndex = [];

/** @type {'idle' | 'loading' | 'ready' | 'error'} */
let dataState = 'idle';

/* ============================================================
   Arabic Text Normalisation
   ============================================================ */

/**
 * normalizeArabicText(text)
 *
 * Returns a normalised string suitable for matching but NOT for display.
 * Rules applied (in order):
 *  1. Trim whitespace.
 *  2. Collapse repeated internal spaces.
 *  3. Remove Arabic diacritics (tashkeel: fathah, dammah, kasrah, etc.).
 *  4. Remove tatweel (kashida) U+0640.
 *  5. Normalise alef variants → plain alef ا:
 *       أ U+0623, إ U+0625, آ U+0622, ٱ U+0671 → ا U+0627
 *  6. Normalise alef maqsura ى → ya ي (handles ى/ي in names like "على/علي").
 *  7. Normalise teh marbuta ة → ha ه (so "فاطمة" matches "فاطمه").
 *  8. Lowercase any Latin characters (for mixed data).
 *
 * The original name string is never modified.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeArabicText(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // 1. Trim
    .trim()
    // 2. Collapse spaces
    .replace(/\s+/g, ' ')
    // 3. Remove Arabic diacritics (U+0610–U+061A, U+064B–U+065F, U+0670)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '')
    // 4. Remove tatweel
    .replace(/\u0640/g, '')
    // 5. Unify alef variants → ا
    .replace(/[أإآٱ]/g, 'ا')
    // 6. Alef maqsura → ya
    .replace(/ى/g, 'ي')
    // 7. Teh marbuta → ha
    .replace(/ة/g, 'ه')
    // 8. Latin lowercase
    .toLowerCase();
}

/* ============================================================
   Data Loading
   ============================================================ */

/**
 * loadTeacherData()
 *
 * Fetches teachers.json, validates the response, builds the search
 * index (adding a _normalized field to each record), and transitions
 * the UI to the ready state.
 *
 * @returns {Promise<void>}
 */
async function loadTeacherData() {
  dataState = 'loading';
  showLoadingState();

  try {
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.teachers)) {
      throw new Error('تنسيق الملف غير صحيح: لم يتم العثور على مصفوفة "teachers".');
    }

    // Build the index — precompute normalised names once
    teacherIndex = data.teachers
      .filter(t => t && typeof t.name === 'string' && t.name.trim())
      .map(t => ({
        id:          t.id   ?? 0,
        name:        t.name.trim(),
        governorate: t.governorate ?? 'سوهاج',
        specialty:   t.specialty  ?? 'غير محدد',
        _normalized: normalizeArabicText(t.name),
      }));

    if (teacherIndex.length === 0) {
      throw new Error('الملف لا يحتوي على أي سجلات صالحة.');
    }

    dataState = 'ready';
    console.info(`[Teacher Search] Loaded ${teacherIndex.length} records.`);

    // Show the initial welcome state
    showInitialState();
    enableSearch();

  } catch (err) {
    dataState = 'error';
    console.error('[Teacher Search] Data load failed:', err);
    showDataErrorState(err.message);
    disableSearch();
  }
}

/* ============================================================
   Search Logic
   ============================================================ */

/**
 * searchTeachers(query)
 *
 * Searches the prebuilt index for records whose normalised name
 * contains the normalised query as a substring.
 *
 * Returns all matching records; does NOT limit to one result.
 *
 * @param {string} query — raw user input
 * @returns {Teacher[]}
 */
function searchTeachers(query) {
  const normalizedQuery = normalizeArabicText(query);
  if (!normalizedQuery) return [];

  return teacherIndex.filter(teacher =>
    teacher._normalized.includes(normalizedQuery)
  );
}

/* ============================================================
   UI State Management
   ============================================================ */

/**
 * showState(html)
 * Replace the results container content.
 * @param {string} html
 */
function showState(html) {
  resultsEl.innerHTML = html;
}

/** Announce a message to screen readers without changing visible content. */
function announce(message) {
  // Clear then set to force re-announcement even for identical text
  announcerEl.textContent = '';
  requestAnimationFrame(() => {
    announcerEl.textContent = message;
  });
}

/** Show loading spinner while data is being fetched. */
function showLoadingState() {
  showState(`
    <div class="state-message state-loading" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <div class="state-text">
        <p class="state-title">جارٍ تحميل البيانات…</p>
        <p class="state-body">يُرجى الانتظار لحظة.</p>
      </div>
    </div>
  `);
  announce('جارٍ تحميل البيانات.');
}

/** Show the welcome message before any search. */
function showInitialState() {
  showState(`
    <div class="state-message state-initial" role="status">
      <span class="state-icon" aria-hidden="true">👋</span>
      <div class="state-text">
        <p class="state-title">أهلاً بك!</p>
        <p class="state-body">
          اكتب اسم المعلم أو جزءاً منه ثم اضغط على زر <strong>بحث</strong>
          أو اضغط <strong>Enter</strong>.
        </p>
      </div>
    </div>
  `);
}

/** Show the empty / no-results state. */
function showEmptyState(query) {
  const safeQuery = escapeHtml(query);
  showState(`
    <div class="state-message state-empty" role="status" aria-live="polite">
      <span class="state-icon" aria-hidden="true">🔎</span>
      <div class="state-text">
        <p class="state-title">لم يتم العثور على نتائج</p>
        <p class="state-body">
          لا يوجد اسم مطابق لـ «<strong>${safeQuery}</strong>» في القائمة.<br />
          جرّب البحث بجزء من الاسم أو تأكد من الكتابة.
        </p>
      </div>
    </div>
  `);
  announce(`لا توجد نتائج للاسم: ${query}`);
}

/** Show validation warning for empty input. */
function showEmptyInputWarning() {
  showState(`
    <div class="state-message state-warning" role="alert">
      <span class="state-icon" aria-hidden="true">⚠️</span>
      <div class="state-text">
        <p class="state-title">الرجاء إدخال اسم</p>
        <p class="state-body">اكتب اسم المعلم في خانة البحث ثم اضغط بحث.</p>
      </div>
    </div>
  `);
  announce('الرجاء إدخال اسم المعلم قبل البحث.');
  inputEl.focus();
}

/** Show a critical error when teachers.json cannot be loaded. */
function showDataErrorState(technicalDetail) {
  showState(`
    <div class="state-message state-error" role="alert">
      <span class="state-icon" aria-hidden="true">❌</span>
      <div class="state-text">
        <p class="state-title">تعذّر تحميل البيانات</p>
        <p class="state-body">
          حدث خطأ أثناء تحميل قائمة المعلمين.
          تأكد من وجود ملف <code>teachers.json</code>
          في نفس مجلد التطبيق وأن الصفحة تعمل عبر خادم ويب
          (وليس مباشرةً من ملف محلي).
        </p>
      </div>
    </div>
  `);
  announce('تعذّر تحميل بيانات المعلمين. يرجى مراجعة المسؤول.');
}

/* ============================================================
   Result Rendering
   ============================================================ */

/**
 * renderResults(matches, query)
 *
 * Builds and injects the result list.
 * Uses structured HTML with safe text escaping (no innerHTML with raw data).
 *
 * @param {Teacher[]} matches
 * @param {string} query — original query string, for display
 */
function renderResults(matches, query) {
  const count = matches.length;
  const safeQuery = escapeHtml(query);

  const countLabel = count === 1
    ? `تم العثور على نتيجة واحدة`
    : `تم العثور على ${count} نتيجة`;

  // Count banner
  let html = `
    <div class="state-message state-success" role="status" aria-live="polite">
      <span class="state-icon" aria-hidden="true">✅</span>
      <div class="state-text">
        <p class="state-title">${escapeHtml(countLabel)}</p>
        <p class="state-body">نتائج البحث عن «<strong>${safeQuery}</strong>»</p>
      </div>
    </div>
    <ul class="teacher-grid" aria-label="قائمة المعلمين المطابقين">
  `;

  for (const teacher of matches) {
    html += buildTeacherCard(teacher);
  }

  html += '</ul>';
  showState(html);
  announce(`${countLabel} للبحث عن: ${query}`);
}

/**
 * buildTeacherCard(teacher)
 *
 * Returns the HTML string for one teacher card.
 * All data is safely escaped before insertion.
 *
 * @param {Teacher} teacher
 * @returns {string}
 */
function buildTeacherCard(teacher) {
  const id          = escapeHtml(String(teacher.id));
  const name        = escapeHtml(teacher.name);
  const specialty   = escapeHtml(teacher.specialty);
  const governorate = escapeHtml(teacher.governorate);

  return `
    <li class="teacher-card">
      <span class="card-num" aria-label="رقم السجل ${id}">${id}</span>
      <h2 class="card-name">${name}</h2>
      <div class="card-divider" aria-hidden="true"></div>
      <dl class="card-fields">
        <div class="card-field">
          <dt class="field-label">
            <span class="field-icon" aria-hidden="true">🏛️</span>
            المحافظة:
          </dt>
          <dd class="field-value">${governorate}</dd>
        </div>
        <div class="card-field">
          <dt class="field-label">
            <span class="field-icon" aria-hidden="true">📚</span>
            التخصص:
          </dt>
          <dd class="field-value">${specialty}</dd>
        </div>
      </dl>
    </li>
  `;
}

/* ============================================================
   Security: HTML Escaping
   ============================================================ */

/**
 * escapeHtml(str)
 *
 * Escapes special HTML characters to prevent XSS when inserting
 * PDF-extracted data into innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   Search Control: enable / disable
   ============================================================ */

function enableSearch() {
  searchBtnEl.disabled = false;
  inputEl.disabled = false;
}

function disableSearch() {
  searchBtnEl.disabled = true;
}

/* ============================================================
   Main Search Handler
   ============================================================ */

/**
 * handleSearch()
 *
 * Single entry point for all search submissions (Enter or button click).
 * Validates input, checks data readiness, runs search, renders results.
 */
function handleSearch() {
  if (dataState === 'loading') {
    announce('البيانات لا تزال تُحمَّل. يُرجى الانتظار.');
    return;
  }

  if (dataState === 'error') {
    showDataErrorState('');
    return;
  }

  const rawQuery = inputEl.value;
  const trimmedQuery = rawQuery.trim();

  if (!trimmedQuery) {
    showEmptyInputWarning();
    return;
  }

  const matches = searchTeachers(trimmedQuery);

  if (matches.length === 0) {
    showEmptyState(trimmedQuery);
  } else {
    renderResults(matches, trimmedQuery);
  }
}

/* ============================================================
   Reset Search
   ============================================================ */

/**
 * resetSearch()
 *
 * Clears the input, hides the clear button, and returns the UI
 * to the initial welcome state. Does NOT execute a search.
 */
function resetSearch() {
  inputEl.value = '';
  clearBtnEl.hidden = true;
  if (dataState === 'ready') {
    showInitialState();
    announce('تم مسح البحث.');
  }
  inputEl.focus();
}

/* ============================================================
   Event Listeners
   ============================================================ */

/**
 * Form submit — handles Enter key and button click.
 * preventDefault() stops the page from reloading.
 */
formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  handleSearch();
});

/**
 * Show / hide the clear button as the user types.
 * Does NOT trigger a search.
 */
inputEl.addEventListener('input', () => {
  const hasValue = inputEl.value.length > 0;
  clearBtnEl.hidden = !hasValue;
});

/**
 * Clear button — reset interface, no search.
 */
clearBtnEl.addEventListener('click', () => {
  resetSearch();
});

/**
 * Keyboard: Escape key clears and resets.
 */
inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    resetSearch();
  }
});

/* ============================================================
   Initialise
   ============================================================ */

// Start loading data as soon as the script runs
loadTeacherData();
