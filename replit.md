# Islamic Reminders WhatsApp SaaS Platform

## Overview

This is a full-stack SaaS platform for sending automated Islamic reminders via WhatsApp. The application provides multi-tenant subscription management, WhatsApp session handling using the Baileys library, and automated scheduling of Islamic content including prayer times, adhkar (remembrances), fasting reminders, and hadith.

Key capabilities:
- Multi-user subscription system with tiered plans (trial, monthly, yearly)
- WhatsApp session management with QR code authentication
- Automated prayer time calculations based on geographic location
- Scheduled Islamic content delivery (morning/evening adhkar, hadith, Quran verses)
- Admin dashboard for user and payment management
- Arabic-first interface with RTL support

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Framework
- **Express.js** serves as the web framework, handling routing, middleware, and API endpoints
- Server entry point is `server.js` which initializes the database, services, and session restoration
- EJS templating engine renders server-side HTML views

### Authentication & Authorization
- JWT-based authentication stored in HTTP-only cookies
- Middleware in `src/middleware/auth.js` handles token verification and role checking
- Two roles: `user` (standard) and `admin` (full access)

### WhatsApp Integration
- **Baileys library** (`@whiskeysockets/baileys`) provides unofficial WhatsApp Web API
- `SessionManager.js` handles session creation, restoration, and connection state
- `MessageService.js` manages message queuing and delivery
- Sessions are persisted to database and restored on server restart

### Database Layer
- **SQLite** with async wrapper in `src/database/db.js`
- Single file database at `src/database/app.db`
- Schema includes: users, plans, subscriptions, whatsapp_sessions, islamic_reminders_config, content_library, and more
- All database operations use Promise-based async/await pattern

### Scheduling System
- **node-cron** powers the `SchedulerService` for timed content delivery
- Checks every minute for prayer reminders, adhkar times, and fasting notifications
- `PrayerTimesService` uses the **adhan** library for accurate prayer time calculations

### Content Services
- `ContentService` manages local content library (adhkar, hadith)
- `ExternalContentService` fetches content from external APIs when needed
- `HadithService` caches hadith from external sources
- `IslamicBackgroundService` provides curated Islamic imagery

### Key Design Patterns
- Services are static classes with async methods
- Fire-and-forget pattern for non-critical notifications
- Graceful error handling to prevent server crashes from WhatsApp disconnections

## External Dependencies

### Core Services
- **SQLite3**: Local file-based database (no external database server required)
- **Baileys/WhatsApp Web**: Unofficial WhatsApp API for message delivery

### Islamic Data APIs
- **adhan npm package**: Prayer time calculations (local, no API calls)
- **hijri-date**: Hijri calendar date conversions
- **Random Hadith Generator API**: `random-hadith-generator.vercel.app` for external hadith

### Media & Content
- **Unsplash**: Islamic/mosque background images via direct URLs
- **Quran.com**: Quran verse references and links

### Payment Integration
- Local payment tracking with receipt upload (Vodafone Cash, Instapay)
- No integrated payment gateway - manual admin approval workflow

### Infrastructure Notes
- Designed for single-server deployment
- Sessions stored locally - requires persistent storage for production
- No external message queue - uses in-memory queuing
- Socket.io for real-time QR code updates during WhatsApp linking