# Hezo CRM — Enterprise Call Center AI Suite

[![Netlify Status](https://api.netlify.com/api/v1/badges/ee7c4115-6b56-4443-8383-0d15b95b6b05/deploy-status)](https://app.netlify.com/projects/hezocrm/deploys)

A modern, high-performance Call Center CRM engineered for telecalling operations, automated lead assignment, real-time agent monitoring, and full multi-tenant workspace management.

---

## 🚀 Key Features

* **⚡ Daily Leads & Distribution**: Bulk Excel/CSV lead import (up to 25,000+ rows) with automated equal distribution and manual assignment.
* **📞 Live Telecalling Workflow**: One-click calling, real-time disposition updates, follow-up scheduling, and loan status management.
* **🕒 Attendance & Time Tracking**: Daily clock-in/out, live break tracking, overtime calculation, and monthly visual calendars.
* **📊 Analytics & Monitoring**: Live agent call logs, conversion rates, disposition breakdown charts, and executive dashboards.
* **🏢 Multi-Tenant SaaS**: Complete tenant isolation, super admin controls, company administration, and role-based access permissions.

---

## 🛠 Tech Stack

* **Frontend**: React 19, [TanStack Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query)
* **Styling**: Tailwind CSS v4, Lucide React, Radix UI
* **Backend / Database**: [Supabase](https://supabase.com) (PostgreSQL, Row Level Security, Auth)
* **Build & Deploy**: Vite, Netlify

---

## 📦 Local Setup & Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/banuprasad120-creator/hezocrm.git
   cd hezocrm
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env` and fill in your Supabase credentials.

4. **Start the local dev server:**
   ```bash
   npm run dev
   ```

---

## 🌐 Deployment

This project is configured for automated CI/CD deployment via Netlify with `netlify.toml`.
