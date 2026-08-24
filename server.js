const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global State / Database Simulation
let config = {
  holdTTLSeconds: 600, // 10 minutes default
  offerTTLSeconds: 120  // 2 minutes for waitlist offers
};

// Venues
let venues = [
  {
    id: 'v1',
    name: 'Grand IMAX Theater',
    rows: 5,
    cols: 6,
    seatCategories: {
      'Row-A': 'Premium',
      'Row-B': 'Premium',
      'Row-C': 'Standard',
      'Row-D': 'Standard',
      'Row-E': 'Standard'
    }
  },
  {
    id: 'v2',
    name: 'Star Concert Arena',
    rows: 4,
    cols: 8,
    seatCategories: {
      'Row-A': 'VIP',
      'Row-B': 'Premium',
      'Row-C': 'Standard',
      'Row-D': 'Standard'
    }
  }
];

// Events
let events = [
  {
    id: 'e1',
    title: 'Inception - Special Re-Release',
    type: 'Movie',
    venueId: 'v1',
    date: '2026-09-01',
    time: '19:00',
    pricing: {
      'Premium': 25,
      'Standard': 15
    }
  },
  {
    id: 'e2',
    title: 'Coldplay - World Tour Live',
    type: 'Concert',
    venueId: 'v2',
    date: '2026-09-10',
    time: '20:30',
    pricing: {
      'VIP': 150,
      'Premium': 90,
      'Standard': 50
    }
  }
];

// Seat Maps: eventId -> { seatId: { id, row, col, category, status: 'available'|'held'|'booked', heldBy, holdExpiresAt, bookingRef, isWaitlistOffer } }
let seatMaps = {};

// Waitlists: eventId -> { category -> [ { customerEmail, customerName, joinedAt } ] }
let waitlists = {};

// Bookings: bookingRef -> { ref, eventId, eventTitle, customerName, customerEmail, seats: [], totalPrice, bookedAt, qrCodeUrl, status: 'CONFIRMED'|'CANCELLED' }
let bookings = {};

// Sent Simulated Emails Log
let simulatedEmails = [];

// Concurrency locks per seat key (eventId + "_" + seatId)
const seatLocks = new Set();

// Helper to initialize seat maps for events
function initSeatMap(event) {
  const venue = venues.find(v => v.id === event.venueId);
  if (!venue) return;

  seatMaps[event.id] = {};
  waitlists[event.id] = {};

  const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (let r = 0; r < venue.rows; r++) {
    const rowName = `Row-${rowLabels[r]}`;
    const category = venue.seatCategories[rowName] || 'Standard';
    
    if (!waitlists[event.id][category]) {
      waitlists[event.id][category] = [];
    }

    for (let c = 1; c <= venue.cols; c++) {
      const seatId = `${rowLabels[r]}${c}`;
      seatMaps[event.id][seatId] = {
        id: seatId,
        row: rowLabels[r],
        col: c,
        category: category,
        status: 'available',
        heldBy: null,
        holdExpiresAt: null,
        bookingRef: null,
        isWaitlistOffer: false
      };
    }
  }
}

// Pre-initialize initial events
events.forEach(e => initSeatMap(e));

// ----------------------------------------------------
// BACKGROUND WORKER: Seat Hold TTL Expiry & Waitlist Processing
// ----------------------------------------------------
setInterval(() => {
  const now = Date.now();

  for (const eventId in seatMaps) {
    const map = seatMaps[eventId];
    const event = events.find(e => e.id === eventId);
    if (!event) continue;

    for (const seatId in map) {
      const seat = map[seatId];
      if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= now) {
        console.log(`[TTL Worker] Hold expired for seat ${seatId} in event ${eventId}`);
        
        const previousHolder = seat.heldBy;
        const category = seat.category;
        
        // Reset seat status
        seat.status = 'available';
        seat.heldBy = null;
        seat.holdExpiresAt = null;
        seat.isWaitlistOffer = false;

        // Check if there is a waitlist for this category
        processWaitlistForSeat(eventId, seatId, category);
      }
    }
  }
}, 2000); // Check every 2 seconds

// Function to allocate available seat to next waitlisted customer
function processWaitlistForSeat(eventId, seatId, category) {
  if (!waitlists[eventId] || !waitlists[eventId][category] || waitlists[eventId][category].length === 0) {
    return;
  }

  const nextInLine = waitlists[eventId][category].shift(); // Dequeue next customer
  const event = events.find(e => e.id === eventId);
  const seat = seatMaps[eventId][seatId];

  if (!seat || seat.status !== 'available') return;

  // Place time-limited hold for waitlisted customer
  const offerExpiry = Date.now() + (config.offerTTLSeconds * 1000);
  seat.status = 'held';
  seat.heldBy = nextInLine.customerEmail;
  seat.holdExpiresAt = offerExpiry;
  seat.isWaitlistOffer = true;

  // Send notification email with claim offer link/token
  const offerLink = `http://localhost:${PORT}/#claim-offer?eventId=${eventId}&seatId=${seatId}&email=${encodeURIComponent(nextInLine.customerEmail)}`;
  
  const emailMsg = {
    id: 'EML-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    to: nextInLine.customerEmail,
    subject: `⚡ Action Required: Seat Available for ${event.title}!`,
    body: `Hello ${nextInLine.customerName || 'Valued Customer'},\n\nA seat (${seatId} - ${category}) has opened up for "${event.title}". As you were next on the waitlist, this seat is reserved exclusively for you for the next ${Math.round(config.offerTTLSeconds / 60)} minutes.\n\nClick here to complete your booking before the offer expires:\n${offerLink}`,
    sentAt: new Date().toISOString()
  };

  simulatedEmails.unshift(emailMsg);
  console.log(`[Waitlist Auto-Assign] Offered seat ${seatId} to ${nextInLine.customerEmail}. Expiry: ${new Date(offerExpiry).toLocaleTimeString()}`);
}

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// Config Endpoint
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const { holdTTLSeconds, offerTTLSeconds } = req.body;
  if (holdTTLSeconds) config.holdTTLSeconds = parseInt(holdTTLSeconds);
  if (offerTTLSeconds) config.offerTTLSeconds = parseInt(offerTTLSeconds);
  res.json({ success: true, config });
});

// Venues List & Create (Admin)
app.get('/api/venues', (req, res) => {
  res.json(venues);
});

app.post('/api/venues', (req, res) => {
  const { name, rows, cols, seatCategories } = req.body;
  if (!name || !rows || !cols) return res.status(400).json({ error: 'Missing venue fields' });

  const newVenue = {
    id: 'v' + (venues.length + 1),
    name,
    rows: parseInt(rows),
    cols: parseInt(cols),
    seatCategories: seatCategories || {}
  };
  venues.push(newVenue);
  res.json({ success: true, venue: newVenue });
});

// Events List & Create (Organiser)
app.get('/api/events', (req, res) => {
  const result = events.map(evt => {
    const map = seatMaps[evt.id] || {};
    let totalSeats = 0, available = 0, held = 0, booked = 0;
    for (const sId in map) {
      totalSeats++;
      if (map[sId].status === 'available') available++;
      else if (map[sId].status === 'held') held++;
      else if (map[sId].status === 'booked') booked++;
    }
    return {
      ...evt,
      stats: { totalSeats, available, held, booked }
    };
  });
  res.json(result);
});

app.post('/api/events', (req, res) => {
  const { title, type, venueId, date, time, pricing } = req.body;
  if (!title || !venueId || !date || !pricing) {
    return res.status(400).json({ error: 'Missing required event fields' });
  }

  const newEvent = {
    id: 'e' + (events.length + 1),
    title,
    type: type || 'Movie',
    venueId,
    date,
    time: time || '19:00',
    pricing
  };

  events.push(newEvent);
  initSeatMap(newEvent);
  res.json({ success: true, event: newEvent });
});

// Get Seat Map & Categories for an Event
app.get('/api/events/:id/seats', (req, res) => {
  const eventId = req.params.id;
  const map = seatMaps[eventId];
  if (!map) return res.status(404).json({ error: 'Event not found' });

  const venue = venues.find(v => v.id === events.find(e => e.id === eventId)?.venueId);
  const waitlistCounts = {};
  if (waitlists[eventId]) {
    for (const cat in waitlists[eventId]) {
      waitlistCounts[cat] = waitlists[eventId][cat].length;
    }
  }

  res.json({
    eventId,
    venue,
    seats: map,
    waitlists: waitlistCounts
  });
});

// Hold Seats (Atomic Concurrency Protection)
app.post('/api/seats/hold', (req, res) => {
  const { eventId, seatIds, customerEmail } = req.body;

  if (!eventId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0 || !customerEmail) {
    return res.status(400).json({ error: 'Invalid parameters. Need eventId, seatIds array, customerEmail.' });
  }

  const map = seatMaps[eventId];
  if (!map) return res.status(404).json({ error: 'Event not found' });

  // Atomic lock check to prevent race conditions
  const locksToAcquire = seatIds.map(s => `${eventId}_${s}`);
  for (const lockKey of locksToAcquire) {
    if (seatLocks.has(lockKey)) {
      return res.status(409).json({ error: `Seat is currently being locked by another concurrent process. Please retry.` });
    }
  }

  // Acquire locks
  locksToAcquire.forEach(lockKey => seatLocks.add(lockKey));

  try {
    const now = Date.now();
    // Validate availability for all requested seats
    for (const seatId of seatIds) {
      const seat = map[seatId];
      if (!seat) {
        throw new Error(`Seat ${seatId} does not exist.`);
      }
      if (seat.status === 'booked') {
        throw new Error(`Seat ${seatId} is already booked.`);
      }
      if (seat.status === 'held') {
        if (seat.heldBy === customerEmail && seat.holdExpiresAt > now) {
          // Already held by this same customer, extend/continue
          continue;
        }
        throw new Error(`Seat ${seatId} is currently held by another customer.`);
      }
    }

    // All seats available -> apply hold with TTL
    const expiresAt = now + (config.holdTTLSeconds * 1000);
    seatIds.forEach(seatId => {
      map[seatId].status = 'held';
      map[seatId].heldBy = customerEmail;
      map[seatId].holdExpiresAt = expiresAt;
      map[seatId].isWaitlistOffer = false;
    });

    console.log(`[Concurrency Protection Pass] Seats ${seatIds.join(', ')} held by ${customerEmail}`);

    res.json({
      success: true,
      heldSeats: seatIds,
      expiresAt: expiresAt,
      holdTTLSeconds: config.holdTTLSeconds
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    // Always release temporary atomic locks
    locksToAcquire.forEach(lockKey => seatLocks.delete(lockKey));
  }
});

// Release Seats (Abandon Checkout)
app.post('/api/seats/release', (req, res) => {
  const { eventId, seatIds, customerEmail } = req.body;
  const map = seatMaps[eventId];
  if (!map) return res.status(404).json({ error: 'Event not found' });

  seatIds.forEach(seatId => {
    const seat = map[seatId];
    if (seat && seat.status === 'held' && seat.heldBy === customerEmail) {
      seat.status = 'available';
      seat.heldBy = null;
      seat.holdExpiresAt = null;
      seat.isWaitlistOffer = false;
      
      // Auto-assign to waitlist if any customer is waiting
      processWaitlistForSeat(eventId, seatId, seat.category);
    }
  });

  res.json({ success: true, releasedSeats: seatIds });
});

// Book Seats (Confirm Payment & Generate QR Ticket)
app.post('/api/bookings/create', async (req, res) => {
  const { eventId, seatIds, customerName, customerEmail } = req.body;

  if (!eventId || !seatIds || !Array.isArray(seatIds) || !customerEmail || !customerName) {
    return res.status(400).json({ error: 'Missing required booking details.' });
  }

  const event = events.find(e => e.id === eventId);
  const map = seatMaps[eventId];
  if (!event || !map) return res.status(404).json({ error: 'Event not found.' });

  const now = Date.now();
  let totalPrice = 0;

  // Validate seats are currently held by this customer
  for (const seatId of seatIds) {
    const seat = map[seatId];
    if (!seat) return res.status(400).json({ error: `Seat ${seatId} not found.` });
    if (seat.status !== 'held' || seat.heldBy !== customerEmail || seat.holdExpiresAt <= now) {
      return res.status(400).json({ error: `Seat ${seatId} hold has expired or is invalid. Please select again.` });
    }
    const categoryPrice = event.pricing[seat.category] || 20;
    totalPrice += categoryPrice;
  }

  // Generate Booking Reference
  const bookingRef = 'TKT-' + Math.random().toString(36).substring(2, 8).toUpperCase();

  // Mark seats as booked
  seatIds.forEach(seatId => {
    map[seatId].status = 'booked';
    map[seatId].bookingRef = bookingRef;
    map[seatId].heldBy = null;
    map[seatId].holdExpiresAt = null;
  });

  // Generate QR Code Data URL encoding Booking Reference & Details
  const qrPayload = JSON.stringify({
    ref: bookingRef,
    event: event.title,
    date: event.date,
    time: event.time,
    customer: customerName,
    email: customerEmail,
    seats: seatIds,
    total: `$${totalPrice}`
  });

  try {
    const qrCodeUrl = await QRCode.toDataURL(qrPayload);

    const bookingObj = {
      ref: bookingRef,
      eventId,
      eventTitle: event.title,
      date: event.date,
      time: event.time,
      customerName,
      customerEmail,
      seats: seatIds,
      totalPrice,
      bookedAt: new Date().toISOString(),
      qrCodeUrl,
      status: 'CONFIRMED'
    };

    bookings[bookingRef] = bookingObj;

    // Send Confirmation Email
    const emailMsg = {
      id: 'EML-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      to: customerEmail,
      subject: `🎟️ Ticket Confirmed: ${event.title} [Ref: ${bookingRef}]`,
      body: `Dear ${customerName},\n\nYour booking for "${event.title}" is confirmed!\n\nBooking Ref: ${bookingRef}\nDate: ${event.date} at ${event.time}\nSeats: ${seatIds.join(', ')}\nTotal Paid: $${totalPrice}\n\nYour QR Code Ticket is attached in your digital dashboard.\nThank you for using Ticket System!`,
      qrCodeUrl: qrCodeUrl,
      sentAt: new Date().toISOString()
    };
    simulatedEmails.unshift(emailMsg);

    res.json({ success: true, booking: bookingObj });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code ticket.' });
  }
});

// Join Waitlist
app.post('/api/waitlist/join', (req, res) => {
  const { eventId, category, customerName, customerEmail } = req.body;
  if (!eventId || !category || !customerEmail) {
    return res.status(400).json({ error: 'Missing waitlist fields.' });
  }

  if (!waitlists[eventId]) waitlists[eventId] = {};
  if (!waitlists[eventId][category]) waitlists[eventId][category] = [];

  // Check if already in waitlist
  const existing = waitlists[eventId][category].find(w => w.customerEmail === customerEmail);
  if (existing) {
    return res.json({ success: true, message: 'You are already on the waitlist for this category.', position: waitlists[eventId][category].indexOf(existing) + 1 });
  }

  waitlists[eventId][category].push({
    customerEmail,
    customerName: customerName || customerEmail.split('@')[0],
    joinedAt: new Date().toISOString()
  });

  const position = waitlists[eventId][category].length;
  console.log(`[Waitlist Joined] ${customerEmail} joined category ${category} for event ${eventId}. Position: ${position}`);

  res.json({
    success: true,
    message: `Successfully joined waitlist for ${category}. You are #${position} in line.`,
    position
  });
});

// Cancel Booking & Trigger Waitlist Auto-Reallocation
app.post('/api/bookings/cancel', (req, res) => {
  const { bookingRef, customerEmail } = req.body;
  const booking = bookings[bookingRef];

  if (!booking) return res.status(404).json({ error: 'Booking reference not found.' });
  if (booking.customerEmail !== customerEmail) {
    return res.status(403).json({ error: 'Unauthorized cancellation request.' });
  }
  if (booking.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Booking is already cancelled.' });
  }

  booking.status = 'CANCELLED';
  const map = seatMaps[booking.eventId];

  if (map) {
    booking.seats.forEach(seatId => {
      const seat = map[seatId];
      if (seat) {
        const category = seat.category;
        seat.status = 'available';
        seat.bookingRef = null;
        seat.heldBy = null;
        seat.holdExpiresAt = null;

        // Immediately offer cancelled seat to waitlist queue
        processWaitlistForSeat(booking.eventId, seatId, category);
      }
    });
  }

  // Email Notification of Cancellation
  simulatedEmails.unshift({
    id: 'EML-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    to: customerEmail,
    subject: `❌ Booking Cancelled [Ref: ${bookingRef}]`,
    body: `Hello ${booking.customerName},\n\nYour booking for "${booking.eventTitle}" (${booking.seats.join(', ')}) has been successfully cancelled. A refund of $${booking.totalPrice} has been initiated.\n\nThank you.`,
    sentAt: new Date().toISOString()
  });

  res.json({ success: true, message: 'Booking cancelled successfully. Seats reallocated to waitlist if available.' });
});

// Get User Bookings & Waitlist Claims
app.get('/api/customer/dashboard', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email parameter required.' });

  const userBookings = Object.values(bookings).filter(b => b.customerEmail === email);

  // Check active holds & waitlist offers for this user
  const activeHolds = [];
  const activeOffers = [];
  const now = Date.now();

  for (const eventId in seatMaps) {
    const map = seatMaps[eventId];
    const event = events.find(e => e.id === eventId);
    for (const seatId in map) {
      const seat = map[seatId];
      if (seat.heldBy === email && seat.holdExpiresAt > now && seat.status === 'held') {
        const item = {
          eventId,
          eventTitle: event?.title,
          seatId,
          category: seat.category,
          price: event?.pricing[seat.category] || 20,
          expiresAt: seat.holdExpiresAt,
          isOffer: seat.isWaitlistOffer
        };
        if (seat.isWaitlistOffer) activeOffers.push(item);
        else activeHolds.push(item);
      }
    }
  }

  res.json({
    bookings: userBookings,
    activeHolds,
    activeOffers
  });
});

// Organiser Summary & Revenue Dashboard
app.get('/api/organiser/summary', (req, res) => {
  const summary = events.map(event => {
    const map = seatMaps[event.id] || {};
    let totalSeats = 0, bookedCount = 0, heldCount = 0, revenue = 0;

    for (const sId in map) {
      totalSeats++;
      const seat = map[sId];
      if (seat.status === 'booked') {
        bookedCount++;
        revenue += (event.pricing[seat.category] || 20);
      } else if (seat.status === 'held') {
        heldCount++;
      }
    }

    const eventWaitlists = waitlists[event.id] || {};
    let totalWaitlisted = 0;
    for (const cat in eventWaitlists) {
      totalWaitlisted += eventWaitlists[cat].length;
    }

    return {
      eventId: event.id,
      title: event.title,
      venueId: event.venueId,
      date: event.date,
      totalSeats,
      bookedCount,
      heldCount,
      availableCount: totalSeats - (bookedCount + heldCount),
      revenue,
      totalWaitlisted
    };
  });

  res.json(summary);
});

// Simulated Inbox Endpoint
app.get('/api/emails', (req, res) => {
  const email = req.query.email;
  if (email) {
    res.json(simulatedEmails.filter(e => e.to === email));
  } else {
    res.json(simulatedEmails);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎟️ Ticket Booking System Running at http://localhost:${PORT}`);
  console.log(`Hold TTL: ${config.holdTTLSeconds} seconds | Offer TTL: ${config.offerTTLSeconds} seconds`);
  console.log(`====================================================`);
});
