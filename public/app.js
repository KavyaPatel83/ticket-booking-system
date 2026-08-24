// Ticket Booking System Client Application

const API_BASE = '/api';

// App State
let state = {
  userEmail: 'customer@example.com',
  userRole: 'Customer',
  events: [],
  selectedEventId: null,
  currentSeatData: null,
  selectedSeatIds: [],
  activeHoldTimerInterval: null,
  holdExpiresAt: null,
  activeOfferTimerIntervals: {}
};

// DOM Elements
const userEmailInput = document.getElementById('userEmailInput');
const userRoleSelect = document.getElementById('userRoleSelect');
const eventSelect = document.getElementById('eventSelect');
const refreshSeatMapBtn = document.getElementById('refreshSeatMapBtn');
const seatGridContainer = document.getElementById('seatGridContainer');

const checkoutPanel = document.getElementById('checkoutPanel');
const holdTimer = document.getElementById('holdTimer');
const selectedSeatsText = document.getElementById('selectedSeatsText');
const totalPriceText = document.getElementById('totalPriceText');
const confirmBookingBtn = document.getElementById('confirmBookingBtn');
const releaseHoldBtn = document.getElementById('releaseHoldBtn');

const waitlistBox = document.getElementById('waitlistBox');
const waitlistCategorySelect = document.getElementById('waitlistCategorySelect');
const joinWaitlistBtn = document.getElementById('joinWaitlistBtn');
const waitlistStatusText = document.getElementById('waitlistStatusText');

const alertBox = document.getElementById('alertBox');
const emailInboxBtn = document.getElementById('openInboxBtn');
const inboxModal = document.getElementById('inboxModal');
const closeInboxBtn = document.getElementById('closeInboxBtn');
const emailMessagesList = document.getElementById('emailMessagesList');
const emailCount = document.getElementById('emailCount');

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadEvents();
  loadInbox();

  // Auto-refresh seat map & inbox periodically (Real-time updates)
  setInterval(() => {
    if (state.selectedEventId) {
      loadSeatMap(state.selectedEventId, true);
    }
    loadInbox();
    if (document.getElementById('tab-my-bookings').classList.contains('active')) {
      loadCustomerDashboard();
    }
  }, 3000);
});

function setupEventListeners() {
  // User & Role Switching
  userEmailInput.addEventListener('change', (e) => {
    state.userEmail = e.target.value.trim() || 'customer@example.com';
    loadCustomerDashboard();
  });

  userRoleSelect.addEventListener('change', (e) => {
    state.userRole = e.target.value;
    updateRoleUI();
  });

  // Tab Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.id === 'openInboxBtn') return;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');

      if (tabId === 'tab-my-bookings') loadCustomerDashboard();
      if (tabId === 'tab-organiser') loadOrganiserSummary();
      if (tabId === 'tab-admin') loadVenuesList();
    });
  });

  // Event Selection
  eventSelect.addEventListener('change', (e) => {
    state.selectedEventId = e.target.value;
    state.selectedSeatIds = [];
    if (state.selectedEventId) {
      loadSeatMap(state.selectedEventId);
    } else {
      seatGridContainer.innerHTML = '<p class="text-muted">Select an event above to display the seat map.</p>';
      document.getElementById('eventDetailsCard').classList.add('hidden');
    }
  });

  refreshSeatMapBtn.addEventListener('click', () => {
    if (state.selectedEventId) loadSeatMap(state.selectedEventId);
  });

  // Hold & Booking Actions
  confirmBookingBtn.addEventListener('click', handleConfirmBooking);
  releaseHoldBtn.addEventListener('click', handleReleaseHold);
  joinWaitlistBtn.addEventListener('click', handleJoinWaitlist);

  // Admin & Organiser Forms
  document.getElementById('createEventForm')?.addEventListener('submit', handleCreateEvent);
  document.getElementById('createVenueForm')?.addEventListener('submit', handleCreateVenue);
  document.getElementById('saveConfigBtn')?.addEventListener('click', handleSaveConfig);
  document.getElementById('quickTestTTLBtn')?.addEventListener('click', handleQuickTestTTL);

  // Inbox Modal
  emailInboxBtn.addEventListener('click', () => inboxModal.classList.remove('hidden'));
  closeInboxBtn.addEventListener('click', () => inboxModal.classList.add('hidden'));

  // Handle URL Claim Hash if opened via waitlist offer link
  checkUrlOfferHash();
}

function showAlert(message, type = 'info') {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
  alertBox.classList.remove('hidden');
  setTimeout(() => alertBox.classList.add('hidden'), 5000);
}

function updateRoleUI() {
  const isOrganiser = state.userRole === 'Organiser' || state.userRole === 'Admin';
  const isAdmin = state.userRole === 'Admin';

  document.querySelectorAll('.organiser-only').forEach(el => el.style.display = isOrganiser ? 'inline-block' : 'none');
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? 'inline-block' : 'none');
}

// ----------------------------------------------------
// EVENTS & SEAT MAP
// ----------------------------------------------------
async function loadEvents() {
  try {
    const res = await fetch(`${API_BASE}/events`);
    state.events = await res.json();

    eventSelect.innerHTML = '<option value="">-- Choose Movie or Concert --</option>';
    state.events.forEach(evt => {
      const opt = document.createElement('option');
      opt.value = evt.id;
      opt.textContent = `${evt.title} (${evt.type}) - ${evt.date} @ ${evt.time} [${evt.stats.available} Available]`;
      eventSelect.appendChild(opt);
    });

    if (state.events.length > 0 && !state.selectedEventId) {
      eventSelect.value = state.events[0].id;
      state.selectedEventId = state.events[0].id;
      loadSeatMap(state.selectedEventId);
    }
  } catch (err) {
    showAlert('Failed to load events.', 'danger');
  }
}

async function loadSeatMap(eventId, isBackgroundRefresh = false) {
  try {
    const res = await fetch(`${API_BASE}/events/${eventId}/seats`);
    const data = await res.json();
    state.currentSeatData = data;

    const event = state.events.find(e => e.id === eventId);
    if (!isBackgroundRefresh && event) {
      document.getElementById('eventTitle').textContent = event.title;
      document.getElementById('eventType').textContent = event.type;
      document.getElementById('eventDate').textContent = event.date;
      document.getElementById('eventTime').textContent = event.time;
      document.getElementById('eventVenue').textContent = data.venue?.name || 'Venue';
      
      const pricingBadgeList = document.getElementById('pricingBadgeList');
      pricingBadgeList.innerHTML = Object.entries(event.pricing)
        .map(([cat, price]) => `<span class="badge">${cat}: $${price}</span>`)
        .join(' ');
      document.getElementById('eventDetailsCard').classList.remove('hidden');
    }

    renderSeatGrid(data);
    updateWaitlistBox(data, event);
  } catch (err) {
    if (!isBackgroundRefresh) showAlert('Failed to fetch seat map.', 'danger');
  }
}

function renderSeatGrid(data) {
  const seats = data.seats;
  const venue = data.venue;
  if (!venue || !seats) return;

  // Group seats by row
  const rowMap = {};
  for (const sId in seats) {
    const seat = seats[sId];
    if (!rowMap[seat.row]) rowMap[seat.row] = [];
    rowMap[seat.row].push(seat);
  }

  seatGridContainer.innerHTML = '';

  for (const rowName in rowMap) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'seat-row';

    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = `Row ${rowName} (${rowMap[rowName][0].category})`;
    rowDiv.appendChild(label);

    rowMap[rowName].sort((a,b) => a.col - b.col).forEach(seat => {
      const btn = document.createElement('button');
      btn.className = 'seat-btn';
      btn.textContent = seat.id;

      const isSelected = state.selectedSeatIds.includes(seat.id);
      const isMyHold = seat.status === 'held' && seat.heldBy === state.userEmail;
      const isOtherHold = seat.status === 'held' && seat.heldBy !== state.userEmail;

      if (seat.status === 'booked') {
        btn.classList.add('status-booked');
        btn.disabled = true;
        btn.title = 'Booked';
      } else if (isOtherHold) {
        btn.classList.add('status-other-hold');
        btn.disabled = true;
        btn.title = 'Held by another customer';
      } else if (isMyHold) {
        btn.classList.add('status-my-hold');
        btn.title = 'Held by you';
        if (!state.activeHoldTimerInterval && seat.holdExpiresAt) {
          startHoldTimer(seat.holdExpiresAt);
        }
      } else if (isSelected) {
        btn.classList.add('status-selected');
      } else {
        btn.classList.add('status-available');
      }

      btn.addEventListener('click', () => toggleSeatSelection(seat));
      rowDiv.appendChild(btn);
    });

    seatGridContainer.appendChild(rowDiv);
  }

  updateCheckoutPanel();
}

async function toggleSeatSelection(seat) {
  if (seat.status === 'booked') return;
  if (seat.status === 'held' && seat.heldBy !== state.userEmail) {
    showAlert('This seat is currently held by another user.', 'warning');
    return;
  }

  const index = state.selectedSeatIds.indexOf(seat.id);
  if (index > -1) {
    state.selectedSeatIds.splice(index, 1);
  } else {
    state.selectedSeatIds.push(seat.id);
  }

  // Auto-trigger hold request when seat is clicked
  if (state.selectedSeatIds.length > 0) {
    await requestSeatHold();
  } else {
    updateCheckoutPanel();
  }
}

// Atomic Hold Request
async function requestSeatHold() {
  try {
    const res = await fetch(`${API_BASE}/seats/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: state.selectedEventId,
        seatIds: state.selectedSeatIds,
        customerEmail: state.userEmail
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showAlert(`Hold Error: ${data.error}`, 'danger');
      state.selectedSeatIds = [];
      loadSeatMap(state.selectedEventId);
      return;
    }

    state.holdExpiresAt = data.expiresAt;
    startHoldTimer(data.expiresAt);
    showAlert(`Seats ${data.heldSeats.join(', ')} held! You have ${Math.round(data.holdTTLSeconds / 60)} minutes to checkout.`, 'info');
    loadSeatMap(state.selectedEventId, true);
  } catch (err) {
    showAlert('Network error during seat hold.', 'danger');
  }
}

function startHoldTimer(expiresAt) {
  if (state.activeHoldTimerInterval) clearInterval(state.activeHoldTimerInterval);

  state.activeHoldTimerInterval = setInterval(() => {
    const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    holdTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    if (diff <= 0) {
      clearInterval(state.activeHoldTimerInterval);
      state.activeHoldTimerInterval = null;
      state.selectedSeatIds = [];
      showAlert('Seat hold timer expired! Held seats have been auto-released.', 'danger');
      loadSeatMap(state.selectedEventId);
    }
  }, 1000);
}

function updateCheckoutPanel() {
  const map = state.currentSeatData?.seats;
  const event = state.events.find(e => e.id === state.selectedEventId);
  if (!map || !event) return;

  const myHeldSeats = [];
  let totalPrice = 0;

  for (const sId in map) {
    const s = map[sId];
    if (s.status === 'held' && s.heldBy === state.userEmail) {
      myHeldSeats.push(s.id);
      totalPrice += (event.pricing[s.category] || 20);
    }
  }

  if (myHeldSeats.length > 0) {
    checkoutPanel.classList.remove('hidden');
    selectedSeatsText.textContent = myHeldSeats.join(', ');
    totalPriceText.textContent = `$${totalPrice}`;
    state.selectedSeatIds = myHeldSeats;
  } else {
    checkoutPanel.classList.add('hidden');
    if (state.activeHoldTimerInterval) {
      clearInterval(state.activeHoldTimerInterval);
      state.activeHoldTimerInterval = null;
    }
  }
}

// Abandon Checkout / Release Hold
async function handleReleaseHold() {
  if (!state.selectedEventId || state.selectedSeatIds.length === 0) return;

  try {
    const res = await fetch(`${API_BASE}/seats/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: state.selectedEventId,
        seatIds: state.selectedSeatIds,
        customerEmail: state.userEmail
      })
    });

    const data = await res.json();
    state.selectedSeatIds = [];
    showAlert('Held seats auto-released successfully.', 'info');
    loadSeatMap(state.selectedEventId);
  } catch (err) {
    showAlert('Failed to release seats.', 'danger');
  }
}

// Confirm Booking & Generate Ticket
async function handleConfirmBooking() {
  if (!state.selectedEventId || state.selectedSeatIds.length === 0) return;

  const customerName = prompt('Enter your Full Name for ticket generation:', 'John Doe');
  if (!customerName) return;

  try {
    const res = await fetch(`${API_BASE}/bookings/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: state.selectedEventId,
        seatIds: state.selectedSeatIds,
        customerName,
        customerEmail: state.userEmail
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showAlert(`Booking Failed: ${data.error}`, 'danger');
      return;
    }

    showAlert(`🎉 Booking Confirmed! Ticket Ref: ${data.booking.ref}. Check "My Bookings" for your QR Code!`, 'success');
    state.selectedSeatIds = [];
    loadSeatMap(state.selectedEventId);
    loadEvents();

    // Switch to My Bookings tab
    document.querySelector('[data-tab="tab-my-bookings"]').click();
  } catch (err) {
    showAlert('Error creating booking.', 'danger');
  }
}

// ----------------------------------------------------
// WAITLIST MANAGEMENT
// ----------------------------------------------------
function updateWaitlistBox(data, event) {
  if (!event || !data.seats) return;

  const categories = Object.keys(event.pricing);
  waitlistCategorySelect.innerHTML = categories.map(cat => {
    const count = data.waitlists?.[cat] || 0;
    return `<option value="${cat}">${cat} (${count} waitlisted)</option>`;
  }).join('');

  // Check if any seat available
  let availableCount = 0;
  for (const sId in data.seats) {
    if (data.seats[sId].status === 'available') availableCount++;
  }

  waitlistBox.classList.remove('hidden');
  if (availableCount === 0) {
    waitlistStatusText.textContent = '🔥 Event is completely SOLD OUT! Join the waitlist below.';
  } else {
    waitlistStatusText.textContent = `Available seats: ${availableCount}. If your preferred category is full, join waitlist.`;
  }
}

async function handleJoinWaitlist() {
  const category = waitlistCategorySelect.value;
  if (!state.selectedEventId || !category) return;

  try {
    const res = await fetch(`${API_BASE}/waitlist/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: state.selectedEventId,
        category,
        customerEmail: state.userEmail,
        customerName: state.userEmail.split('@')[0]
      })
    });

    const data = await res.json();
    showAlert(data.message, 'success');
    loadSeatMap(state.selectedEventId);
  } catch (err) {
    showAlert('Failed to join waitlist.', 'danger');
  }
}

// ----------------------------------------------------
// CUSTOMER DASHBOARD & QR TICKETS
// ----------------------------------------------------
async function loadCustomerDashboard() {
  try {
    const res = await fetch(`${API_BASE}/customer/dashboard?email=${encodeURIComponent(state.userEmail)}`);
    const data = await res.json();

    const bookingsList = document.getElementById('bookingsList');
    const waitlistOffersContainer = document.getElementById('waitlistOffersContainer');

    // Render Active Waitlist Offers (Time-Limited Offer Flow)
    if (data.activeOffers && data.activeOffers.length > 0) {
      waitlistOffersContainer.innerHTML = `
        <div class="card alert-success">
          <h3>⚡ Action Required: Time-Limited Waitlist Seat Offer!</h3>
          ${data.activeOffers.map(offer => `
            <div style="margin-top:10px; padding:10px; background:#fff; border-radius:4px;">
              <p><strong>Event:</strong> ${offer.eventTitle} | <strong>Seat:</strong> ${offer.seatId} (${offer.category} - $${offer.price})</p>
              <p><strong>Offer Expires In:</strong> <span id="offerTimer_${offer.seatId}" style="font-weight:bold; color:red;">02:00</span></p>
              <button class="btn btn-primary" onclick="claimOfferSeat('${offer.eventId}', '${offer.seatId}')">🎟️ Claim & Complete Booking Now</button>
            </div>
          `).join('')}
        </div>
      `;

      data.activeOffers.forEach(offer => {
        startOfferTimer(offer.seatId, offer.expiresAt);
      });
    } else {
      waitlistOffersContainer.innerHTML = '';
    }

    // Render Confirmed Bookings & QR Codes
    if (!data.bookings || data.bookings.length === 0) {
      bookingsList.innerHTML = '<p class="text-muted">No confirmed bookings found for your email address.</p>';
      return;
    }

    bookingsList.innerHTML = data.bookings.map(b => `
      <div class="booking-card ${b.status === 'CANCELLED' ? 'text-muted' : ''}">
        <h4>${b.eventTitle}</h4>
        <p><strong>Ref:</strong> <code>${b.ref}</code> | <strong>Status:</strong> ${b.status === 'CONFIRMED' ? '🟢 CONFIRMED' : '🔴 CANCELLED'}</p>
        <p><strong>Date & Time:</strong> ${b.date} @ ${b.time}</p>
        <p><strong>Seats:</strong> ${b.seats.join(', ')}</p>
        <p><strong>Total Paid:</strong> $${b.totalPrice}</p>
        ${b.status === 'CONFIRMED' ? `
          <img class="qr-code-img" src="${b.qrCodeUrl}" alt="QR Ticket ${b.ref}">
          <button class="btn btn-danger" style="width:100%;" onclick="cancelBooking('${b.ref}')">❌ Cancel Booking (Reallocate Seat)</button>
        ` : '<p style="color:red; font-weight:bold;">Cancelled & Refunded</p>'}
      </div>
    `).join('');

  } catch (err) {
    showAlert('Failed to load user bookings.', 'danger');
  }
}

function startOfferTimer(seatId, expiresAt) {
  if (state.activeOfferTimerIntervals[seatId]) clearInterval(state.activeOfferTimerIntervals[seatId]);

  state.activeOfferTimerIntervals[seatId] = setInterval(() => {
    const el = document.getElementById(`offerTimer_${seatId}`);
    if (!el) return;

    const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    el.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    if (diff <= 0) {
      clearInterval(state.activeOfferTimerIntervals[seatId]);
      loadCustomerDashboard();
    }
  }, 1000);
}

window.claimOfferSeat = async function(eventId, seatId) {
  state.selectedEventId = eventId;
  state.selectedSeatIds = [seatId];
  document.querySelector('[data-tab="tab-events"]').click();
  await loadSeatMap(eventId);
  await handleConfirmBooking();
};

window.cancelBooking = async function(bookingRef) {
  if (!confirm(`Are you sure you want to cancel booking ${bookingRef}? The seat will be offered to the next waitlisted customer immediately.`)) return;

  try {
    const res = await fetch(`${API_BASE}/bookings/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingRef,
        customerEmail: state.userEmail
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showAlert(`Cancellation Failed: ${data.error}`, 'danger');
      return;
    }

    showAlert(data.message, 'success');
    loadCustomerDashboard();
    loadEvents();
  } catch (err) {
    showAlert('Error cancelling booking.', 'danger');
  }
};

// ----------------------------------------------------
// ORGANISER & ADMIN DASHBOARDS
// ----------------------------------------------------
async function loadOrganiserSummary() {
  try {
    const res = await fetch(`${API_BASE}/organiser/summary`);
    const summary = await res.json();

    const tbody = document.querySelector('#organiserTable tbody');
    tbody.innerHTML = summary.map(row => `
      <tr>
        <td><strong>${row.title}</strong></td>
        <td>${row.date}</td>
        <td>${row.totalSeats}</td>
        <td><span style="color:red; font-weight:bold;">${row.bookedCount}</span></td>
        <td><span style="color:orange; font-weight:bold;">${row.heldCount}</span></td>
        <td><span style="color:green; font-weight:bold;">${row.availableCount}</span></td>
        <td>${row.totalWaitlisted}</td>
        <td><strong>$${row.revenue}</strong></td>
      </tr>
    `).join('');

    // Populate Venues dropdown in create event form
    const vRes = await fetch(`${API_BASE}/venues`);
    const vList = await vRes.json();
    const newEventVenue = document.getElementById('newEventVenue');
    newEventVenue.innerHTML = vList.map(v => `<option value="${v.id}">${v.name} (${v.rows}x${v.cols})</option>`).join('');

  } catch (err) {
    showAlert('Failed to load organiser data.', 'danger');
  }
}

async function handleCreateEvent(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('newEventTitle').value,
    type: document.getElementById('newEventType').value,
    venueId: document.getElementById('newEventVenue').value,
    date: document.getElementById('newEventDate').value,
    time: document.getElementById('newEventTime').value,
    pricing: {
      'Premium': parseFloat(document.getElementById('pricePremium').value) || 50,
      'Standard': parseFloat(document.getElementById('priceStandard').value) || 25
    }
  };

  try {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showAlert('New Event Created Successfully!', 'success');
      loadEvents();
      loadOrganiserSummary();
    }
  } catch (err) {
    showAlert('Failed to create event.', 'danger');
  }
}

async function loadVenuesList() {
  try {
    const res = await fetch(`${API_BASE}/venues`);
    const vList = await res.json();
    const listEl = document.getElementById('venuesList');
    listEl.innerHTML = vList.map(v => `<li><strong>${v.name}</strong> - ${v.rows} Rows x ${v.cols} Cols</li>`).join('');
  } catch (err) {
    showAlert('Failed to load venues.', 'danger');
  }
}

async function handleCreateVenue(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('newVenueName').value,
    rows: parseInt(document.getElementById('newVenueRows').value),
    cols: parseInt(document.getElementById('newVenueCols').value)
  };

  try {
    const res = await fetch(`${API_BASE}/venues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showAlert('New Venue Created!', 'success');
      loadVenuesList();
    }
  } catch (err) {
    showAlert('Failed to create venue.', 'danger');
  }
}

async function handleSaveConfig() {
  const holdTTL = document.getElementById('cfgHoldTTL').value;
  const offerTTL = document.getElementById('cfgOfferTTL').value;
  try {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdTTLSeconds: holdTTL, offerTTLSeconds: offerTTL })
    });
    if (res.ok) showAlert('TTL Settings Updated!', 'success');
  } catch (err) {
    showAlert('Failed to save config.', 'danger');
  }
}

async function handleQuickTestTTL() {
  document.getElementById('cfgHoldTTL').value = 30;
  document.getElementById('cfgOfferTTL').value = 15;
  await handleSaveConfig();
  showAlert('⚡ Quick Test Mode active! Holds expire in 30s, offers expire in 15s.', 'warning');
}

// ----------------------------------------------------
// SIMULATED EMAIL INBOX
// ----------------------------------------------------
async function loadInbox() {
  try {
    const res = await fetch(`${API_BASE}/emails`);
    const emails = await res.json();
    emailCount.textContent = emails.length;

    emailMessagesList.innerHTML = emails.map(e => `
      <div class="email-item">
        <p><strong>To:</strong> ${e.to} | <strong>Date:</strong> ${new Date(e.sentAt).toLocaleTimeString()}</p>
        <p><strong>Subject:</strong> ${e.subject}</p>
        <pre>${e.body}</pre>
        ${e.qrCodeUrl ? `<img src="${e.qrCodeUrl}" style="width:100px; height:100px; display:block; margin-top:5px;">` : ''}
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to update email inbox');
  }
}

function checkUrlOfferHash() {
  if (window.location.hash.includes('claim-offer')) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const eventId = params.get('eventId');
    const seatId = params.get('seatId');
    const email = params.get('email');

    if (eventId && seatId && email) {
      userEmailInput.value = email;
      state.userEmail = email;
      state.selectedEventId = eventId;
      state.selectedSeatIds = [seatId];

      setTimeout(() => {
        showAlert(`Waitlist Offer detected for seat ${seatId}! Complete booking now.`, 'success');
        handleConfirmBooking();
      }, 500);
    }
  }
}
