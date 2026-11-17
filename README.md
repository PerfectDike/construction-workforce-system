This repository contains the shared operational prototype. Machine-learning work is maintained separately.

## Local setup

Install Node.js 20.19+ (or 22.12+) and PostgreSQL. In `backend`, copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET` for your local environment. The optional `docker compose up -d` starts the example PostgreSQL service. Use a new empty database for the initial verification.

```powershell
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm test
npm start
```

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
# or: npm run build
```

The API health endpoint is `http://localhost:5000/api/health`. The seed creates fictional accounts from the shared fixture, using their `example.test` emails as login labels and `DemoPass123!` as the local demonstration password. These credentials are for local fictional data only. The seed adds missing fixture records without deleting or resetting existing records; use a fresh database when a clean scenario is required.

The source fixture's first baseline supplies the initial working task dates. Seed data does not create approved baselines or later workflow records. Independent expected results are in `backend/test/fixtures/expected-results.json`.
