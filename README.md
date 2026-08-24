# Ticket Booking System

A lightweight, high-performance Ticket Booking System for movies and concerts featuring real-time visual seat maps, seat hold TTL auto-release, concurrency locks for simultaneous selection, category-level waitlists with automatic seat reallocation on cancellation, and digital QR code ticket generation.

---

## 🚀 Quick Setup & Run Instructions

### 1. Prerequisites
- Node.js (v16+ recommended)
- `npm` package manager

### 2. Installation
```bash
# Navigate into the project folder
cd ticket-booking-system

# Install dependencies (express, cors, qrcode)
npm install
```

### 3. Running the Application
```bash
# Start the server
npm start
```
The application will launch on **http://localhost:3000**.

---

## 🔑 Environment Variables (`.env.example`)

```env
PORT=3000
HOLD_TTL_SECONDS=600
OFFER_TTL_SECONDS=120
NODE_ENV=development
```

---

## 🛠️ API Documentation

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/events` | List all movie/concert listings with real-time seat stats |
| `POST` | `/api/events` | Create new event listing (Organiser) |
| `GET` | `/api/events/:id/seats` | Get venue layout, seat matrix (Available/Held/Booked), and waitlist queue counts |
| `POST` | `/api/seats/hold` | Place atomic hold on seats with TTL countdown (Prevents double-holding) |
| `POST` | `/api/seats/release` | Auto-release held seats upon checkout abandonment |
| `POST` | `/api/bookings/create` | Confirm booking, convert held seats to booked, generate QR code ticket |
| `POST` | `/api/bookings/cancel` | Cancel existing booking & trigger waitlist auto-reallocation |
| `POST` | `/api/waitlist/join` | Join category waitlist for sold-out event |
| `GET` | `/api/customer/dashboard` | Get active user holds, confirmed QR tickets, and time-limited waitlist offers |
| `GET` | `/api/organiser/summary` | Get revenue report, seat occupancy breakdown per event |
| `GET` | `/api/emails` | Simulated real-time email inbox |
| `POST` | `/api/config` | Adjust seat hold TTL and waitlist offer TTL dynamically |

---

## 🗄️ Database Schema Representation

### 1. Venues Table (`venues`)
- `id` (PK, string)
- `name` (string)
- `rows` (integer)
- `cols` (integer)
- `seatCategories` (JSON object, mapping row names to category e.g. `Row-A: Premium`)

### 2. Events Table (`events`)
- `id` (PK, string)
- `title` (string)
- `type` (Movie | Concert)
- `venueId` (FK -> `venues.id`)
- `date` (ISO date string)
- `time` (string)
- `pricing` (JSON object, mapping category to price e.g. `{"Premium": 25, "Standard": 15}`)

### 3. Seats Table (`seats` - scoped by event)
- `seatId` (string, e.g. `A1`)
- `row` (string)
- `col` (integer)
- `category` (string)
- `status` (`available` | `held` | `booked`)
- `heldBy` (string, customer email)
- `holdExpiresAt` (timestamp in ms)
- `bookingRef` (string, FK -> `bookings.ref`)
- `isWaitlistOffer` (boolean)

### 4. Bookings Table (`bookings`)
- `ref` (PK, string e.g. `TKT-8F29A3`)
- `eventId` (FK -> `events.id`)
- `customerName` (string)
- `customerEmail` (string)
- `seats` (array of seat IDs)
- `totalPrice` (number)
- `bookedAt` (ISO timestamp)
- `qrCodeUrl` (base64 Data URL)
- `status` (`CONFIRMED` | `CANCELLED`)

### 5. Waitlists Queue Table (`waitlists`)
- `eventId` (FK -> `events.id`)
- `category` (string)
- `queue` (ordered list of `{ customerEmail, customerName, joinedAt }`)

---

## 🧠 System Design Write-Up (800 words max)

### 1. Seat Hold and TTL Mechanism
When a customer selects seats on the visual grid, the client dispatches a request to `/api/seats/hold`. The server assigns an explicit expiration timestamp (`Date.now() + holdTTLSeconds * 1000`) and transitions seat status from `available` to `held`. A background timer worker evaluates held seats every 2 seconds. If the current time exceeds `holdExpiresAt` and payment has not been completed, the held seats are automatically released back to `available` status and immediately offered to any pending waitlisted customers. Client-side JS runs an aligned countdown clock to provide a clear user experience before abandonment auto-release.

### 2. Concurrency Protection for Simultaneous Selection
High-demand event tickets risk race conditions where two customers attempt to hold or book the same seat simultaneously. To guarantee that simultaneous attempts never both succeed:
- The system enforces atomic lock checks using in-memory mutex keys (`seatLocks` set on `eventId_seatId`).
- When a hold request arrives, the server checks if any target seat is currently locked. If locked, a `409 Conflict` error is immediately returned to the second requester.
- Once locks are acquired, the seat status is verified. Only if all requested seats are strictly `available` (or held by the same user) is the transaction committed.
- Locks are guaranteed to release in a `finally` block, ensuring zero deadlocks.

### 3. Waitlist Auto-Assignment and Time-Limited Offer Flow
When an event category sells out, customers can join a FIFO (First-In, First-Out) waitlist queue per seat category. When an existing booking is cancelled:
1. The cancelled seat is freed from `booked` status.
2. The waitlist engine dequeues the next customer in line for that specific seat category.
3. The seat is placed in a specialized `held` state tagged `isWaitlistOffer = true` with a time-limited offer expiry (e.g. 2 minutes).
4. An automated notification email is generated containing a unique link encoding the event, seat ID, and target email.
5. If the waitlisted customer clicks the link and completes checkout before the offer timer expires, the ticket is confirmed.
6. If the offer timer expires without completion, the background worker auto-releases the seat and seamlessly offers it to the next waitlisted customer in line.

### 4. QR Code Ticket Generation & Real-Time Updates
Every confirmed booking generates a unique ticket reference (`TKT-XXXXXX`). Using the `qrcode` engine, an SVG/PNG Base64 Data URL is generated containing the encoded booking payload (reference, event title, date/time, customer name, seats, total price). The QR code is rendered directly on the customer's digital dashboard ticket card and attached to the confirmation email. Real-time updates occur via periodic polling, updating visual seat grid statuses (`[Available]`, `[Held]`, `[Booked]`) across concurrent user sessions.
