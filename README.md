# Construction Workforce System

Welcome! This repository contains the shared operational prototype for the Construction Workforce System. 

## Get started locally

### Prerequisites

- Node.js **20.19 or later** (or **22.12 or later**)
- PostgreSQL

You can use the optional Docker Compose setup to start the project's supporting services, if preferred.

### Configure the backend

From the `backend` directory, copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET` to values for your local environment.

Then install dependencies, prepare the database, and start the API:

```powershell
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm test
npm start
```

The API health check is available at [http://localhost:5000/api/health](http://localhost:5000/api/health).

### Start the frontend

Keep the backend running, open a second terminal, and run:

```powershell
cd frontend
npm ci
npm run dev
```

To create a production build instead, run `npm run build` from the `frontend` directory.

## Demo data

The seed command creates fictional accounts from the shared fixture. Use each account's `example.test` email address as its login label; the demo password is `DemoPass123!`.

The fixture's first baseline provides the initial working task dates. The seed does not create approved baselines or later workflow records, so those need to be created through the application when testing those workflows.

For local account creation and password recovery, configure `TEST_MAIL_DIR` and `RECOVERY_BASE_URL` as shown in `backend/.env.example`. Invitations and reset links are captured as local test mail; the prototype does not send email. New demonstration accounts must use `@example.test` addresses. If the frontend runs on a different port, set `RECOVERY_BASE_URL` to that frontend address. If the API runs on a different port, set `VITE_API_URL` for the frontend to its `/api` address.

## Tests

Run the backend test suite from the `backend` directory with `npm test`. Independent expected results for the tests are maintained under `backend/test`.
