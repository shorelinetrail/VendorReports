# Vendor Maintenance Tracker

A comprehensive system for tracking maintenance reports from various vendors, built with Next.js, Supabase, and deployed on Vercel.

## Features

### User Management
- **Role-based access control** with four distinct roles:
  - **Admin**: Full system access, user management, configuration
  - **Vendor Coordinator**: Manage routines, confirm visits, upload reports
  - **Maintenance Engineer**: Create and manage recommendations
  - **Technical Engineer**: Review recommendations, provide technical feedback

### Maintenance Routine Management
- Create and manage scheduled maintenance plans
- Define maintenance intervals (in months)
- Set call horizon (months before due date to create visit)
- Assign team members (vendor coordinator, maintenance engineer, technical engineer)
- Track vendor information and plan numbers

### Maintenance Visit Management
- Automatic visit creation based on routine schedules
- Visit workflow:
  1. **Scheduled**: Visit created based on routine
  2. **Date Confirmed**: Vendor coordinator confirms actual visit date
  3. **Report Uploaded**: Maintenance report uploaded after visit
  4. **Recommendations Created**: Maintenance engineer creates action items
  5. **In Review**: Technical engineer reviews recommendations
  6. **Completed**: All recommendations addressed

### Task Management
- Automatic task generation based on workflow
- Configurable deadlines for each task type:
  - Visit confirmation deadline
  - Report upload deadline
  - Recommendations review deadline
  - Technical review deadline
- Task filtering by status (pending, in progress, overdue, completed)
- Personal task dashboard

### Recommendation Tracking
- Create recommendations from maintenance reports
- Fields: description, SAP notification number, due date
- Send for technical review workflow
- Technical engineer review and response
- Mark complete or cancel with reason

### Reporting & Analytics
- Dashboard with key metrics
- Visual charts:
  - Monthly trend analysis
  - Visit status distribution
  - Vendor performance comparison
- Export data to CSV
- Configurable date ranges

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth with Row Level Security
- **File Storage**: Supabase Storage
- **Charts**: dependency-free inline SVG/HTML (`src/components/charts/`)
- **Deployment**: Vercel

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd vendor-reports
```

2. Install dependencies:
```bash
npm install
```

3. Create a Supabase project and run the migrations:
   - Go to your Supabase dashboard
   - Navigate to SQL Editor
   - Run the files in `supabase/migrations/` in numeric order (001 → 015)

4. Configure environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Deployment to Vercel

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

## Database Schema

### Tables
- `users` - User profiles with roles
- `vendors` - Vendor information
- `maintenance_routines` - Scheduled maintenance plans
- `maintenance_visits` - Individual visit records
- `tasks` - Workflow tasks
- `recommendations` - Action items from reports
- `visit_reports` - Uploaded report files per visit
- `system_config` - Configurable settings
- `audit_log` - Append-only record of every write (via DB triggers)

### Row Level Security
All tables have RLS policies enforcing:
- Users can view data within their scope
- Role-based write permissions
- Admin override capabilities

## Configuration

System configuration is managed through the Settings page (Admin only):

| Setting | Default | Description |
|---------|---------|-------------|
| visit_confirmation_days | 14 | Days before visit for confirmation task |
| report_upload_weeks | 2 | Weeks after visit for report upload deadline |
| recommendations_review_days | 7 | Days to create recommendations |
| technical_review_days | 7 | Days for technical review |

## Workflow Overview

```
1. Create Maintenance Routine
   ↓
2. Visit Auto-Created (based on call horizon)
   ↓
3. Vendor Coordinator Confirms Date
   ↓
4. Visit Occurs
   ↓
5. Vendor Coordinator Uploads Report
   ↓
6. Maintenance Engineer Creates Recommendations
   ↓
7. (Optional) Send to Technical Engineer for Review
   ↓
8. Complete/Cancel Recommendations
   ↓
9. Visit Marked Complete
```

## License

MIT
