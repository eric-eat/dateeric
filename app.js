import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { APP_CONFIG } from "./config.js";
import { PROFILES } from "./profiles.js";

const MAX_VISIBLE_CARDS = 3;
const SWIPE_X_THRESHOLD = 110;
const SUPER_LIKE_Y_THRESHOLD = -130;
const GESTURE_SWIPE_ANIMATION_MS = 320;
const BUTTON_SWIPE_ANIMATION_MS = 520;
const STATS_STORAGE_KEY = "meSwipeStats:v1";
const SESSION_STORAGE_KEY = "meSwipeSessionId:v1";
const IG_SUBMIT_COOLDOWN_MS = 30_000;
const MIN_PAGE_AGE_FOR_SUBMIT_MS = 3_000;
const INVALID_MESSAGE_SENTINEL = "__INVALID_MESSAGE__";
const REFERRAL_QUERY_PARAM = "ref";

const deckEl = document.querySelector("#deck");
const emptyStateEl = document.querySelector("#emptyState");
const restartDeckBtn = document.querySelector("#restartDeckBtn");
const backendStatusEl = document.querySelector("#backendStatus");

const statLikesEl = document.querySelector("#statLikes");
const statNopesEl = document.querySelector("#statNopes");
const statSupersEl = document.querySelector("#statSupers");
const statIgSubmissionsEl = document.querySelector("#statIgSubmissions");

const instagramForm = document.querySelector("#instagramForm");
const instagramHandleInput = document.querySelector("#instagramHandle");
const messageInput = document.querySelector("#message");
const consentInput = document.querySelector("#consent");
const honeypotInput = document.querySelector("#websiteField");
const submitInstagramBtn = document.querySelector("#submitInstagramBtn");
const formMessageEl = document.querySelector("#formMessage");
const referralModalEl = document.querySelector("#referralModal");
const referralModalMessageEl = document.querySelector("#referralModalMessage");
const closeReferralModalBtn = document.querySelector("#closeReferralModalBtn");

const swipeButtons = document.querySelectorAll("[data-action]");

const state = {
  currentIndex: 0,
  drag: null,
  isAnimatingSwipe: false,
  sessionId: getOrCreateSessionId(),
  loadedAtMs: Date.now(),
  lastInstagramSubmitAtMs: 0,
  referralCode: getReferralCodeFromUrl(),
  isReferralModalOpen: false,
  stats: loadStats(),
  supabaseClient: null,
};

init();

function init() {
  state.supabaseClient = initSupabaseClient();
  attachButtonHandlers();
  attachKeyboardShortcuts();
  attachReferralModalHandlers();
  attachFormHandler();
  restartDeckBtn.addEventListener("click", restartDeck);
  maybeShowReferralModal();
  renderStats();
  renderDeck();
}

function initSupabaseClient() {
  const { supabaseUrl, supabaseAnonKey } = APP_CONFIG;
  if (!supabaseUrl || !supabaseAnonKey) {
    setBackendStatus("Backend status: local mode (set Supabase config in config.js)");
    return null;
  }

  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    setBackendStatus("Backend status: connected to Supabase");
    return client;
  } catch (error) {
    console.error("Failed to initialize Supabase client.", error);
    setBackendStatus("Backend status: local mode (Supabase init failed)");
    return null;
  }
}

function attachButtonHandlers() {
  swipeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const { action } = button.dataset;
      if (!action) {
        return;
      }
      triggerSwipe(action, "button");
    });
  });
}

function attachKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (state.isReferralModalOpen) {
      if (event.key === "Escape") {
        hideReferralModal();
      }
      return;
    }
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    if (event.key === "ArrowLeft") {
      triggerSwipe("nope", "keyboard");
    } else if (event.key === "ArrowRight") {
      triggerSwipe("like", "keyboard");
    } else if (event.key === "ArrowUp") {
      triggerSwipe("super_like", "keyboard");
    }
  });
}

function attachReferralModalHandlers() {
  if (!referralModalEl || !closeReferralModalBtn) {
    return;
  }
  closeReferralModalBtn.addEventListener("click", hideReferralModal);
  referralModalEl.addEventListener("click", (event) => {
    if (event.target === referralModalEl) {
      hideReferralModal();
    }
  });
}

function maybeShowReferralModal() {
  if (!state.referralCode || !referralModalEl || !referralModalMessageEl) {
    return;
  }
  referralModalMessageEl.textContent = `You've been referred to DateEric by ${state.referralCode}.`;
  referralModalEl.classList.remove("hidden");
  document.body.classList.add("modal-open");
  state.isReferralModalOpen = true;
  if (closeReferralModalBtn) {
    window.setTimeout(() => {
      closeReferralModalBtn.focus();
    }, 0);
  }
}

function hideReferralModal() {
  if (!referralModalEl) {
    return;
  }
  referralModalEl.classList.add("hidden");
  document.body.classList.remove("modal-open");
  state.isReferralModalOpen = false;
}

function renderDeck() {
  deckEl.innerHTML = "";
  const remainingProfiles = PROFILES.slice(state.currentIndex);

  if (remainingProfiles.length === 0) {
    emptyStateEl.classList.remove("hidden");
    setControlsEnabled(false);
    return;
  }

  emptyStateEl.classList.add("hidden");
  setControlsEnabled(true);

  const visibleCards = remainingProfiles.slice(0, MAX_VISIBLE_CARDS);
  for (let idx = visibleCards.length - 1; idx >= 0; idx -= 1) {
    const profile = visibleCards[idx];
    const card = makeCard(profile, idx);
    deckEl.append(card);
  }

  const topCard = getTopCard();
  if (topCard) {
    topCard.addEventListener("pointerdown", handlePointerDown);
  }
}

function makeCard(profile, cardOffset) {
  const card = document.createElement("article");
  card.className = "swipe-card";
  card.style.setProperty("--card-offset", String(cardOffset));
  card.dataset.position = String(cardOffset);
  card.dataset.profileId = profile.id;
  card.dataset.profileName = profile.name;

  const img = document.createElement("img");
  img.src = profile.photo;
  img.alt = profile.name;
  img.draggable = false;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.src = createFallbackAvatar(profile.name);
  });

  const overlay = document.createElement("div");
  overlay.className = "card-overlay";

  const copy = document.createElement("div");
  copy.className = "card-copy";
  copy.innerHTML = `
    <h2>${escapeHtml(profile.name)}</h2>
    <p>${escapeHtml(profile.bio)}</p>
  `;

  const likeStamp = document.createElement("div");
  likeStamp.className = "stamp stamp-like";
  likeStamp.textContent = "Like";

  const nopeStamp = document.createElement("div");
  nopeStamp.className = "stamp stamp-nope";
  nopeStamp.textContent = "Nope";

  const superStamp = document.createElement("div");
  superStamp.className = "stamp stamp-super";
  superStamp.textContent = "Super";

  card.append(img, overlay, copy, likeStamp, nopeStamp, superStamp);
  return card;
}

function handlePointerDown(event) {
  if (!(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  if (event.button !== 0 || state.isAnimatingSwipe) {
    return;
  }

  const card = event.currentTarget;
  card.setPointerCapture(event.pointerId);
  card.classList.add("is-dragging");

  state.drag = {
    card,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    deltaX: 0,
    deltaY: 0,
  };

  card.addEventListener("pointermove", handlePointerMove);
  card.addEventListener("pointerup", handlePointerUp);
  card.addEventListener("pointercancel", handlePointerCancel);
}

function handlePointerMove(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }
  const { card, startX, startY } = state.drag;
  const deltaX = event.clientX - startX;
  const deltaY = event.clientY - startY;
  state.drag.deltaX = deltaX;
  state.drag.deltaY = deltaY;

  const rotateDeg = deltaX * 0.06;
  card.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotateDeg}deg)`;
  applyStampState(card, deltaX, deltaY);
}

function handlePointerUp(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }
  const { card, deltaX, deltaY } = state.drag;
  releaseDragListeners(card);

  let action = null;
  if (deltaY < SUPER_LIKE_Y_THRESHOLD && Math.abs(deltaX) < SWIPE_X_THRESHOLD) {
    action = "super_like";
  } else if (deltaX >= SWIPE_X_THRESHOLD) {
    action = "like";
  } else if (deltaX <= -SWIPE_X_THRESHOLD) {
    action = "nope";
  }

  if (action) {
    animateAndCommitSwipe(card, action, { deltaX, deltaY, source: "gesture" });
  } else {
    resetCardPosition(card);
  }

  state.drag = null;
}

function handlePointerCancel(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }
  const { card } = state.drag;
  releaseDragListeners(card);
  resetCardPosition(card);
  state.drag = null;
}

function releaseDragListeners(card) {
  card.classList.remove("is-dragging");
  card.removeEventListener("pointermove", handlePointerMove);
  card.removeEventListener("pointerup", handlePointerUp);
  card.removeEventListener("pointercancel", handlePointerCancel);
}

function applyStampState(card, deltaX, deltaY) {
  card.classList.remove("show-like", "show-nope", "show-super");
  if (deltaY < SUPER_LIKE_Y_THRESHOLD && Math.abs(deltaX) < SWIPE_X_THRESHOLD) {
    card.classList.add("show-super");
    return;
  }
  if (deltaX >= SWIPE_X_THRESHOLD / 2) {
    card.classList.add("show-like");
  } else if (deltaX <= -SWIPE_X_THRESHOLD / 2) {
    card.classList.add("show-nope");
  }
}

function resetCardPosition(card) {
  card.classList.remove("show-like", "show-nope", "show-super");
  card.style.transition = "transform 200ms ease";
  card.style.transform = "";
  window.setTimeout(() => {
    card.style.transition = "";
  }, 210);
}

function triggerSwipe(action, source = "button") {
  if (state.isAnimatingSwipe) {
    return;
  }
  const topCard = getTopCard();
  if (!topCard) {
    return;
  }

  const baseline = {
    deltaX: action === "like" ? SWIPE_X_THRESHOLD + 40 : action === "nope" ? -SWIPE_X_THRESHOLD - 40 : 0,
    deltaY: action === "super_like" ? SUPER_LIKE_Y_THRESHOLD - 30 : 0,
    source,
  };
  animateAndCommitSwipe(topCard, action, baseline);
}

function animateAndCommitSwipe(card, action, meta) {
  if (state.isAnimatingSwipe) {
    return;
  }
  state.isAnimatingSwipe = true;
  setControlsEnabled(false);

  card.classList.remove("show-like", "show-nope", "show-super");
  if (action === "like") {
    card.classList.add("show-like");
  } else if (action === "nope") {
    card.classList.add("show-nope");
  } else if (action === "super_like") {
    card.classList.add("show-super");
  }

  const outX = action === "like" ? window.innerWidth * 1.2 : action === "nope" ? -window.innerWidth * 1.2 : 0;
  const outY = action === "super_like" ? -window.innerHeight * 1.1 : meta.deltaY;
  const rotateDeg = action === "like" ? 24 : action === "nope" ? -24 : 0;
  const swipeDurationMs =
    meta?.source === "gesture" ? GESTURE_SWIPE_ANIMATION_MS : BUTTON_SWIPE_ANIMATION_MS;
  card.style.transition = `transform ${swipeDurationMs}ms cubic-bezier(0.2, 0.9, 0.28, 1)`;
  card.style.transform = `translate(${outX}px, ${outY}px) rotate(${rotateDeg}deg)`;

  const profileId = card.dataset.profileId;

  window.setTimeout(() => {
    state.currentIndex += 1;
    incrementStatsForSwipe(action);
    renderDeck();
    state.isAnimatingSwipe = false;
    if (profileId) {
      void trackSwipe(profileId, action, meta);
    }
  }, swipeDurationMs);
}

function restartDeck() {
  state.currentIndex = 0;
  renderDeck();
}

function getTopCard() {
  return deckEl.querySelector('.swipe-card[data-position="0"]');
}

function setControlsEnabled(enabled) {
  swipeButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function setBackendStatus(message) {
  backendStatusEl.textContent = message;
}

function loadStats() {
  const fallback = {
    likes: 0,
    nopes: 0,
    superLikes: 0,
    igSubmissions: 0,
  };
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return {
      likes: Number(parsed.likes) || 0,
      nopes: Number(parsed.nopes) || 0,
      superLikes: Number(parsed.superLikes) || 0,
      igSubmissions: Number(parsed.igSubmissions) || 0,
    };
  } catch (error) {
    console.warn("Failed to read local stats from storage.", error);
    return fallback;
  }
}

function saveStats() {
  localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(state.stats));
}

function incrementStatsForSwipe(action) {
  if (action === "like") {
    state.stats.likes += 1;
  } else if (action === "nope") {
    state.stats.nopes += 1;
  } else if (action === "super_like") {
    state.stats.superLikes += 1;
  }
  saveStats();
  renderStats();
}

function incrementIgSubmissionsStat() {
  state.stats.igSubmissions += 1;
  saveStats();
  renderStats();
}

function renderStats() {
  statLikesEl.textContent = String(state.stats.likes);
  statNopesEl.textContent = String(state.stats.nopes);
  statSupersEl.textContent = String(state.stats.superLikes);
  statIgSubmissionsEl.textContent = String(state.stats.igSubmissions);
}

async function trackSwipe(profileId, action, meta = {}) {
  if (!state.supabaseClient) {
    return;
  }

  const payload = {
    session_id: state.sessionId,
    profile_id: profileId,
    action,
    referral_code: state.referralCode,
    client_created_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    source_url: window.location.href,
    meta,
  };

  let { error } = await state.supabaseClient.from("swipe_events").insert(payload);
  if (error && isMissingReferralColumnError(error)) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.referral_code;
    ({ error } = await state.supabaseClient.from("swipe_events").insert(fallbackPayload));
  }
  if (error) {
    console.error("Failed to store swipe event.", error);
    setBackendStatus("Backend status: error writing swipe event (check SQL + RLS)");
  }
}

function attachFormHandler() {
  instagramForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormMessage();

    if (honeypotInput.value.trim() !== "") {
      setFormMessage("Submission rejected.", "error");
      return;
    }

    const now = Date.now();
    if (now - state.loadedAtMs < MIN_PAGE_AGE_FOR_SUBMIT_MS) {
      setFormMessage("Hold up for a second, then submit again.", "error");
      return;
    }
    if (now - state.lastInstagramSubmitAtMs < IG_SUBMIT_COOLDOWN_MS) {
      const waitSec = Math.ceil((IG_SUBMIT_COOLDOWN_MS - (now - state.lastInstagramSubmitAtMs)) / 1000);
      setFormMessage(`Please wait ${waitSec}s before another submit.`, "error");
      return;
    }

    const normalizedHandle = normalizeInstagramHandle(instagramHandleInput.value);
    if (!normalizedHandle) {
      setFormMessage("Enter a valid Instagram handle (letters, numbers, . and _).", "error");
      return;
    }

    const optionalMessage = cleanOptionalMessage(messageInput.value);
    if (optionalMessage === INVALID_MESSAGE_SENTINEL) {
      setFormMessage("Message is too long (max 500 characters).", "error");
      return;
    }

    if (!consentInput.checked) {
      setFormMessage("Consent is required before submitting.", "error");
      return;
    }

    submitInstagramBtn.disabled = true;
    try {
      await persistInstagramSubmission({
        instagram_handle: normalizedHandle,
        message: optionalMessage,
      });
      state.lastInstagramSubmitAtMs = Date.now();
      incrementIgSubmissionsStat();
      setFormMessage("Saved your handle. Message received.", "success");
      instagramForm.reset();
    } catch (error) {
      console.error("Failed to submit Instagram data.", error);
      setFormMessage("Could not save right now. Try again in a bit.", "error");
    } finally {
      submitInstagramBtn.disabled = false;
    }
  });
}

async function persistInstagramSubmission({ instagram_handle, message }) {
  if (!state.supabaseClient) {
    throw new Error("Supabase is not configured.");
  }

  const payload = {
    session_id: state.sessionId,
    instagram_handle,
    message,
    referral_code: state.referralCode,
    consent: true,
    user_agent: navigator.userAgent,
    source_url: window.location.href,
  };

  let { error } = await state.supabaseClient.from("instagram_submissions").insert(payload);
  if (error && isMissingReferralColumnError(error)) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.referral_code;
    ({ error } = await state.supabaseClient.from("instagram_submissions").insert(fallbackPayload));
  }
  if (error) {
    setBackendStatus("Backend status: error writing IG submission (check SQL + RLS)");
    throw error;
  }
}

function setFormMessage(text, tone) {
  formMessageEl.textContent = text;
  formMessageEl.classList.remove("success", "error");
  if (tone) {
    formMessageEl.classList.add(tone);
  }
}

function clearFormMessage() {
  setFormMessage("", "");
}

function normalizeInstagramHandle(rawValue) {
  const cleaned = rawValue.trim().replace(/^@+/, "").toLowerCase();
  if (!cleaned) {
    return "";
  }
  const valid = /^[a-z0-9._]{1,30}$/i.test(cleaned);
  return valid ? cleaned : "";
}

function cleanOptionalMessage(rawValue) {
  const value = rawValue.trim();
  if (value.length === 0) {
    return null;
  }
  if (value.length > 500) {
    return INVALID_MESSAGE_SENTINEL;
  }
  return value;
}

function getReferralCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeReferralCode(params.get(REFERRAL_QUERY_PARAM));
}

function normalizeReferralCode(rawValue) {
  if (!rawValue) {
    return null;
  }
  const normalized = rawValue.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return /^[a-z0-9._ -]{1,40}$/i.test(normalized) ? normalized : null;
}

function isMissingReferralColumnError(error) {
  const details = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();
  return details.includes("referral_code");
}

function getOrCreateSessionId() {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, generated);
  return generated;
}

function createFallbackAvatar(name) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 2) || "ME";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
      <defs>
        <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#312e81" />
          <stop offset="100%" stop-color="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="720" height="960" fill="url(#g)" />
      <text x="50%" y="54%" font-family="Inter, Arial, sans-serif" font-size="160" text-anchor="middle" fill="#e2e8f0" font-weight="700">${initials}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(rawValue) {
  return rawValue
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
